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
import { calculateFinishWeek, currentWeekNumber } from "./money";
import { toE164 } from "./phone";
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { computeStanding, pinnedMapFromEvents, type Standing } from "./standing";
import { sendWhatsAppMessage } from "./whatsapp";

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

  const facts: StandingFacts = {
    name: participation.person.nameEnglishFirst,
    weeklyAmount: participation.weeklyAmount,
    weeksCommitted: participation.weeksCommitted,
    currentCycleWeek: cycleWeek,
    finishWeek: standing.finishWeek,
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
  | { status: "SENT"; body: string }
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
  });
  if (!decision.send) return { status: "SKIPPED", reason: decision.reason };

  const templates = await loadTemplates();
  const template = templates.get(input.key) ?? null;
  const body = renderTemplate(
    template?.body ?? DEFAULT_TEMPLATES[input.key].body,
    placeholderValues(input.facts, input.extras),
  );

  const to = toE164(person.phone!);
  const result = await sendWhatsAppMessage(to, body);
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
      status: result.ok ? "SENT" : "FAILED",
      providerSid: result.ok ? result.sid : null,
      error: result.ok ? null : result.error,
    },
  });

  return result.ok
    ? { status: "SENT", body }
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
