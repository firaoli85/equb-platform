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
import { messagingSubject } from "@/lib/messaging-subject";
import { CAPS } from "@/lib/paging";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { portalUrlValue, welcomeSendCheck } from "@/lib/welcome-send";
import { winnerExtrasForParticipation } from "@/lib/winner-extras";
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
  WHATSAPP_WELCOME: "Welcome message",
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
      select: {
        id: true,
        nameEnglishFirst: true,
        phone: true,
        noMessages: true,
        // Their own PIN override — the welcome describes signing in with a
        // PIN, and this member may be the one person for whom that is false.
        pinLoginAllowed: true,
      },
    });
    if (!person) return { ok: false as const, error: "Person not found." };

    // WHAT THIS PERSON'S STATEMENTS ARE ABOUT — one question, one answer.
    //
    // THE DEFECT (audit gap 8). This read ONE row — an ACTIVE participation in
    // an ACTIVE cycle — and spent it on two facts that then contradicted each
    // other: `cycleClosed: active === null` and `participationId: active?.id`.
    // Mutually exclusive by construction, so the closing statement 2.18
    // requires for every member at cycle end could not be sent from a profile
    // in EITHER state — refused as "the cycle is still running" while it ran,
    // and left with no participationId and no preview the moment it closed.
    //
    // DRAFT cycles are excluded in SQL: nothing has happened in one, so there
    // is no position to state. Everything else is decided by the pure rule in
    // lib/messaging-subject.ts, which returns the id, the participation state
    // and the CYCLE's status TOGETHER — the only way they cannot disagree.
    //
    // Unbounded on purpose and bounded by the domain: ONE ROW PER CYCLE THIS
    // PERSON WAS EVER IN, and cycles are a handful, ever (the same reason
    // app/actions/member-history.ts is exempt in lib/bounded-queries.test.ts).
    // Taking the "first few" would be worse than unbounded — it could drop the
    // running cycle and silently answer about the wrong one.
    const subject = messagingSubject(
      await prisma.participation.findMany({
        where: { personId: person.id, cycle: { status: { in: ["ACTIVE", "CLOSED"] } } },
        select: {
          id: true,
          status: true,
          cycle: { select: { status: true, closedAt: true } },
        },
      }),
    );
    const participationId = subject.participationId;

    const [history, historyTotal] = await Promise.all([
      prisma.messageLog.findMany({
        where: { personId: person.id },
        orderBy: { createdAt: "desc" },
        take: CAPS.memberMessages,
      }),
      prisma.messageLog.count({ where: { personId: person.id } }),
    ]);

    // STANDING IS LOADED FOR A CLOSED CYCLE TOO, and that is the second half of
    // the fix. `loaded` was gated on the ACTIVE participation, so once the
    // cycle closed there was no preview to read either — the organizer would
    // have been pressing send on text he had never seen (2.20). A closed
    // cycle's rows survive until the clean delete (2.9), so the same derivation
    // still produces the same final figures.
    const loaded = participationId ? await loadStandingFacts(participationId) : null;

    // Whether any of their numbers has been drawn — what makes a winner
    // announcement have something to say.
    const drawn = participationId
      ? await prisma.payout.findFirst({
          where: { luckyNumber: { participationId } },
          select: { draw: { select: { week: { select: { weekNumber: true } } } } },
        })
      : null;

    // THE FACTS THE WINNER ANNOUNCEMENT NEEDS, derived through the SAME
    // helper the batch uses. Both the preview below and the send re-derive
    // from here, so what the organizer reads is what the member receives.
    const winnerExtras = participationId
      ? await winnerExtrasForParticipation(prisma, participationId)
      : null;

    const types = applicableTypes({
      name: person.nameEnglishFirst,
      weeksBehind: loaded?.standing.weeksBehind ?? 0,
      amountOutstanding: loaded?.standing.amountOutstanding ?? 0,
      drawnWeek: drawn?.draw?.week.weekNumber ?? null,
      // BOTH READ OFF THE SAME RESOLUTION. `cycleClosed` is the CYCLE's status
      // and nothing else (2.9); `participation` is whether there is a live
      // participation behind the id below. Deriving either from the other is
      // the defect this action shipped.
      cycleClosed: subject.cycleClosed,
      participation: subject.participation,
      noMessages: person.noMessages,
      hasPhone: (person.phone?.trim() ?? "") !== "",
    });

    // WHAT THIS MEMBER'S STATE CANNOT ANSWER FOR.
    //
    // `applicableTypes` is pure and decides from the member alone, which is
    // right — but the welcome has two blocks that are about the PLATFORM: no
    // sign-in address, and the phone-digit PIN switched off. Both would produce
    // a message that is wrong about how to get in, and a member who follows a
    // wrong instruction concludes the account does not work.
    //
    // Applied here rather than passed into applicableTypes so the pure function
    // keeps one subject, and read through the same rule the send path uses
    // (lib/welcome-send.ts) so the greyed button and the refusal say the same
    // thing.
    const welcomeCheck = welcomeSendCheck({
      portalUrl: portalUrlValue(await getSetting("portalUrl")),
      defaultPinFromPhone: await getSetting("defaultPinFromPhone"),
      pinLoginEnabled: await getSetting("pinLoginEnabled"),
      memberPinLoginAllowed: person.pinLoginAllowed,
      memberName: person.nameEnglishFirst,
    });
    const welcomeBlocked = welcomeCheck.ok ? null : welcomeCheck.reason;

    // The preview is rendered from the SAME facts the send will use (2.21).
    // It is built for every applicable type up front rather than on demand,
    // because the organizer's question is "which of these should I send", and
    // that is answered by reading them, not by clicking through them.
    const templates = loaded ? await loadTemplates() : null;
    const withPreviews = types.map((t) => {
      // The platform-level block, applied only where it applies. It replaces
      // the reason rather than sitting beside it, because a member reading two
      // reasons has to work out which one is stopping the send.
      const blocked = t.applicable && t.key === "WHATSAPP_WELCOME" ? welcomeBlocked : null;
      return {
        key: t.key,
        label: LABELS[t.key] ?? t.key,
        applicable: t.applicable && blocked === null,
        reason: blocked ?? t.reason,
        chasing: t.chasing,
        // RENDERED EVEN WHEN BLOCKED, on purpose: the organizer's next question
        // after "why not" is "what would it have said", and the preview is
        // where the empty address shows itself as a hole in the sentence.
        preview:
          t.applicable && loaded && templates
            ? renderMessage(
                t.key,
                loaded.facts,
                t.key === "WINNER_ANNOUNCEMENT" ? (winnerExtras ?? {}) : {},
                // The organizer's OWN wording, not the default — a preview of
                // text he did not write is a preview of the wrong message.
                templates.get(t.key)?.body,
              )
            : null,
      };
    });

    return {
      ok: true as const,
      data: {
        // The id and the applicability came out of ONE resolution, so an
        // applicable type without an id to send it with is no longer
        // constructible — the property lib/member-messaging-wiring.test.ts
        // pins, and the one nothing was checking.
        participationId,
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

    // THE DEFECT THAT REACHED A MEMBER.
    //
    // This called sendStatement with NO extras. For a winner announcement that
    // meant {payoutAmount} rendered as the NO_VALUE dash — "your Equb payout
    // for week 12 is —" — and {week} silently fell back to the CURRENT cycle
    // week instead of the week actually drawn, which happened to look right.
    //
    // Derived here through the same helper the batch and the preview use, so
    // the figure the organizer read before pressing send is the figure that
    // leaves. buildContentVariables now refuses a dashed money placeholder as
    // well, so even a future caller that forgets this cannot deliver the hole.
    const extras =
      input.key === "WINNER_ANNOUNCEMENT"
        ? ((await winnerExtrasForParticipation(prisma, input.participationId)) ?? undefined)
        : undefined;

    const outcome = await sendStatement({
      participationId: input.participationId,
      key: input.key,
      trigger: "MANUAL",
      extras,
    });

    // A SKIP IS NOT A FAILURE AND IS NOT A SUCCESS. The organizer pressed
    // send and nothing left; he has to be told which, and why, in the words
    // the engine used — not a generic "done".
    return {
      ok: true as const,
      data: {
        status: outcome.status,
        // ACCEPTED carries no reason: nothing went wrong, Twilio simply has
        // not said anything yet. The UI words that state for itself.
        reason:
          outcome.status === "SENT" || outcome.status === "ACCEPTED"
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
