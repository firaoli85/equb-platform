"use server";

import { PAGE_SIZES, pageInfo } from "@/lib/paging";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { isChasedStatus } from "@/lib/derived";
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
import { lateNoticeExtrasForParticipation } from "@/lib/late-notice-extras";
import { reconcileAcceptedStatuses } from "@/lib/message-reconcile";
import { stillDueOnWeek, weekLabelFull } from "@/lib/payment-message";
import {
  listQueuedMessages,
  loadStandingFacts,
  loadTemplates,
  sendQueuedMessage,
  sendStatement,
  type SendOutcome,
} from "@/lib/messaging-engine";
import {
  approvedWordingRefusal,
  APPROVED_TEMPLATES,
  isApprovedTemplateKey,
} from "@/lib/whatsapp-templates";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting, WHATSAPP_DISABLED_REASON } from "@/lib/settings";
import { portalUrlValue, welcomeSendCheck } from "@/lib/welcome-send";
import { sendTelegramGroupMessage } from "@/lib/telegram";
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

export async function getMessagingOverview(input?: { logPage?: number; logPageSize?: number }) {
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
    // PAGED, NOT SILENTLY CUT.
    //
    // This took 100 with nothing on screen saying so. An organizer looking for
    // a notice he sent last cycle scrolled to the bottom, did not find it, and
    // would reasonably conclude it was never sent — from a log whose whole
    // purpose is to answer that question. MessageLog is append-only and grows
    // forever, so the answer is paging, not a bigger number.
    const logTotal = await prisma.messageLog.count();
    const logPage = pageInfo(logTotal, input?.logPage ?? 1, input?.logPageSize ?? PAGE_SIZES.messageLog);
    const log = await prisma.messageLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: logPage.skip,
      take: logPage.take,
      include: {
        person: { select: { nameAmharic: true, nameEnglishFirst: true, nameEnglishLast: true } },
      },
    });

    return {
      ok: true as const,
      data: {
        whatsAppMissingConfig: whatsAppMissingConfig(),
        // The channel switch and its reason, so the page states the truth
        // rather than letting the organizer discover it in the log.
        whatsappEnabled: await getSetting("whatsappEnabled"),
        whatsappDisabledReason: WHATSAPP_DISABLED_REASON,
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
          // A row with no person is a GROUP BROADCAST (channel TELEGRAM) —
          // said in words, not left as a blank where a name belongs.
          person: entry.person
            ? `${entry.person.nameEnglishFirst} ${entry.person.nameEnglishLast ?? ""}`.trim()
            : "Group broadcast",
          personAmharic: entry.person?.nameAmharic ?? "",
          templateKey: entry.templateKey,
          body: entry.body,
          channel: entry.channel,
          toPhone: entry.toPhone,
          trigger: entry.trigger,
          status: entry.status,
          error: entry.error,
          createdAt: entry.createdAt,
        })),
        logPage,
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

    // META OWNS FIVE OF THESE SENTENCES (2.20, 2.11).
    //
    // WhatsApp sends the approved keys by ContentSid, so an edited body never
    // reaches a member — it only becomes what the PREVIEW shows, what the
    // MESSAGE LOG stores, and what the compose screen quotes. The organizer
    // would be reading his own wording everywhere while members received
    // Meta's, which is the precise inversion of "the system never speaks to a
    // member without the organizer knowing exactly what it said".
    //
    // Refused at the ACTION and not only in the editor, because the editor is
    // one caller and this is the boundary the record is written at.
    if (isApprovedTemplateKey(existing.key) && body !== APPROVED_TEMPLATES[existing.key].namedBody) {
      return { ok: false as const, error: approvedWordingRefusal(existing.key) };
    }

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
    } else if (key === "LATE_NOTICE_V4") {
      // The real figure when there is one. A member with nothing chaseable has
      // no week to name, so the preview says so rather than inventing one — and
      // the send would be refused by the gate for the same reason.
      const real = await lateNoticeExtrasForParticipation(input.participationId);
      if (real) {
        extras = real;
      } else {
        sampleNote =
          "This member has no closed unpaid week right now, so there is nothing to chase and nothing to name.";
      }
    } else if (
      key === "PARTIAL_CONFIRMED" ||
      key === "PARTIAL_COMPLETED" ||
      key === "PAYMENT_CONFIRMED_V4" ||
      key === "PAYMENT_CONFIRMED_WITH_PARTIAL"
    ) {
      // THESE EXIST ONLY AT THE MOMENT OF A RECEIPT, like the confirmation
      // above — there is no standing to read them off. The sample is LABELLED,
      // so the wording is checkable without any figure here being mistaken for
      // this member's own.
      const week =
        loaded.standing.weeks.find((w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue) ??
        loaded.standing.weeks[0] ??
        null;
      const own = week ? week.weekNumber - loaded.participation.startWeek + 1 : 1;
      const due = loaded.participation.weeklyAmount;
      const label = week
        ? weekLabelFull({ weekNumber: week.weekNumber, date: week.date }, loaded.participation.startWeek)
        : `week ${own}`;
      extras = {
        amountReceived: Math.round(due / 10),
        paymentBreakdown: label.replace(/ (.*)/, ``),
        partialWeekLabel: label,
        priorPaidOnWeek: Math.round(due / 10),
        stillDueOnWeek: week
          ? stillDueOnWeek(due - Math.round(due / 10), { weekNumber: week.weekNumber, date: week.date }, loaded.participation.startWeek)
          : ``,
      };
      sampleNote = "Preview uses a sample part payment of a tenth of one week.";
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
    } else if (key === "WHATSAPP_WELCOME") {
      // NO SAMPLE FACTS — every variable is this member's own or a setting.
      // What the note carries instead is the CONSEQUENCE, because it is the
      // only message here that creates an obligation rather than reporting one,
      // and reading the sentence gives no hint of that.
      sampleNote =
        (await welcomeBlockedReason(key)) ??
        "Sending this is what requires this member's signature — they read and sign their agreement the next time they sign in.";
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
    // THREE kinds of key are absent from MANUAL, for three different reasons —
    // the refusal must name the right one, or it misdirects: the broadcast is
    // not a payment confirmation, and telling its caller it "sends
    // automatically" is false twice over.
    return {
      ok: false as const,
      error:
        key === "GROUP_ANNOUNCEMENT"
          ? "The group announcement sends from its own card on this page — it is composed once for everyone, never picked per member or batched by type."
          : "Payment confirmations send automatically when a payment is recorded — they are not sent as a batch (2.20).",
    };
  }
  return { ok: true as const, key };
}

