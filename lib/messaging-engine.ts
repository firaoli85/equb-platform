// The server half of messaging: load DERIVED standing, apply the pure send
// gate, render the organizer's template, deliver over WhatsApp, and write
// the log row. Lives outside app/actions on purpose — these helpers are NOT
// client-callable server actions; recordPayment and the gated messaging
// actions call them from the server side only.
//
// Everything a message says is derived at send time (2.21): standing comes
// from computeStanding over the stored receipts, exactly like the member
// page and the admin standing views — never from anything cached.

import {
  DEFAULT_TEMPLATES,
  MESSAGE_KEYS,
  placeholderValues,
  renderTemplate,
  sendDecision,
  type MessageExtras,
  type MessageKey,
  type SendTrigger,
  type StandingFacts,
} from "./messages";
import { resolveWeekDate, storedWeekDates } from "./commitment";
import { calculateFinishWeek, currentWeekNumber } from "./money";
import { toE164 } from "./phone";
import { prisma } from "./prisma";
import {
  getSetting,
  WHATSAPP_DISABLED_REASON,
  WHATSAPP_STATEMENTS_BLOCKED_REASON,
} from "./settings";

import { computeStanding, pinnedMapFromEvents, type Standing } from "./standing";
import { sendWhatsAppMessage } from "./whatsapp";
import { loggedStatusFor } from "./twilio-status";
import {
  APPROVED_TEMPLATES,
  buildContentVariables,
  checkRequiredExtras,
  isApprovedTemplateKey,
} from "./whatsapp-templates";

/**
 * Can a STATEMENT reach a member over WhatsApp? YES, as of this build.
 *
 * Meta approved five Content templates on 7 August 2026 under category UTILITY
 * (lib/whatsapp-templates.ts). A template needs no 24-hour service window,
 * which is the whole reason this can now be true: freeform never could be,
 * because this account has ONE inbound message in its entire history
 * (19 May 2026), so no window is open for anyone, ever.
 *
 * THIS IS NOT THE ORGANIZER'S CONTROL. It records whether approved templates
 * exist to carry a statement at all. The live control is
 * getSetting("whatsappEnabled") — checked immediately after this in deliver()
 * — which the organizer owns from /admin/settings and can turn off at any
 * moment, and which turning off stops every statement instantly.
 *
 * Set back to false if the templates are ever revoked or the registry emptied:
 * with no ContentSid, a send would carry Twilio's approval SAMPLES and deliver
 * invented figures to real members.
 *
 * Annotated `: boolean` deliberately — without it TypeScript narrows the
 * literal and marks the downstream path unreachable.
 */
export const STATEMENTS_DELIVERABLE: boolean = true;

/**
 * Make sure every message type has its editable row (idempotent — the
 * organizer's edits are never overwritten; this only fills gaps).
 */
export async function ensureMessageTemplates(): Promise<void> {
  const existing = await prisma.messageTemplate.findMany({ select: { key: true } });
  const have = new Set(existing.map((t) => t.key));
  const missing = MESSAGE_KEYS.filter((k) => !have.has(k));
  if (missing.length === 0) return;
  await prisma.messageTemplate.createMany({
    data: missing.map((key) => ({
      key,
      name: DEFAULT_TEMPLATES[key].name,
      body: DEFAULT_TEMPLATES[key].body,
    })),
    skipDuplicates: true,
  });
}

export type LoadedFacts = {
  participation: NonNullable<
    Awaited<ReturnType<typeof loadParticipationForFacts>>
  >;
  standing: Standing;
  facts: StandingFacts;
};

function loadParticipationForFacts(participationId: string) {
  return prisma.participation.findUnique({
    where: { id: participationId },
    include: {
      person: true,
      payments: true,
      // Payout settlements stay pinned to their drawn week (never fungible).
      paymentEvents: {
        where: { pinnedWeekId: { not: null } },
        select: { amount: true, pinnedWeek: { select: { weekNumber: true } } },
      },
      cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
    },
  });
}

/**
 * A member's current facts for rendering — the same derivation as
 * getMemberStanding (2.14: stored receipts in, current truth out).
 */
