"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import {
  DEFAULT_TEMPLATES,
  isMessageKey,
  MANUAL_MESSAGE_KEYS,
  MESSAGE_KEYS,
  placeholderValues,
  renderTemplate,
  unknownPlaceholders,
  type MessageExtras,
  type MessageKey,
} from "@/lib/messages";
import {
  loadStandingFacts,
  loadTemplates,
  sendStatement,
  type SendOutcome,
} from "@/lib/messaging-engine";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { calculatePayout } from "@/lib/wheel";
import { whatsAppMissingConfig } from "@/lib/whatsapp";

// Messaging actions (2.20/2.21): templates the organizer edits, previews
// against REAL members, manual batches with per-person override, and the
// log. Everything sensitive is behind requireAdmin, and everything that
// shows names/phones/money refuses in presentation mode (2.4) — sending
// messages is exactly what must not happen during a screen share.

// ————————————————— Winner facts —————————————————

/**
 * Winners of the LATEST drawn week of the cycle: participation → the drawn
 * week and net payout (actual Payout row when recorded, else the same
 * tested projection the wheel uses).
 */
async function winnerExtrasByParticipation(cycleId: string) {
  const latestDraw = await prisma.draw.findFirst({
    where: { week: { cycleId } },
    orderBy: { week: { weekNumber: "desc" } },
    include: {
      week: true,
      slot: {
        include: {
          members: {
            include: {
              luckyNumber: {
                include: {
                  payouts: true,
                  participation: {
                    select: { id: true, weeksCommitted: true, cycle: { select: { feePercent: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const map = new Map<string, MessageExtras>();
  if (!latestDraw) return map;
  for (const member of latestDraw.slot.members) {
    const n = member.luckyNumber;
    const projected = calculatePayout({
      luckyNumber: { id: n.id, amount: n.amount },
      participation: { weeksCommitted: n.participation.weeksCommitted },
      cycle: { feePercent: n.participation.cycle.feePercent },
    });
    const payout = n.payouts[0] ?? null;
    // A member can hold several numbers in one slot; sum is not meaningful
    // here — the announcement is per drawn number, keep the first.
    if (!map.has(n.participation.id)) {
      map.set(n.participation.id, {
        drawnWeek: latestDraw.week.weekNumber,
        payoutNet: payout?.netAmount ?? projected.net,
      });
    }
  }
  return map;
}

// ————————————————— Overview (templates + members + log) —————————————————

export async function getMessagingOverview() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // Names, phones, and money in one payload — nothing for a shared screen.
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }

    const templates = await loadTemplates();
    const cycle = await prisma.cycle.findFirst({ where: { status: "ACTIVE" } });
    const participations = cycle
      ? await prisma.participation.findMany({
          where: { cycleId: cycle.id, status: "ACTIVE" },
          include: { person: true },
          orderBy: { person: { nameEnglishFirst: "asc" } },
        })
      : [];
    const log = await prisma.messageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        person: { select: { nameAmharic: true, nameEnglishFirst: true, nameEnglishLast: true } },
      },
    });

    return {
      ok: true as const,
      data: {
        whatsAppMissingConfig: whatsAppMissingConfig(),
        templates: MESSAGE_KEYS.map((key) => {
          const row = templates.get(key)!;
          return {
            id: row.id,
            key,
            name: row.name,
            body: row.body,
            metaTemplateSid: row.metaTemplateSid,
            updatedAt: row.updatedAt,
          };
        }),
        members: participations.map((p) => ({
          participationId: p.id,
          nameAmharic: p.person.nameAmharic,
          nameEnglish: `${p.person.nameEnglishFirst} ${p.person.nameEnglishLast ?? ""}`.trim(),
          noMessages: p.person.noMessages,
          hasPhone: (p.person.phone?.trim() ?? "") !== "",
        })),
        log: log.map((entry) => ({
          id: entry.id,
          person: `${entry.person.nameEnglishFirst} ${entry.person.nameEnglishLast ?? ""}`.trim(),
          personAmharic: entry.person.nameAmharic,
          templateKey: entry.templateKey,
          body: entry.body,
          channel: entry.channel,
          toPhone: entry.toPhone,
          trigger: entry.trigger,
          status: entry.status,
          error: entry.error,
          createdAt: entry.createdAt,
        })),
      },
    };
  } catch (e) {
    console.error("getMessagingOverview failed:", e);
    return { ok: false as const, error: `Could not load messaging. ${errorMessage(e)}` };
  }
}

// ————————————————— Template editing (2.20: organizer-owned wording) —————————————————

export async function updateMessageTemplate(input: {
  id: string;
  body: string;
  metaTemplateSid: string | null;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const body = input.body?.trim();
    if (!body) return { ok: false as const, error: "The message text cannot be empty." };
    if (body.length > 4000) {
      return { ok: false as const, error: "The message text is too long (4,000 characters max)." };
    }
    const metaTemplateSid = input.metaTemplateSid?.trim() || null;

    const existing = await prisma.messageTemplate.findUnique({ where: { id: input.id } });
    if (!existing) return { ok: false as const, error: "Template not found." };

    await prisma.$transaction(async (tx) => {
      await tx.messageTemplate.update({
        where: { id: input.id },
        data: { body, metaTemplateSid },
      });
      await logAudit(tx, {
        entity: "MessageTemplate",
        entityId: existing.id,
        action: "update",
        summary: `Edited the "${existing.name}" message template`,
        before: { body: existing.body, metaTemplateSid: existing.metaTemplateSid },
        after: { body, metaTemplateSid },
      });
    });

    revalidatePath("/admin/messages");
    return {
      ok: true as const,
      data: {
        // Unknown tokens stay literal in sends — tell the organizer now.
        unknownPlaceholders: unknownPlaceholders(body),
      },
    };
  } catch (e) {
    console.error("updateMessageTemplate failed:", e);
    return { ok: false as const, error: `Could not save the template. ${errorMessage(e)}` };
  }
}

// ————————————————— Live preview against a real member —————————————————

export async function previewMessage(input: {
  key: string;
  participationId: string;
  /** The editor's unsaved draft — preview what the organizer is typing. */
  body?: string;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    if (!isMessageKey(input.key)) return { ok: false as const, error: "Unknown message type." };
    const key: MessageKey = input.key;

    const loaded = await loadStandingFacts(input.participationId);
    if (!loaded) return { ok: false as const, error: "Member not found." };

    let extras: MessageExtras = {};
    let sampleNote: string | null = null;
    if (key === "PAYMENT_CONFIRMED") {
      // A confirmation only exists at the moment of a receipt — preview with
      // a clearly-labeled sample receipt of one weekly amount.
      const firstUncovered =
        loaded.standing.weeks.find(
          (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
        ) ?? null;
      extras = {
        amountReceived: loaded.participation.weeklyAmount,
        weeksCovered: [firstUncovered?.weekNumber ?? loaded.facts.currentCycleWeek],
      };
      sampleNote = "Preview uses a sample receipt of one weekly amount.";
    } else if (key === "WINNER_ANNOUNCEMENT") {
      const winners = await winnerExtrasByParticipation(loaded.participation.cycleId);
      const real = winners.get(input.participationId);
      if (real) {
        extras = real;
      } else {
        const firstNumber = await prisma.luckyNumber.findFirst({
          where: { participationId: input.participationId },
          orderBy: { number: "asc" },
        });
        const projected = firstNumber
          ? calculatePayout({
              luckyNumber: { id: firstNumber.id, amount: firstNumber.amount },
              participation: { weeksCommitted: loaded.participation.weeksCommitted },
              cycle: { feePercent: loaded.participation.cycle.feePercent },
            })
          : null;
        extras = {
          drawnWeek: loaded.facts.currentCycleWeek,
          ...(projected ? { payoutNet: projected.net } : {}),
        };
        sampleNote =
          "Preview uses a projected payout — this member has no recorded draw in the latest drawn week.";
      }
    } else if (key === "LOCKOUT_NOTICE") {
      extras = { lockMinutes: await getSetting("pinLockMinutes") };
      sampleNote = "Preview uses the configured lock duration (settings → PIN lockout).";
    }

    const templates = await loadTemplates();
    const body = input.body?.trim() || templates.get(key)?.body || DEFAULT_TEMPLATES[key].body;
    return {
      ok: true as const,
      data: {
        rendered: renderTemplate(body, placeholderValues(loaded.facts, extras)),
        unknownPlaceholders: unknownPlaceholders(body),
        sampleNote,
      },
    };
  } catch (e) {
    console.error("previewMessage failed:", e);
    return { ok: false as const, error: `Could not render the preview. ${errorMessage(e)}` };
  }
}

// ————————————————— Manual batches: prepare, then send (2.20) —————————————————

function manualKeyOrError(key: string) {
  if (!isMessageKey(key)) return { ok: false as const, error: "Unknown message type." };
  if (!MANUAL_MESSAGE_KEYS.includes(key)) {
    return {
      ok: false as const,
      error:
        "Payment confirmations send automatically when a payment is recorded — they are not sent as a batch (2.20).",
    };
  }
  return { ok: true as const, key };
}

/**
 * Everything the organizer needs BEFORE anything leaves: exactly who is
 * suggested for this message type, the real rendered text each would
 * receive, and who is excluded and why. Nothing is sent here.
 */
export async function prepareBatch(input: { key: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const keyCheck = manualKeyOrError(input.key);
    if (!keyCheck.ok) return keyCheck;
    const key = keyCheck.key;

    const cycle = await prisma.cycle.findFirst({ where: { status: "ACTIVE" } });
    if (!cycle) return { ok: false as const, error: "No active cycle." };

    // Closing statements go to EVERY member of the cycle, including members
    // closed early (2.18: they keep their record); the rest concern only
    // members still active.
    const participations = await prisma.participation.findMany({
      where: {
        cycleId: cycle.id,
        ...(key === "CYCLE_CLOSING_STATEMENT" ? {} : { status: "ACTIVE" }),
      },
      include: { person: true },
      orderBy: { person: { nameEnglishFirst: "asc" } },
    });

    const winners =
      key === "WINNER_ANNOUNCEMENT" ? await winnerExtrasByParticipation(cycle.id) : null;
    const templates = await loadTemplates();
    const body = templates.get(key)?.body ?? DEFAULT_TEMPLATES[key].body;

    const rows: {
      participationId: string;
      nameAmharic: string;
      nameEnglish: string;
      phone: string | null;
      rendered: string;
      checked: boolean;
      blocked: string | null;
    }[] = [];

    for (const p of participations) {
      const loaded = await loadStandingFacts(p.id);
      if (!loaded) continue;

      // Who this message type is FOR — the suggestion, never the decision.
      const lateWeeks = loaded.standing.weeks.filter((w) => w.status === "LATE");
      const relevant =
        key === "BEHIND_NOTICE"
          ? loaded.facts.weeksBehind > 0
          : key === "LATE_NOTICE"
            ? lateWeeks.length > 0
            : key === "WINNER_ANNOUNCEMENT"
              ? (winners?.has(p.id) ?? false)
              : true;
      if (!relevant) continue;

      const blocked = p.person.noMessages
        ? "Marked “no messages” (hardship) — will not be sent, even if checked."
        : (p.person.phone?.trim() ?? "") === ""
          ? "No phone number on file."
          : null;

      rows.push({
        participationId: p.id,
        nameAmharic: p.person.nameAmharic,
        nameEnglish: `${p.person.nameEnglishFirst} ${p.person.nameEnglishLast ?? ""}`.trim(),
        phone: p.person.phone,
        rendered: renderTemplate(
          body,
          placeholderValues(loaded.facts, winners?.get(p.id) ?? {}),
        ),
        checked: blocked === null,
        blocked,
      });
    }

    return {
      ok: true as const,
      data: {
        key,
        cycleName: cycle.name,
        rows,
        note:
          key === "BEHIND_NOTICE"
            ? "Members currently behind by at least one week."
            : key === "LATE_NOTICE"
              ? "Members with at least one week unpaid after its window closed."
              : key === "WINNER_ANNOUNCEMENT"
                ? "Winners of the latest drawn week."
                : "Every member of the cycle, including anyone closed early.",
      },
    };
  } catch (e) {
    console.error("prepareBatch failed:", e);
    return { ok: false as const, error: `Could not prepare the messages. ${errorMessage(e)}` };
  }
}

/**
 * Send the checked messages. Everything re-derives and re-renders HERE at
 * send time (2.21) — the preview showed the same thing, but the send never
 * trusts the browser. The hardship flag is enforced again per person.
 */
export async function sendBatch(input: { key: string; participationIds: string[] }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const keyCheck = manualKeyOrError(input.key);
    if (!keyCheck.ok) return keyCheck;
    const key = keyCheck.key;
    if (!Array.isArray(input.participationIds) || input.participationIds.length === 0) {
      return { ok: false as const, error: "Nobody is selected." };
    }

    const cycle = await prisma.cycle.findFirst({ where: { status: "ACTIVE" } });
    const winners =
      key === "WINNER_ANNOUNCEMENT" && cycle
        ? await winnerExtrasByParticipation(cycle.id)
        : null;

    const results: {
      participationId: string;
      outcome: SendOutcome;
    }[] = [];
    // Sequential on purpose: 25 members at most, and it keeps the provider
    // from rate-limiting a burst.
    for (const participationId of input.participationIds) {
      const outcome = await sendStatement({
        participationId,
        key,
        trigger: "MANUAL",
        extras: winners?.get(participationId) ?? {},
      });
      results.push({ participationId, outcome });
    }

    revalidatePath("/admin/messages");
    return { ok: true as const, data: { results } };
  } catch (e) {
    console.error("sendBatch failed:", e);
    return { ok: false as const, error: `Could not send the messages. ${errorMessage(e)}` };
  }
}

// ————————————————— Hardship flag (2.20) —————————————————

export async function setNoMessages(input: { personId: string; noMessages: boolean }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (typeof input.noMessages !== "boolean") {
      return { ok: false as const, error: "Invalid value." };
    }
    const person = await prisma.person.findUnique({ where: { id: input.personId } });
    if (!person) return { ok: false as const, error: "Person not found." };
    if (person.noMessages === input.noMessages) {
      return { ok: true as const, data: { noMessages: person.noMessages } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: person.id },
        data: { noMessages: input.noMessages },
      });
      await logAudit(tx, {
        entity: "Person",
        entityId: person.id,
        action: "update",
        summary: input.noMessages
          ? `Marked ${person.nameEnglishFirst} as "no messages" (hardship)`
          : `Removed the "no messages" flag from ${person.nameEnglishFirst}`,
        before: { noMessages: person.noMessages },
        after: { noMessages: input.noMessages },
      });
    });

    revalidatePath(`/admin/people/${person.id}`);
    revalidatePath("/admin/messages");
    return { ok: true as const, data: { noMessages: input.noMessages } };
  } catch (e) {
    console.error("setNoMessages failed:", e);
    return { ok: false as const, error: `Could not save. ${errorMessage(e)}` };
  }
}