/**
 * The welcome's two platform-level refusals, read fresh.
 *
 * ASKED IN prepareBatch AS WELL AS IN THE SEND. deliver() refuses either way,
 * but as 27 separate skips discovered one row at a time after the organizer has
 * already pressed send — and the fix is one settings change he could have made
 * first. Refusing the whole batch up front is the same rule stated where it can
 * still be acted on.
 */
async function welcomeBlockedReason(key: MessageKey): Promise<string | null> {
  if (key !== "WHATSAPP_WELCOME") return null;
  // PLATFORM-WIDE ONLY. A per-person override cannot be expressed in one
  // sentence about a batch, and it does not need to be: `deliver()` asks the
  // same rule again with that member in hand, so a single blocked person is
  // skipped with their own reason rather than stopping the whole send.
  const check = welcomeSendCheck({
    portalUrl: portalUrlValue(await getSetting("portalUrl")),
    defaultPinFromPhone: await getSetting("defaultPinFromPhone"),
    pinLoginEnabled: await getSetting("pinLoginEnabled"),
  });
  return check.ok ? null : check.reason;
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

    const welcomeBlocked = await welcomeBlockedReason(key);
    if (welcomeBlocked) return { ok: false as const, error: welcomeBlocked };

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
      const lateWeeks = loaded.standing.weeks.filter((w) => isChasedStatus(w.status));
      const relevant =
        key === "BEHIND_NOTICE"
          ? loaded.facts.weeksBehind > 0
          : key === "LATE_NOTICE" || key === "LATE_NOTICE_V4"
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

      // THE PREVIEW RENDERS FROM WHAT THE SEND WILL USE. Composed here rather
      // than left empty: an unsupplied required extra renders as the NO_VALUE
      // dash, so the organizer would read "— is still due" and then send a real
      // figure. A preview that differs from the send is worse than none.
      const rowExtras =
        key === "LATE_NOTICE_V4"
          ? ((await lateNoticeExtrasForParticipation(p.id)) ?? {})
          : (winners?.get(p.id) ?? {});

      rows.push({
        participationId: p.id,
        nameAmharic: p.person.nameAmharic,
        nameEnglish: `${p.person.nameEnglishFirst} ${p.person.nameEnglishLast ?? ""}`.trim(),
        phone: p.person.phone,
        rendered: renderTemplate(
          body,
          placeholderValues(loaded.facts, rowExtras),
        ),
        // THE WELCOME ARRIVES UNTICKED, and it is the only type that does.
        //
        // Sending it is not a statement about a member's money — it is what
        // REQUIRES their signature and puts the agreement gate in front of
        // their portal. Every other batch pre-ticks because sending to one more
        // person is a message they can ignore; pre-ticking this one would make
        // "prepare, glance, send" gate all 27 existing members against a
        // document they were never expecting, and there is no un-send.
        checked: blocked === null && key !== "WHATSAPP_WELCOME",
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
                : key === "WHATSAPP_WELCOME"
                  ? "Every member still contributing. Nobody is ticked: sending the welcome is what requires that member's signature, and they will have to read and sign their agreement the next time they sign in. Tick only the people you are welcoming."
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

    // Re-asked at send time, not carried from prepare: the settings can change
    // between opening a batch and pressing send, and the browser is never
    // trusted for a decision (2.21). deliver() refuses again per member — this
    // is the one that refuses the whole batch with the actionable sentence.
    const welcomeBlocked = await welcomeBlockedReason(key);
    if (welcomeBlocked) return { ok: false as const, error: welcomeBlocked };

    const cycle = await prisma.cycle.findFirst({ where: { status: "ACTIVE" } });
    const winners =
      key === "WINNER_ANNOUNCEMENT" && cycle
        ? await winnerExtrasByParticipation(cycle.id)
        : null;

    // A WINNER WHO IS NO LONGER THE WINNER MUST NOT BE MESSAGED.
    //
    // The batch is prepared against the latest drawn week, then sent later. In
    // between, the week can be drawn again, or the winner removed or moved —
    // the exact operations this audit came from. sendBatch recomputed the
    // extras from live state, the prepared participation was no longer in the
    // map, and `?? {}` filled the gap: the member received a real, billed,
    // logged WhatsApp message reading "you receive this week — week 12. Your
    // payout is —." The week was not even the drawn one; it fell back to the
    // current cycle week.
    //
    // Refuse the whole batch rather than skipping the stale recipients: the
    // organizer previewed a specific set of messages, and silently sending a
    // subset is its own surprise.
    if (winners) {
      const stale = input.participationIds.filter((id) => !winners.has(id));
      if (stale.length > 0) {
        return {
          ok: false as const,
          error:
            `${stale.length} of the ${input.participationIds.length} selected ` +
            `${stale.length === 1 ? "member is" : "members are"} no longer a winner of the ` +
            `week this batch was prepared for — the draw has changed since you opened it. ` +
            `Nothing was sent. Close this and open the winner batch again to see the ` +
            `current winners.`,
        };
      }
    }

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
        // LATE_NOTICE_V4 composes PER MEMBER, because its sentence names one
        // member's own week and that week's own remainder — there is no batch
        // map to precompute, and a shared figure would be wrong for everyone
        // but one of them.
        extras:
          key === "LATE_NOTICE_V4"
            ? ((await lateNoticeExtrasForParticipation(participationId)) ?? {})
            : (winners?.get(participationId) ?? {}),
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

/**
 * POST ONE ANNOUNCEMENT TO THE TELEGRAM GROUP (D-10, D-37 — Cycle-2 build,
 * feature D). One bot, one chat, one message to everyone; manual only.
 *
 * THE LOG FOLLOWS THE ENGINE'S RULE. An attempt that reached Telegram is
 * recorded — SENT on its ok (Telegram's ok means the message IS in the chat,
 * unlike Twilio's "queued"), FAILED with Telegram's own description
 * otherwise. A refusal BEFORE the wire (no bot configured, empty, too long)
 * writes no row: a message that was never attempted did not fail at the
 * provider, and the organizer reads the reason at the control instead.
 *
 * The row has NO person — a group message is not part of anyone's personal
 * history — and `toPhone` carries the group chat id, which is the address the
 * message actually went to.
 */
export async function sendGroupAnnouncement(input: { text: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const result = await sendTelegramGroupMessage(input.text);
    if (!result.ok && !result.attempted) {
      return { ok: false as const, error: result.error };
    }

    await prisma.messageLog.create({
      data: {
        personId: null,
        templateId: null,
        templateKey: "TELEGRAM_BROADCAST",
        body: input.text.trim(),
        channel: "TELEGRAM",
        toPhone: process.env.TELEGRAM_GROUP_CHAT_ID ?? "",
        trigger: "MANUAL",
        status: result.ok ? "SENT" : "FAILED",
        error: result.ok ? null : result.error,
      },
    });
    revalidatePath("/admin/messages");

    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const };
  } catch (e) {
    console.error("sendGroupAnnouncement failed:", e);
    return { ok: false as const, error: `Could not send. ${errorMessage(e)}` };
  }
}

/**
 * THE WHATSAPP SIDE OF THE ANNOUNCEMENT CARD (v2 set, 13 Aug 2026).
 *
 * GROUP_ANNOUNCEMENT is a broadcast sent PER MEMBER, individually — there is
 * no group chat on WhatsApp. The organizer composes once; every ACTIVE member
 * of the running cycle gets their own send through the SAME `sendStatement`
 * path as every statement, so the hardship flag, the missing-phone refusal,
 * the channel switch and the registry gate all apply per member, and every
 * outcome lands in MessageLog — one row each, exactly like a batch.
 *
 * The text rides as a REQUIRED extra: `buildContentVariables` refuses an
 * empty one before the network, because Twilio's answer to a missing
 * variable is the approval SAMPLE delivered as fact.
 */
export async function broadcastAnnouncement(input: { text: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const text = input.text?.trim();
    if (!text) return { ok: false as const, error: "There is nothing to send — the announcement is empty." };
    if (text.length > 1000) {
      return {
        ok: false as const,
        error: "Keep the announcement under 1,000 characters — WhatsApp templates carry a sentence, not a page.",
      };
    }
    // META'S PARAMETER RULES, refused where the organizer can still act. A
    // template body parameter may not carry newlines, tabs, or runs of four
    // or more spaces: Twilio ACCEPTS the send and Meta kills it moments later
    // — and with no public status callback every log row would sit ACCEPTED
    // while nothing was delivered. Formatted text belongs on the Telegram
    // side, which posts it verbatim.
    if (/[\n\r\t]| {4,}/.test(text)) {
      return {
        ok: false as const,
        error:
          "WhatsApp delivers the announcement through a template, and Meta refuses template text with line breaks, tabs, or long runs of spaces — silently, after the send looks accepted. Make it one line for WhatsApp, or post the formatted version to Telegram.",
      };
    }
    // THE ORGANIZER'S CHANNEL SWITCH, asked once up front. deliver() refuses
    // it anyway, but as N identical skips counted after the press — and the
    // count alone would invite a wrong guess at the reason (2.20: refuse
    // where the fix can still be made).
    if (!(await getSetting("whatsappEnabled"))) {
      return {
        ok: false as const,
        error: "WhatsApp sending is switched off (Settings → Messaging), so no member would receive it.",
      };
    }

    const cycle = await prisma.cycle.findFirst({ where: { status: "ACTIVE" } });
    if (!cycle) return { ok: false as const, error: "No cycle is running — there is nobody to announce to." };
    const participations = await prisma.participation.findMany({
      where: { cycleId: cycle.id, status: "ACTIVE" },
      select: { id: true, person: { select: { nameEnglishFirst: true } } },
    });

    // Meta caps a RENDERED template body at 1,024 characters, and the render
    // is "Hi {name}, a message from your Equb: {text}" — so the real budget
    // depends on the longest recipient name. Checked against it here rather
    // than discovered as a silent per-member delivery failure.
    const longestName = participations.reduce(
      (m, p) => Math.max(m, p.person.nameEnglishFirst.length),
      0,
    );
    const renderedFixed = "Hi , a message from your Equb: ".length;
    const renderedMax = renderedFixed + longestName + text.length;
    if (renderedMax > 1024) {
      return {
        ok: false as const,
        error: `Shorten the announcement by ${renderedMax - 1024} characters — WhatsApp caps the delivered message at 1,024, and the longest member name uses ${longestName} of them.`,
      };
    }

    // SEQUENTIAL, deliberately: 27 sends in a burst is how a provider rate
    // limit turns half a broadcast into FAILED rows. The engine re-derives
    // per member and refuses per member; this loop only counts.
    let left = 0;
    let skipped = 0;
    let failed = 0;
    for (const p of participations) {
      const outcome = await sendStatement({
        participationId: p.id,
        key: "GROUP_ANNOUNCEMENT",
        trigger: "MANUAL",
        extras: { announcementText: text },
      });
      if (outcome.status === "SENT" || outcome.status === "ACCEPTED") left++;
      else if (outcome.status === "SKIPPED") skipped++;
      else failed++;
    }

    revalidatePath("/admin/messages");
    return { ok: true as const, data: { left, skipped, failed, total: participations.length } };
  } catch (e) {
    console.error("broadcastAnnouncement failed:", e);
    return { ok: false as const, error: `Could not send. ${errorMessage(e)}` };
  }
}

// ————————————— THE QUEUE: messages prepared, waiting for him —————————————
//
// 2.20's preview, for the messages a payment originates. The four phase-4
// payment types default to manual, so a partial notice is composed the moment
// the money lands and then WAITS — with its exact rendered sentence — until the
// organizer reads it and presses send. See lib/payment-confirmation.ts.

/** Everything waiting, oldest first. */
export async function listQueued() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    return { ok: true as const, data: { queued: await listQueuedMessages() } };
  } catch (e) {
    console.error("listQueued failed:", e);
    return { ok: false as const, error: `Could not load the queue. ${errorMessage(e)}` };
  }
}

