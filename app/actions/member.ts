"use server";

import { headers } from "next/headers";
import { errorMessage } from "@/lib/action-result";
import { linkCurrentUserToPerson } from "@/app/actions/auth";
import { allowLookup, callerIp, LOOKUP_THROTTLE_MESSAGE } from "@/lib/lookup-throttle";
import { calculateFinishWeek, currentWeekNumber } from "@/lib/money";
import { findPeopleByPhone } from "@/lib/people-lookup";
import { phoneDigits, toE164 } from "@/lib/phone";
import { defaultPinForPhone } from "@/lib/pin";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";
import { calculatePayout } from "@/lib/wheel";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

// ————————————————— The member's own world (/me) —————————————————
//
// Everything here is scoped to THE SIGNED-IN MEMBER (2.8). Their own
// amounts, numbers, and payout are theirs to see; nobody else's ever
// appear in these payloads.

export async function getMyPortal() {
  try {
    const linked = await linkCurrentUserToPerson();
    if (!linked.ok) return { ok: false as const, error: "signed-out" };
    const person = linked.data;

    const participation = await prisma.participation.findFirst({
      where: { personId: person.id, status: "ACTIVE", cycle: { status: "ACTIVE" } },
      include: {
        cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
        payments: { include: { week: { select: { weekNumber: true, isSkipped: true } } } },
        // Payout settlements stay pinned to their drawn week (never fungible).
        paymentEvents: {
          where: { pinnedWeekId: { not: null } },
          select: { amount: true, pinnedWeek: { select: { weekNumber: true } } },
        },
        luckyNumbers: {
          orderBy: { number: "asc" },
          include: {
            payouts: true,
            slotMembers: {
              include: { slot: { include: { draws: { include: { week: true } } } } },
            },
          },
        },
      },
    });

    const base = {
      person: {
        nameAmharic: person.nameAmharic,
        nameEnglishFirst: person.nameEnglishFirst,
        nameEnglishLast: person.nameEnglishLast,
      },
    };
    if (!participation) {
      return { ok: true as const, data: { ...base, participation: null } };
    }

    const today = new Date();
    const cycleWeek = currentWeekNumber(participation.cycle.startDate, today);
    const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
    const standing = computeStanding({
      weeklyAmount: participation.weeklyAmount,
      startWeek: participation.startWeek,
      weeksCommitted: participation.weeksCommitted,
      cycleWeek,
      today,
      windowWeeks: participation.cycle.weeks
        .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
        .map((w) => {
          const payment = participation.payments.find((p) => p.weekId === w.id) ?? null;
          return {
            weekNumber: w.weekNumber,
            date: w.date,
            amountDue: participation.weeklyAmount,
            storedPaid: payment?.amountPaid ?? 0,
            isDeferred: (payment?.isDeferred ?? false) || w.isSkipped,
          };
        }),
      totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0),
      pinnedByWeek: pinnedMapFromEvents(
        participation.paymentEvents.map((e) => ({
          amount: e.amount,
          weekNumber: e.pinnedWeek?.weekNumber ?? null,
        })),
      ),
    });

    // Their payout, per lucky number (2.14: derived; actual rows win when a
    // draw has happened). Draw facts come from the number's slot membership.
    const numbers = participation.luckyNumbers.map((n) => {
      const projected = calculatePayout({
        luckyNumber: { id: n.id, amount: n.amount },
        participation: { weeksCommitted: participation.weeksCommitted },
        cycle: { feePercent: participation.cycle.feePercent },
      });
      const draw = n.slotMembers.map((sm) => sm.slot.draws[0]).find(Boolean) ?? null;
      const payout = n.payouts[0] ?? null;
      return {
        id: n.id,
        number: n.number,
        amount: n.amount,
        drawnWeekNumber: draw?.week.weekNumber ?? null,
        payoutStatus: payout?.status ?? null,
        netAmount: payout?.netAmount ?? projected.net,
        grossAmount: payout?.grossAmount ?? projected.gross,
      };
    });

    // Next due: the first uncovered non-deferred week at or after the current
    // calendar week — falling back to the OLDEST uncovered week (2.15:
    // oldest debt first) so a member whose window has fully passed with money
    // still owed is never told they are paid up.
    const uncovered = standing.weeks.filter(
      (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
    );
    const nextDue =
      uncovered.find((w) => w.weekNumber >= Math.max(cycleWeek, participation.startWeek)) ??
      uncovered[0] ??
      null;

    const lateCount = standing.weeks.filter((w) => w.status === "LATE").length;

    return {
      ok: true as const,
      data: {
        ...base,
        participation: {
          id: participation.id,
          cycleName: participation.cycle.name,
          cycleWeek,
          startWeek: participation.startWeek,
          finishWeek,
          weeksCommitted: participation.weeksCommitted,
          weeklyAmount: participation.weeklyAmount,
          weeksCredited: Math.min(standing.weeksCredited, participation.weeksCommitted),
          weeksBehind: standing.weeksBehind,
          lateCount,
          nextDue: nextDue ? { weekNumber: nextDue.weekNumber, date: nextDue.date } : null,
          weeks: standing.weeks.map((w) => ({
            weekNumber: w.weekNumber,
            date: w.date,
            // The portal never accuses ahead of the calendar: future weeks
            // and the still-open current week read as "Upcoming" (2.16).
            status:
              w.status === "UNPAID" ? ("PENDING" as const) : (w.status as
                | "PAID"
                | "PARTIAL"
                | "LATE"
                | "DEFERRED"),
            isDeferred: w.isDeferred,
          })),
          numbers,
        },
      },
    };
  } catch (e) {
    console.error("getMyPortal failed:", e);
    return { ok: false as const, error: `Could not load your account. ${errorMessage(e)}` };
  }
}

