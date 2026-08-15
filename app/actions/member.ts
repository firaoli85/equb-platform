"use server";

import { headers } from "next/headers";
import { errorMessage } from "@/lib/action-result";
import { linkCurrentUserToPerson } from "@/app/actions/auth";
import { allowLookup, callerIp, LOOKUP_THROTTLE_MESSAGE } from "@/lib/lookup-throttle";
import { resolveWeekDate, storedWeekDates } from "@/lib/commitment";
import { contribution } from "@/lib/contribution";
import { isChasedStatus } from "@/lib/derived";
import { calculateFinishWeek, currentWeekNumber } from "@/lib/money";
import { finalPosition, finalPositionSentence } from "@/lib/final-position";
import { formatDateLongUTC, formatMoney } from "@/lib/format";
import { ownWeekNumber } from "@/lib/member-window";
import { effectiveFinishWeek } from "@/lib/participation-close";

/** Whose group this is. Same fallback shape as lib/device.ts. */
const ORGANIZER_NAME = "Firaoli";
import { findPeopleByPhone } from "@/lib/people-lookup";
import { firebaseConfigured } from "@/lib/firebase-verify";
import { toE164 } from "@/lib/phone";
import { whatsAppMissingConfig } from "@/lib/whatsapp";
import { defaultPinForPhone } from "@/lib/pin";
import { computeStanding, pinnedMapFromEvents } from "@/lib/standing";
import { calculatePayout } from "@/lib/wheel";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

// ————————————————— The member's own world (/me) —————————————————
//
// Everything here is scoped to THE SIGNED-IN MEMBER (2.8). Their own
// amounts, numbers, and payout are theirs to see; nobody else's ever
// appear in these payloads.

/**
 * WHICH PARTICIPATION THE MEMBER'S PORTAL SHOWS.
 *
 * Live cycle first. When there is none, THEIR LAST ONE — whatever its status.
 *
 * THE DEFECT THIS CLOSES. Every member query was gated on
 * `cycle: { status: "ACTIVE" }`, so the instant the organizer closed a cycle
 * all 27 members lost their entire record: `/me` rendered 0 weeks paid, 0 late,
 * 0 total, plus "You are not in the current cycle. Contact the organizer to
 * join." A member who completed all 20 weeks and a member now carrying a
 * $2,000 debt saw the identical empty screen — on the very day the closing
 * statement told them to go and look.
 *
 * Ground truth 2.18 already said otherwise: *"Closed members stay visible —
 * not removed from the cycle. They keep access to their own record and can see
 * where they stopped. Dignity, and a useful record for them."* That applies to
 * a closed CYCLE exactly as it applies to a closed participation.
 *
 * THAT ACCESS IS STILL KEPT — it simply moved. Showing the old cycle HERE
 * satisfied 2.18 by breaking the rule beside it: this function returned the
 * member's most recent participation with `readOnly: true`, a flag that was
 * computed and then read by nothing at all. So a member whose cycle closed in
 * September opened the app in November and saw their old savings ring, week
 * grid, payout card and "next payment due" rendered exactly like a live
 * cycle, with no label saying it had ended. Their finished record read as a
 * bill they were behind on.
 *
 * The record now lives where it cannot be mistaken for the current cycle: the
 * calm home screen for someone not in one, and Account → past cycles. Both
 * read the frozen archive rather than live rows, so the member and the
 * organizer see the same figures.
 */
async function portalParticipation(personId: string): Promise<{ id: string } | null> {
  const live = await prisma.participation.findFirst({
    where: { personId, status: "ACTIVE", cycle: { status: "ACTIVE" } },
    select: { id: true },
  });
  return live ? { id: live.id } : null;
}

/**
 * THEIR RECORD WHEN THEY HAVE STOPPED (2.18).
 *
 * Tsion stopped mid-cycle and this portal showed her "You are not in the
 * current cycle. When the organizer adds you to a cycle, it will appear here."
 * — a blank wall on the day she would most want her record. 2.18 is explicit:
 * closed members KEEP access and can see where they stopped.
 *
 * It is deliberately NOT returned as `participation`. That would render the
 * savings ring, the week grid and "next payment due" — a finished record
 * reading as a live bill, which is the exact mistake the note above this
 * function was written about. It comes back as its own read-only block.
 */
async function stoppedRecord(personId: string) {
  return prisma.participation.findFirst({
    where: { personId, status: "CLOSED", cycle: { status: "ACTIVE" } },
    include: {
      cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
      breaks: { orderBy: { fromWeek: "asc" } },
      payments: { include: { week: { select: { weekNumber: true, date: true } } } },
      paymentEvents: { select: { amount: true, pinnedWeekId: true } },
      luckyNumbers: {
        include: {
          payouts: { select: { netAmount: true, status: true } },
          slotMembers: { include: { slot: { include: { draws: { include: { week: true } } } } } },
        },
      },
    },
  });
}