/**
 * Send one that was waiting — the organizer has read it and approved it.
 *
 * PRESENTATION MODE REFUSES, like every other surface that puts a member's
 * money on screen (2.4): the queued body names an amount and a week.
 */
export async function sendQueued(input: { id: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const outcome = await sendQueuedMessage(input.id);
    revalidatePath("/admin/messages");
    return {
      ok: true as const,
      data: {
        status: outcome.status,
        // Asked as "is there something wrong to say" — SENT, ACCEPTED and
        // QUEUED all have nothing to report, and only the last of those cannot
        // happen here (a send never re-queues).
        reason:
          outcome.status === "SKIPPED"
            ? outcome.reason
            : outcome.status === "FAILED"
              ? outcome.error
              : null,
      },
    };
  } catch (e) {
    console.error("sendQueued failed:", e);
    return { ok: false as const, error: `Could not send it. ${errorMessage(e)}` };
  }
}

/**
 * Decide NOT to send one.
 *
 * NO MessageLog ROW IS WRITTEN, because nothing was sent — the log answers what
 * left, and a discarded draft never left. The audit entry below is where the
 * decision is recorded, which is the right place for it: this is the
 * organizer's judgement, not the platform's action.
 */
export async function discardQueued(input: { id: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const row = await prisma.queuedMessage.findUnique({
      where: { id: input.id },
      include: { person: { select: { nameEnglishFirst: true } } },
    });
    if (!row) return { ok: false as const, error: "That message is no longer queued." };
    await prisma.$transaction(async (tx) => {
      await tx.queuedMessage.delete({ where: { id: input.id } });
      await logAudit(tx, {
        entity: "QueuedMessage",
        entityId: input.id,
        action: "delete",
        summary: `Discarded the ${row.templateKey} prepared for ${row.person.nameEnglishFirst}. It was never sent.`,
        before: { templateKey: row.templateKey, body: row.body, toPhone: row.toPhone },
      });
    });
    revalidatePath("/admin/messages");
    return { ok: true as const, data: { discarded: true } };
  } catch (e) {
    console.error("discardQueued failed:", e);
    return { ok: false as const, error: `Could not discard it. ${errorMessage(e)}` };
  }
}

/**
 * Ask Twilio what actually happened to the messages still sitting at ACCEPTED.
 *
 * WHY THE ORGANIZER NEEDS A BUTTON FOR THIS. ACCEPTED means Twilio has the
 * message and has confirmed nothing, and it is supposed to be resolved by the
 * StatusCallback — which is only sent when APP_BASE_URL is configured, and it
 * is not. So every send comes to rest at ACCEPTED and stays there: on
 * 15 Aug 2026, 75 of 81 rows disagreed with Twilio's own records, including one
 * that Meta had dropped entirely. 2.23 says nothing may require a developer, so
 * the reconciliation the script does lives here too.
 */
export async function reconcileDeliveries() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const result = await reconcileAcceptedStatuses();
    revalidatePath("/admin/messages");
    return { ok: true as const, data: result };
  } catch (e) {
    console.error("reconcileDeliveries failed:", e);
    return { ok: false as const, error: `Could not check with Twilio. ${errorMessage(e)}` };
  }
}