// ————————————————— The group (/me/group) —————————————————
//
// Reads the member_progress VIEW through the caller's own Supabase session,
// so the database enforces 2.8: name + weeks paid + behind count, nothing
// else, scoped to cycles the caller is in.

export async function getGroupProgress() {
  try {
    const linked = await linkCurrentUserToPerson();
    if (!linked.ok) return { ok: false as const, error: "signed-out" };
    const person = linked.data;

    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, startDate: true, plannedWeeks: true },
    });
    if (!cycle) return { ok: false as const, error: "No active cycle." };

    const mine = await prisma.participation.findFirst({
      where: { personId: person.id, cycleId: cycle.id, status: "ACTIVE" },
      select: { id: true, weeksCommitted: true },
    });

    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("member_progress")
      .select("cycle_id, participation_id, name_amharic, name_english_first, weeks_paid, weeks_behind")
      .eq("cycle_id", cycle.id);
    if (error) {
      console.error("member_progress query failed:", error);
      return { ok: false as const, error: "Could not load the group." };
    }

    type Row = {
      participation_id: string;
      name_amharic: string;
      name_english_first: string;
      weeks_paid: number;
      weeks_behind: number;
    };
    const all = (rows ?? []) as Row[];
    const viewer = all.find((r) => r.participation_id === mine?.id) ?? null;
    const peers = all
      .filter((r) => r.participation_id !== mine?.id)
      .sort((a, b) => a.name_english_first.localeCompare(b.name_english_first));

    return {
      ok: true as const,
      data: {
        cycleName: cycle.name,
        currentWeek: currentWeekNumber(cycle.startDate, new Date()),
        plannedWeeks: cycle.plannedWeeks,
        viewer: viewer
          ? {
              participationId: viewer.participation_id,
              nameAmharic: viewer.name_amharic,
              nameEnglishFirst: viewer.name_english_first,
              weeksPaid: viewer.weeks_paid,
              weeksBehind: viewer.weeks_behind,
              weeksCommitted: mine?.weeksCommitted ?? null,
            }
          : null,
        peers: peers.map((r) => ({
          participationId: r.participation_id,
          nameAmharic: r.name_amharic,
          nameEnglishFirst: r.name_english_first,
          weeksPaid: r.weeks_paid,
          weeksBehind: r.weeks_behind,
        })),
        totalMembers: all.length,
        currentCount: all.filter((r) => r.weeks_behind === 0).length,
      },
    };
  } catch (e) {
    console.error("getGroupProgress failed:", e);
    return { ok: false as const, error: `Could not load the group. ${errorMessage(e)}` };
  }
}

// ————————————————— Collections (/me/collections) —————————————————
//
// Draw history by NUMBER only (2.8): week + the numbers in the drawn slot.
// Never names, never amounts, never payment methods. The caller's own draw
// status is the one personal thing on the page.