export async function loadStandingFacts(participationId: string): Promise<LoadedFacts | null> {
  const participation = await loadParticipationForFacts(participationId);
  if (!participation) return null;

  const today = new Date();
  const cycleWeek = currentWeekNumber(participation.cycle.startDate, today);
  const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
  const paymentByWeekId = new Map(participation.payments.map((p) => [p.weekId, p]));

  const standing = computeStanding({
    weeklyAmount: participation.weeklyAmount,
    startWeek: participation.startWeek,
    weeksCommitted: participation.weeksCommitted,
    cycleWeek,
    today,
    windowWeeks: participation.cycle.weeks
      .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
      .map((w) => {
        const payment = paymentByWeekId.get(w.id) ?? null;
        return {
          weekNumber: w.weekNumber,
          date: w.date,
          amountDue: participation.weeklyAmount,
          storedPaid: payment?.amountPaid ?? 0,
          isDeferred: payment?.isDeferred ?? false,
          isSkipped: w.isSkipped,
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

  const facts: StandingFacts = {
    name: participation.person.nameEnglishFirst,
    weeklyAmount: participation.weeklyAmount,
    weeksCommitted: participation.weeksCommitted,
    currentCycleWeek: cycleWeek,
    finishWeek: standing.finishWeek,
    // 2.22: a statement states the member's own finish DATE, not just a week.
    // 2.14: a statement quotes the day that actually belonged to that week.
    finishDate:
      resolveWeekDate({
        weekNumber: standing.finishWeek,
        stored: storedWeekDates(participation.cycle.weeks),
        cycleStartDate: participation.cycle.startDate,
      })?.date ?? null,
    weeksCredited: standing.weeksCredited,
    weeksBehind: standing.weeksBehind,
    amountOutstanding: standing.amountOutstanding,
    totalPaid: standing.totalPaid,
    lastPaymentWeek: standing.lastPaymentWeek,
    weeks: standing.weeks.map((w) => ({ weekNumber: w.weekNumber, status: w.status })),
  };

  return { participation, standing, facts };
}

/** The organizer's current wording for every type, keyed. Seeds gaps first. */
export async function loadTemplates() {
  await ensureMessageTemplates();
  const rows = await prisma.messageTemplate.findMany();
  return new Map(rows.map((t) => [t.key, t]));
}

export type SendOutcome =
  /** Twilio CONFIRMED delivery. Never written for a mere acceptance. */
  | { status: "SENT"; body: string }
  /**
   * Twilio has it and has confirmed nothing. The ordinary outcome of a send,
   * and the one the UI must not describe as delivered — a status callback
   * decides its fate later, or nothing ever does when no public APP_BASE_URL
   * is configured.
   */
  | { status: "ACCEPTED"; body: string }
  | { status: "FAILED"; body: string; error: string }
  | { status: "SKIPPED"; reason: string };

/**
 * The one path a message leaves through: gate (pure, tested) → render from
 * the supplied facts → deliver → log the EXACT body with the provider's
 * answer. Never throws; a failure is an honest FAILED outcome in the log.
 */
async function deliver(input: {
  person: { id: string; phone: string | null; noMessages: boolean };
  facts: StandingFacts;
  key: MessageKey;
  trigger: SendTrigger;
  extras?: MessageExtras;
}): Promise<SendOutcome> {
  const { person } = input;
  const decision = sendDecision({
    key: input.key,
    trigger: input.trigger,
    noMessages: person.noMessages,
    hasPhone: (person.phone?.trim() ?? "") !== "",
    // The derived weeks let the gate leave deferred members out of the
    // chasing types — the debt stays on every statement either way.
    weeks: input.facts.weeks,
  });
  if (!decision.send) return { status: "SKIPPED", reason: decision.reason };

  // Whether statements can be delivered at all. Checked before the switch
  // because it is not the same question: the switch is the organizer's choice
  // about the channel, this is whether Meta-approved templates exist to carry
  // the message. A skip HERE writes no MessageLog row, which is right — a
  // message that was never attempted did not FAIL at the provider.
  if (!STATEMENTS_DELIVERABLE) {
    return { status: "SKIPPED", reason: WHATSAPP_STATEMENTS_BLOCKED_REASON };
  }

  // The organizer's own switch, checked second: by here the message COULD be
  // delivered, and this is the choice about whether to.
  if (!(await getSetting("whatsappEnabled"))) {
    return { status: "SKIPPED", reason: WHATSAPP_DISABLED_REASON };
  }

  // ————— THE EXTRAS BOUNDARY — checked BEFORE anything renders —————
  //
  // This is the last moment the evidence still exists.
  //
  // `placeholderValues` resolves {week} as
  // `drawnWeek ?? lastCovered ?? standing.currentCycleWeek`. A caller that
  // omits `drawnWeek` therefore does not produce a blank for a later guard to
  // catch — it produces a PLAUSIBLE WRONG NUMBER. That is the invisible half
  // of the message delivered on 8 Aug 2026: "your Equb payout for week 12"
  // named the member's current week, not the week drawn, and read as correct
  // only because the two coincided. One line later there is nothing left to
  // detect, because "12" is a perfectly valid string.
  //
  // The money-sentinel refusal in buildContentVariables STAYS. Two nets at
  // two layers is not duplication here: this one catches a caller that forgot
  // to supply a fact, and that one catches a fact that arrived empty. Neither
  // can see the other's failure.
  if (isApprovedTemplateKey(input.key)) {
    const required = checkRequiredExtras(input.key, input.extras);
    if (!required.ok) {
      console.error(`[statement] ${required.error}`);
      // Logged like any other FAILED — a failure the organizer is shown but
      // cannot find in the log is how a real defect gets dismissed as a glitch.
      //
      // The body is deliberately EMPTY rather than rendered. A rendered body
      // here would show "week 12" beside the failure and read as though the
      // message had been fine, which is the exact confusion this whole guard
      // exists to prevent.
      await prisma.messageLog.create({
        data: {
          personId: person.id,
          templateId: null,
          templateKey: input.key,
          body: "",
          channel: "WHATSAPP",
          toPhone: toE164(person.phone!),
          trigger: input.trigger === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL",
          status: "FAILED",
          providerSid: null,
          error: required.error,
        },
      });
      return { status: "FAILED", body: "", error: required.error };
    }
  }

  const templates = await loadTemplates();
  const template = templates.get(input.key) ?? null;
  const values = placeholderValues(input.facts, input.extras);
  const body = renderTemplate(
    template?.body ?? DEFAULT_TEMPLATES[input.key].body,
    values,
  );

  // NOT EVERY MESSAGE HAS AN APPROVED TEMPLATE. LOCKOUT_NOTICE deliberately has
  // none (see lib/whatsapp-templates.ts) — it is a security message, and
  // submitting one risks the whole sender. It renders in the app and goes
  // nowhere, which is the honest outcome. What it must NEVER do is fail: this
  // fires while a member is locked out of their account, and a throw here would
  // turn a lockout into an error on top of a lockout.
  if (!isApprovedTemplateKey(input.key)) {
    return {
      status: "SKIPPED",
      reason:
        `${input.key} has no Meta-approved WhatsApp template, so it cannot be sent. ` +
        `It was rendered and recorded, not delivered.`,
    };
  }

  // Twilio substitutes the APPROVAL SAMPLE for any variable it is not given —
  // "Sara", "$7,000.00". So an incomplete set does not fail, it delivers
  // invented figures to a real member as fact. This refusal is the only thing
  // between a bug and that outcome, and it is a FAILED row (we tried and
  // stopped ourselves), not a skip.
  const to = toE164(person.phone!);
  const variables = buildContentVariables(input.key, values);
  if (!variables.ok) {
    console.error(`[statement] ${variables.error}`);
    // Logged like any other FAILED. Every FAILED outcome writes a row — a
    // failure the organizer is shown but cannot find in the log is how a real
    // defect gets dismissed as a glitch.
    await prisma.messageLog.create({
      data: {
        personId: person.id,
        templateId: template?.id ?? null,
        templateKey: input.key,
        body,
        channel: "WHATSAPP",
        toPhone: to,
        trigger: input.trigger === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL",
        status: "FAILED",
        providerSid: null,
        error: variables.error,
      },
    });
    return { status: "FAILED", body, error: variables.error };
  }

  const result = await sendWhatsAppMessage({
    toE164Phone: to,
    contentSid: APPROVED_TEMPLATES[input.key].contentSid,
    contentVariables: variables.variables,
    body,
  });
  // What Twilio told us, classified once. "accepted" is the ordinary answer.
  //
  // Narrowed to the two NON-failure states on purpose: sendWhatsAppMessage
  // already turned an immediate status:"failed" into ok:false, so nothing
  // reaching here with ok:true can classify as FAILED.
  const logged: "SENT" | "ACCEPTED" = result.ok
    ? loggedStatusFor(result.status) === "SENT"
      ? "SENT"
      : "ACCEPTED"
    : "ACCEPTED";

  await prisma.messageLog.create({
    data: {
      personId: person.id,
      templateId: template?.id ?? null,
      templateKey: input.key,
      body,
      channel: "WHATSAPP",
      toPhone: to,
      // IMPORT never reaches this point — the gate refuses it above.
      trigger: input.trigger === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL",
      // ACCEPTED, NOT SENT, unless Twilio actually confirmed delivery.
      //
      // This line read `result.ok ? "SENT" : "FAILED"`, which recorded a 201 +
      // status:"queued" — acceptance — as delivery. Ten rows said SENT while
      // Twilio's records said failed/63112/billed. `result.delivery` is the
      // classification of Twilio's own status word, so SENT is now only ever
      // written for something Twilio called sent or delivered.
      status: result.ok ? logged : "FAILED",
      providerSid: result.ok ? result.sid : null,
      error: result.ok ? null : result.error,
    },
  });

  return result.ok
    ? { status: logged, body }
    : { status: "FAILED", body, error: result.error };
}

/** Send one statement to a member of the cycle, facts derived fresh. */
export async function sendStatement(input: {
  participationId: string;
  key: MessageKey;
  trigger: SendTrigger;
  extras?: MessageExtras;
}): Promise<SendOutcome> {
  const loaded = await loadStandingFacts(input.participationId);
  if (!loaded) return { status: "SKIPPED", reason: "Participation not found." };
  return deliver({
    person: loaded.participation.person,
    facts: loaded.facts,
    key: input.key,
    trigger: input.trigger,
    extras: input.extras,
  });
}

/**
 * Send one statement to a PERSON — for events that belong to the person,
 * not a participation (the lockout notice). Uses their active-cycle
 * standing when they have one; otherwise renders from name-only facts, so
 * templates for these types should stick to person-level placeholders.
 */
export async function sendStatementToPerson(input: {
  personId: string;
  key: MessageKey;
  trigger: SendTrigger;
  extras?: MessageExtras;
}): Promise<SendOutcome> {
  const person = await prisma.person.findUnique({ where: { id: input.personId } });
  if (!person) return { status: "SKIPPED", reason: "Person not found." };

  const active = await prisma.participation.findFirst({
    where: { personId: person.id, status: "ACTIVE", cycle: { status: "ACTIVE" } },
    select: { id: true },
  });
  const loaded = active ? await loadStandingFacts(active.id) : null;
  const facts: StandingFacts = loaded?.facts ?? {
    name: person.nameEnglishFirst,
    weeklyAmount: 0,
    weeksCommitted: 0,
    currentCycleWeek: 0,
    finishWeek: 0,
    weeksCredited: 0,
    weeksBehind: 0,
    amountOutstanding: 0,
    totalPaid: 0,
    lastPaymentWeek: null,
    weeks: [],
  };

  return deliver({
    person,
    facts,
    key: input.key,
    trigger: input.trigger,
    extras: input.extras,
  });
}

/**
 * The lockout notice (2.28), fired when a member locks themselves out.
 * Behind the notifyOnLockout setting; the hardship flag is enforced by the
 * gate inside like every other send. Never throws — sign-in must not fail
 * because a courtesy message could not leave.
 */
export async function maybeSendLockoutNotice(
  personId: string,
  lockMinutes: number,
): Promise<SendOutcome> {
  try {
    if (!(await getSetting("notifyOnLockout"))) {
      return { status: "SKIPPED", reason: "Lockout notices are turned off (notifyOnLockout)." };
    }
    return await sendStatementToPerson({
      personId,
      key: "LOCKOUT_NOTICE",
      trigger: "AUTOMATIC",
      extras: { lockMinutes },
    });
  } catch (e) {
    console.error("maybeSendLockoutNotice failed:", e);
    return { status: "SKIPPED", reason: "Internal error sending the lockout notice." };
  }
}