export async function getMyPortal() {
  try {
    const linked = await linkCurrentUserToPerson();
    if (!linked.ok) return { ok: false as const, error: "signed-out" };
    const person = linked.data;

    const which = await portalParticipation(person.id);
    const participation = which
      ? await prisma.participation.findUnique({
          where: { id: which.id },
          include: {
        cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
        payments: { include: { week: { select: { weekNumber: true, isSkipped: true } } } },
        // EVERY receipt: their total contributed is the sum of these (2.14).
        // The pinned subset (payout settlements, which stay on their drawn
        // week and are never fungible) is filtered out of this list in code.
        paymentEvents: {
          select: {
            amount: true,
            pinnedWeekId: true,
            pinnedWeek: { select: { weekNumber: true } },
          },
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
        })
      : null;

    const base = {
      person: {
        nameAmharic: person.nameAmharic,
        nameEnglishFirst: person.nameEnglishFirst,
        nameEnglishLast: person.nameEnglishLast,
      },
    };
    if (!participation) {
      // THEY MAY HAVE STOPPED RATHER THAN NEVER JOINED (2.18). Those are very
      // different facts and they used to render the identical blank wall.
      const stopped = await stoppedRecord(person.id);
      if (!stopped) {
        return { ok: true as const, data: { ...base, participation: null, stopped: null } };
      }

      const paidIn = stopped.paymentEvents.reduce((sum, e) => sum + e.amount, 0);
      const received = stopped.luckyNumbers
        .flatMap((n) => n.payouts)
        .filter((po) => po.status === "COLLECTED")
        .reduce((sum, po) => sum + po.netAmount, 0);
      const drawnWeek =
        stopped.luckyNumbers
          .flatMap((n) => n.slotMembers.flatMap((sm) => sm.slot.draws))
          .map((d) => d.week)
          .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;

      // Where their window ended: the week before their open break.
      const lastCountedWeek = effectiveFinishWeek({
        startWeek: stopped.startWeek,
        weeksCommitted: stopped.weeksCommitted,
        breaks: stopped.breaks,
      });
      const dateOf = (weekNumber: number) =>
        stopped.cycle.weeks.find((w) => w.weekNumber === weekNumber)?.date ?? null;

      const position = finalPosition({
        paidIn,
        received,
        weeklyAmount: stopped.weeklyAmount,
        weeksCommitted: stopped.weeksCommitted,
        // 2.6: the cycle's real unit and fee, never a constant.
        unitAmount: stopped.cycle.unitAmount,
        feePercent: stopped.cycle.feePercent,
      });
      // MONEY IS RETURNED AT THE END OF THE CYCLE, not on stopping — paying
      // someone out early takes it from the members still contributing. The
      // date is the CYCLE's finish (its last planned week), resolved from the
      // stored row (2.14/2.7), not their own stopping date.
      const cycleFinishDate =
        resolveWeekDate({
          weekNumber: stopped.cycle.plannedWeeks,
          stored: storedWeekDates(stopped.cycle.weeks),
          cycleStartDate: stopped.cycle.startDate,
        })?.date ?? null;

      return {
        ok: true as const,
        data: {
          ...base,
          participation: null,
          stopped: {
            cycleName: stopped.cycle.name,
            // DATES AND THEIR OWN COUNTS (UI_STANDARDS 8c) — never the
            // organizer's week numbers.
            startDate: dateOf(stopped.startWeek)?.toISOString() ?? null,
            stoppedDate: dateOf(lastCountedWeek)?.toISOString() ?? null,
            weeksPaid: Math.min(
              Math.floor(paidIn / Math.max(1, stopped.weeklyAmount)),
              stopped.weeksCommitted,
            ),
            weeksCommitted: stopped.weeksCommitted,
            weeklyAmount: stopped.weeklyAmount,
            paidIn,
            drawn:
              received > 0 || drawnWeek !== null
                ? { on: drawnWeek?.date.toISOString() ?? null, received }
                : null,
            position,
            cycleFinishes: cycleFinishDate?.toISOString() ?? null,
            sentence: finalPositionSentence(
              position,
              ORGANIZER_NAME,
              formatMoney,
              cycleFinishDate === null ? null : formatDateLongUTC(cycleFinishDate),
            ),
          },
        },
      };
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
            isDeferred: payment?.isDeferred ?? false,
            markedLate: payment?.markedLateAt != null,
            isSkipped: w.isSkipped,
          };
        }),
      totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0),
      pinnedByWeek: pinnedMapFromEvents(
        participation.paymentEvents
          .filter((e) => e.pinnedWeekId !== null)
          .map((e) => ({
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
        /** The DAY they won — what the portal shows (2.22). */
        drawnDate: draw?.week.date ?? null,
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

    // The portal count of weeks being chased — part-paid-and-closed included
    // (R2). The member sees the state and its remainder on their week list.
    const lateCount = standing.weeks.filter((w) => isChasedStatus(w.status)).length;

    return {
      ok: true as const,
      data: {
        ...base,
        participation: {
          id: participation.id,
          cycleName: participation.cycle.name,
          // 2.18 — a closed cycle is still THEIR record. The portal renders it
          // as a final statement rather than pretending they were never in a
          // cycle, which is what it did before.
          cycleClosed: participation.cycle.status === "CLOSED",
          cycleClosedAt: participation.cycle.closedAt?.toISOString() ?? null,
          cycleWeek,
          startWeek: participation.startWeek,
          finishWeek,
          // 2.22: "Every member sees their own finish date, always." The week
          // number alone is not a date to anyone reading their own account.
          // 2.14/2.7: the STORED week row is the day that actually happened.
          // The projection is the fallback only when no row exists (a week
          // past the planned end).
          finishDate:
            resolveWeekDate({
              weekNumber: finishWeek,
              stored: storedWeekDates(participation.cycle.weeks),
              cycleStartDate: participation.cycle.startDate,
            })?.date.toISOString() ?? null,
          // THEIR START, AS A DAY. The portal speaks in dates and their own
          // counts; a cycle week number is the organizer's coordinate and
          // means nothing to the person reading their own account (2.22).
          // Resolved exactly like the finish: the STORED row wins (2.14/2.7).
          startDate:
            resolveWeekDate({
              weekNumber: participation.startWeek,
              stored: storedWeekDates(participation.cycle.weeks),
              cycleStartDate: participation.cycle.startDate,
            })?.date.toISOString() ?? null,
          weeksCommitted: participation.weeksCommitted,
          weeklyAmount: participation.weeklyAmount,
          // 2.1: this is a SAVINGS group. What they have PAID IN leads; what
          // is left to save and what is overdue are separate figures and are
          // never conflated (2.14 — all derived from the receipts).
          contribution: contribution({
            receipts: participation.paymentEvents.map((e) => ({ amount: e.amount })),
            weeklyAmount: participation.weeklyAmount,
            weeksCommitted: participation.weeksCommitted,
            overdue: standing.amountOutstanding,
          }),
          weeksCredited: Math.min(standing.weeksCredited, participation.weeksCommitted),
          weeksBehind: standing.weeksBehind,
          lateCount,
          nextDue: nextDue ? { weekNumber: nextDue.weekNumber, date: nextDue.date } : null,
          weeks: standing.weeks.map((w) => ({
            weekNumber: w.weekNumber,
            // Their own position, 1-based from their own start. The cycle
            // number rides along for admin-facing joins only — no member
            // surface may render it (lib/member-vocabulary.test.ts).
            ownWeek: ownWeekNumber({
              weekNumber: w.weekNumber,
              startWeek: participation.startWeek,
              weeksCommitted: participation.weeksCommitted,
            }),
            date: w.date,
            // The portal never accuses ahead of the calendar: future weeks
            // and the still-open current week read as "Upcoming" (2.16).
            status:
              w.status === "UNPAID" ? ("PENDING" as const) : (w.status as
                | "PAID"
                | "PARTIAL"
                // R2: part paid and still chased. The member sees the state
                // and its remainder, never a bare "Late" over money they sent.
                | "PARTIAL_LATE"
                | "LATE"
                | "DEFERRED"
                | "SKIPPED"),
            isDeferred: w.isDeferred,
            isSkipped: w.isSkipped,
            // A member must be able to read down their own list and see
            // $500, $500, $500 and trust the total.
            amountPaid: w.coveredAtCurrentRate,
            amountDue: w.amountDue,
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
// THE LAST SURFACE READING SOMETHING OTHER THAN THE ENGINE, until 15 Aug 2026.
//
// This read the `member_progress` Postgres VIEW, which re-implemented the
// behind-count in SQL. That second implementation is exactly the disease this
// build exists to remove, and it had already drifted: the view excused only
// CYCLE-WIDE skipped weeks and counted a personal deferral as behind — the
// pre-D-42 ruling, written into SQL and left there. So a deferred member read
// "2 weeks behind" here and "up to date" on their own page, ten seconds apart,
// and both came from this platform.
//
// The view is DROPPED in 20260815234500_retire_member_progress_view. Retiring
// beat regenerating because there was exactly ONE reader and the engine already
// computes every figure it returned; rewriting the rules in SQL would have kept
// two answers to one question and a mirror test to maintain forever.
//
// 2.8 MOVED FROM THE DATABASE INTO THIS FUNCTION, and that is the one real cost
// of retiring. The view granted SELECT on six columns only and scoped rows to
// the caller's own cycles, so the database refused to disclose anything more
// even if this code asked. That guarantee now lives in the projection below and
// in member-group-disclosure.test.ts, which fails if a seventh field or another
// cycle's member ever appears. Named here because a guarantee that moves
// quietly is a guarantee that gets lost.

export async function getGroupProgress() {
  try {
    const linked = await linkCurrentUserToPerson();
    if (!linked.ok) return { ok: false as const, error: "signed-out" };
    const person = linked.data;

    // ONE QUERY FOR THE WHOLE GROUP, then a pure derivation per member — the
    // same shape /admin/cash already runs over this same member set. The view
    // cost one round trip; so does this.
    const cycle = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      include: {
        weeks: { orderBy: { weekNumber: "asc" } },
        participations: {
          where: { status: "ACTIVE" },
          include: {
            person: { select: { nameAmharic: true, nameEnglishFirst: true } },
            payments: true,
            paymentEvents: {
              where: { pinnedWeekId: { not: null } },
              select: { amount: true, pinnedWeek: { select: { weekNumber: true } } },
            },
          },
        },
      },
    });
    if (!cycle) return { ok: false as const, error: "No active cycle." };

    // THE CALLER MUST BE IN THIS CYCLE. The view enforced this in SQL through
    // auth.uid(); with the view gone it is enforced here, and refusing outright
    // is the honest answer — a member of no active cycle has no group to read.
    const mine = cycle.participations.find((p) => p.personId === person.id) ?? null;
    if (!mine) return { ok: false as const, error: "No active cycle." };

    const today = new Date();
    const currentWeek = currentWeekNumber(cycle.startDate, today);

    const rows = cycle.participations.map((p) => {
      const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
      const paymentByWeekId = new Map(p.payments.map((pm) => [pm.weekId, pm]));
      const standing = computeStanding({
        weeklyAmount: p.weeklyAmount,
        startWeek: p.startWeek,
        weeksCommitted: p.weeksCommitted,
        cycleWeek: currentWeek,
        today,
        windowWeeks: cycle.weeks
          .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek)
          .map((w) => {
            const payment = paymentByWeekId.get(w.id) ?? null;
            return {
              weekNumber: w.weekNumber,
              date: w.date,
              amountDue: p.weeklyAmount,
              storedPaid: payment?.amountPaid ?? 0,
              isDeferred: payment?.isDeferred ?? false,
              markedLate: payment?.markedLateAt != null,
              isSkipped: w.isSkipped,
            };
          }),
        totalPaid: p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
        pinnedByWeek: pinnedMapFromEvents(
          p.paymentEvents.map((e) => ({
            amount: e.amount,
            weekNumber: e.pinnedWeek?.weekNumber ?? null,
          })),
        ),
      });
      return {
        participationId: p.id,
        nameAmharic: p.person.nameAmharic,
        nameEnglishFirst: p.person.nameEnglishFirst,
        // THE VIEW'S OWN ARITHMETIC, from the engine instead of from SQL:
        // `least(floor(total / weekly), weeksCommitted)`.
        weeksPaid: Math.min(standing.weeksCredited, p.weeksCommitted),
        // AND THE FIGURE THAT DISAGREED. The engine excludes deferred weeks
        // (D-42, §2.29a); the view counted them as behind.
        weeksBehind: standing.weeksBehind,
      };
    });

    const viewer = rows.find((r) => r.participationId === mine.id) ?? null;
    const peers = rows
      .filter((r) => r.participationId !== mine.id)
      .sort((a, b) => a.nameEnglishFirst.localeCompare(b.nameEnglishFirst));

    return {
      ok: true as const,
      data: {
        cycleName: cycle.name,
        currentWeek,
        plannedWeeks: cycle.plannedWeeks,
        viewer: viewer ? { ...viewer, weeksCommitted: mine.weeksCommitted } : null,
        // 2.8: name, weeks paid, behind count. Nothing else about anybody else.
        peers,
        totalMembers: rows.length,
        currentCount: rows.filter((r) => r.weeksBehind === 0).length,
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
        // The DAY they won. The portal speaks in dates; a cycle week number
        // is the organizer's coordinate (2.22, lib/member-window.ts).
        drawnDate: draw?.week.date ?? null,
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
    if (!allowLookup(`ip:${ip}`) || !allowLookup(`phone:${toE164(phone)}`)) {
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
        // 2.28 — offer ONLY doors that actually work. These say whether the
        // CHANNEL is configured on this deployment, nothing about this member,
        // so they leak no per-person fact.
        // Configured AND switched on. While Meta has the Business Account
        // disabled the switch is off, so the door disappears rather than
        // handing out codes that never arrive.
        whatsAppAvailable:
          whatsAppMissingConfig().length === 0 && (await getSetting("whatsappEnabled")),
        smsAvailable: firebaseConfigured(),
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