export async function getMemberCollections() {
  try {
    const linked = await linkCurrentUserToPerson();
    if (!linked.ok) return { ok: false as const, error: "signed-out" };
    const person = linked.data;

    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      include: {
        weeks: {
          orderBy: { weekNumber: "asc" },
          include: {
            draws: {
              include: {
                slot: {
                  include: {
                    members: { include: { luckyNumber: { select: { number: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!cycle) return { ok: false as const, error: "No active cycle." };

    const currentWeek = currentWeekNumber(cycle.startDate, new Date());

    const draws = cycle.weeks
      .filter((w) => w.draws.length > 0)
      .map((w) => ({
        weekNumber: w.weekNumber,
        date: w.date,
        numbers: w.draws[0].slot.members
          .map((m) => m.luckyNumber.number)
          .sort((a, b) => a - b),
      }));

    // The next draw: the earliest undrawn, unskipped week from the current
    // week forward (catching up counts — an overdue draw is still "next").
    const nextDrawWeek =
      cycle.weeks.find((w) => w.draws.length === 0 && !w.isSkipped) ?? null;

    // The caller's own status (their data, 2.8-allowed).
    const mine = await prisma.participation.findFirst({
      where: { personId: person.id, cycleId: cycle.id, status: "ACTIVE" },
      include: {
        luckyNumbers: {
          orderBy: { number: "asc" },
          include: {
            payouts: true,
            slotMembers: {
              include: { slot: { include: { draws: { include: { week: true } } } } },
            },
          },
        },
      },
    });

    const myNumbers = (mine?.luckyNumbers ?? []).map((n) => {
      const draw = n.slotMembers.map((sm) => sm.slot.draws[0]).find(Boolean) ?? null;
      const payout = n.payouts[0] ?? null;
      return {
        number: n.number,
        drawnWeekNumber: draw?.week.weekNumber ?? null,
        collected: payout?.status === "COLLECTED",
      };
    });

    return {
      ok: true as const,
      data: {
        cycleName: cycle.name,
        currentWeek,
        draws,
        nextDraw: nextDrawWeek
          ? { weekNumber: nextDrawWeek.weekNumber, date: nextDrawWeek.date }
          : null,
        myNumbers,
      },
    };
  } catch (e) {
    console.error("getMemberCollections failed:", e);
    return { ok: false as const, error: `Could not load collections. ${errorMessage(e)}` };
  }
}

// ————————————————— Login step 1 (/login) —————————————————

/**
 * Phone lookup for the two-step login. Returns the bilingual welcome name
 * and which sign-in methods this member may use — the PIN toggles
 * (pinLoginEnabled + per-person pinLoginAllowed, 2.6) are evaluated HERE,
 * server-side; signInWithPin re-checks them on submit.
 *
 * This endpoint is reachable WITHOUT a session, and the phone→name pairing
 * is 2.8-protected — so it is throttled per caller IP and per tried number,
 * and matching is digit-based so formatted or autofilled numbers work.
 */
export async function lookupMemberByPhone(input: { phone: string }) {
  try {
    const phone = input.phone?.trim();
    if (!phone) return { ok: false as const, error: "Enter your phone number." };

    const header = await headers();
    const ip = callerIp(header);
    if (!allowLookup(`ip:${ip}`) || !allowLookup(`phone:${phoneDigits(phone)}`)) {
      return { ok: false as const, error: LOOKUP_THROTTLE_MESSAGE };
    }

    const people = await findPeopleByPhone(phone);
    if (people.length === 0) {
      return {
        ok: false as const,
        error: "That number isn't registered. Check it, or contact the organizer.",
      };
    }
    // Ambiguity is handled at PIN time; for the welcome, use the first.
    const person = people[0];
    const globallyEnabled = await getSetting("pinLoginEnabled");
    const defaultFromPhone = await getSetting("defaultPinFromPhone");
    const pinLoginOn = person.pinLoginAllowed ?? globallyEnabled;
    const hasOwnPin = person.pinHash !== null;
    // A member with no PIN yet can still use the phone-digit default (2.6),
    // so the PIN door stays open for them when the setting allows it.
    const defaultAvailable =
      defaultFromPhone && !hasOwnPin && defaultPinForPhone(person.phone) !== null;
    const pinAllowed = pinLoginOn && (hasOwnPin || defaultAvailable);

    return {
      ok: true as const,
      data: {
        // Normalized so the same string works for PIN sign-in and OTP (E.164).
        phone: toE164(phone),
        nameEnglishFirst: person.nameEnglishFirst,
        nameAmharic: person.nameAmharic,
        pinAvailable: pinAllowed,
        // SECURITY (audit C2): `hasOwnPin` used to be returned here. This
        // endpoint is UNAUTHENTICATED, so that published a list of exactly
        // which members were still signable-in with their own phone digits —
        // a ready-made target list. The system never advertises who relies on
        // the default; members who need the hint are told after the attempt.
      },
    };
  } catch (e) {
    console.error("lookupMemberByPhone failed:", e);
    return { ok: false as const, error: `Could not check that number. ${errorMessage(e)}` };
  }
}
