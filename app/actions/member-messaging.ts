"use server";

import { requireAdmin } from "@/lib/auth";
import { errorMessage } from "@/lib/action-result";
import {
  loadStandingFacts,
  loadTemplates,
  sendStatement,
  STATEMENTS_DELIVERABLE,
} from "@/lib/messaging-engine";
import { WHATSAPP_STATEMENTS_BLOCKED_REASON } from "@/lib/setting-defaults";
import { applicableTypes, isMessageKey, renderMessage, type MessageKey } from "@/lib/messages";
import { CAPS } from "@/lib/paging";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

// SEND ONE MESSAGE TO ONE MEMBER, FROM WHERE YOU ARE.
//
// The batch composer sends one type to everyone it applies to, and that is
// still the weekly job. The case it could not serve is the common one: the
// organizer is on Tsion's profile, sees she is six weeks behind, and wants to
// send HER a notice — which meant leaving her page, opening Messages, finding
// her in a batch and unchecking twenty-six people.
//
// EVERY GATE IS INHERITED, NOT REIMPLEMENTED. The send goes through
// `sendStatement`, which is the same path the batch uses, so the hardship
// flag, the opt-out, the automatic-vs-manual rule, the channel switch and the
// statements block are enforced by the same code in the same order. A second
// implementation of "may this leave" is how two screens end up disagreeing
// about whether a member can be messaged.

export type MemberMessagingView = {
  participationId: string | null;
  /** One entry per manual type, with the reason when it does not apply. */
  types: {
    key: MessageKey;
    label: string;
    applicable: boolean;
    reason: string | null;
    chasing: boolean;
    /** The real rendered text, with their real figures (2.20/2.21). */
    preview: string | null;
  }[];
  /** Why nothing can leave at all right now, or null. */
  blockedReason: string | null;
  /** What has already been sent to this person, newest first. */
  history: {
    id: string;
    templateKey: string;
    body: string;
    trigger: string;
    status: string;
    error: string | null;
    createdAt: string;
  }[];
  historyTotal: number;
};

const LABELS: Record<string, string> = {
  BEHIND_NOTICE: "Behind notice",
  LATE_NOTICE: "Late notice",
  WINNER_ANNOUNCEMENT: "Winner announcement",
  CYCLE_CLOSING_STATEMENT: "Closing statement",
};

export async function getMemberMessaging(input: { personId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }

    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: { id: true, nameEnglishFirst: true, phone: true, noMessages: true },
    });
    if (!person) return { ok: false as const, error: "Person not found." };

    const active = await prisma.participation.findFirst({
      where: { personId: person.id, status: "ACTIVE", cycle: { status: "ACTIVE" } },
      select: { id: true, cycle: { select: { status: true } } },
    });

    const [history, historyTotal] = await Promise.all([
      prisma.messageLog.findMany({
        where: { personId: person.id },
        orderBy: { createdAt: "desc" },
        take: CAPS.memberMessages,
      }),
      prisma.messageLog.count({ where: { personId: person.id } }),
    ]);

    const loaded = active ? await loadStandingFacts(active.id) : null;

    // Whether any of their numbers has been drawn — what makes a winner
    // announcement have something to say.
    const drawn = active
      ? await prisma.payout.findFirst({
          where: { luckyNumber: { participationId: active.id } },
          select: { draw: { select: { week: { select: { weekNumber: true } } } } },
        })
      : null;

    const types = applicableTypes({
      name: person.nameEnglishFirst,
      weeksBehind: loaded?.standing.weeksBehind ?? 0,
      amountOutstanding: loaded?.standing.amountOutstanding ?? 0,
      drawnWeek: drawn?.draw?.week.weekNumber ?? null,
      // The closing statement belongs to a cycle that has ended. A member with
      // no active participation has no live cycle to close.
      cycleClosed: active === null,
      noMessages: person.noMessages,
      hasPhone: (person.phone?.trim() ?? "") !== "",
    });

    // The preview is rendered from the SAME facts the send will use (2.21).
    // It is built for every applicable type up front rather than on demand,
    // because the organizer's question is "which of these should I send", and
    // that is answered by reading them, not by clicking through them.
    const templates = loaded ? await loadTemplates() : null;
    const withPreviews = types.map((t) => ({
      key: t.key,
      label: LABELS[t.key] ?? t.key,
      applicable: t.applicable,
      reason: t.reason,
      chasing: t.chasing,
      preview:
        t.applicable && loaded && templates
          ? renderMessage(
              t.key,
              loaded.facts,
              t.key === "WINNER_ANNOUNCEMENT"
                ? { drawnWeek: drawn?.draw?.week.weekNumber ?? undefined }
                : {},
              // The organizer's OWN wording, not the default — a preview of
              // text he did not write is a preview of the wrong message.
              templates.get(t.key)?.body,
            )
          : null,
    }));

    return {
      ok: true as const,
      data: {
        participationId: active?.id ?? null,
        types: withPreviews,
        // Stated once, at the top, rather than repeated on every button.
        blockedReason: STATEMENTS_DELIVERABLE ? null : WHATSAPP_STATEMENTS_BLOCKED_REASON,
        history: history.map((h) => ({
          id: h.id,
          templateKey: h.templateKey,
          body: h.body,
          trigger: h.trigger,
          status: h.status,
          error: h.error,
          createdAt: h.createdAt.toISOString(),
        })),
        historyTotal,
      } satisfies MemberMessagingView,
    };
  } catch (e) {
    console.error("getMemberMessaging failed:", e);
    return { ok: false as const, error: `Could not load messaging. ${errorMessage(e)}` };
  }
}

/**
 * Send one statement to one member.
 *
 * Everything re-derives HERE at send time (2.21). The preview showed the same
 * thing, and the send never trusts the browser: the key is re-validated, the
 * participation is re-read, and `sendStatement` re-renders from fresh facts
 * behind the same gate the batch goes through.
 */
export async function sendToMember(input: { participationId: string; key: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    if (!isMessageKey(input.key)) {
      return { ok: false as const, error: "Unknown message type." };
    }
    // The automatic types fire from their own events and are never sent by
    // hand (2.20) — the same rule the batch enforces.
    if (input.key === "PAYMENT_CONFIRMED" || input.key === "LOCKOUT_NOTICE") {
      return {
        ok: false as const,
        error: "That message sends itself when its event happens — it cannot be sent by hand.",
      };
    }

    const outcome = await sendStatement({
      participationId: input.participationId,
      key: input.key,
      trigger: "MANUAL",
    });

    // A SKIP IS NOT A FAILURE AND IS NOT A SUCCESS. The organizer pressed
    // send and nothing left; he has to be told which, and why, in the words
    // the engine used — not a generic "done".
    return {
      ok: true as const,
      data: {
        status: outcome.status,
        reason:
          outcome.status === "SENT"
            ? null
            : outcome.status === "SKIPPED"
              ? outcome.reason
              : outcome.error,
      },
    };
  } catch (e) {
    console.error("sendToMember failed:", e);
    return { ok: false as const, error: `Could not send. ${errorMessage(e)}` };
  }
}
