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
  isMessageKey,
  sendDecision,
  type MessageExtras,
  type MessageKey,
  type SendTrigger,
  type StandingFacts,
} from "./messages";
import { resolveWeekDate, storedWeekDates } from "./commitment";
import type { Prisma } from "./generated/prisma/client";
import { calculateFinishWeek, currentWeekNumber } from "./money";
import { toE164 } from "./phone";
import { prisma } from "./prisma";
import { getSetting, WHATSAPP_DISABLED_REASON } from "./settings";

import { computeStanding, pinnedMapFromEvents, type Standing } from "./standing";
import { sendWhatsAppMessage } from "./whatsapp";
import { loggedStatusFor } from "./twilio-status";
import {
  APPROVED_TEMPLATES,
  buildContentVariables,
  checkRequiredExtras,
  draftNotSubmittedRefusal,
  isApprovedTemplateKey,
  isDraftTemplateKey,
  marketingRefusal,
} from "./whatsapp-templates";
import { portalUrlValue, welcomeSendCheck } from "./welcome-send";

// STATEMENTS DELIVER. Meta first approved Content templates on 7 August 2026,
// reworked to the seven-key member-relative set on 13 August 2026, all
// category UTILITY (lib/whatsapp-templates.ts); a template needs no
// 24-hour service window, which is why freeform never worked and these do.
//
// THERE IS DELIBERATELY NO GLOBAL "CAN STATEMENTS SEND" FLAG. One existed
// (`STATEMENTS_DELIVERABLE`) and it earned §5.15 twice: first its reason
// string outlived the blocked state, then the flag itself sat hardcoded true
// with an unreachable branch under it — a kill switch nobody owned, wired to
// nothing anyone could check. The two real protections both survive it:
//   the organizer's control  — getSetting("whatsappEnabled"), in deliver();
//   the registry             — isApprovedTemplateKey() refuses PER KEY, so a
//                              revoked template stops ITSELF, and an emptied
//                              registry stops everything, with the honest
//                              reason and without a constant to remember.

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
          markedLate: payment?.markedLateAt != null,
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

  // Every stored week date, keyed by number — what the my* tokens compose
  // from (rule 7: the stored row's day, never a projection).
  const weekDateByNumber = new Map(
    participation.cycle.weeks.map((w) => [w.weekNumber, w.date]),
  );

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
    // The other end of the same window, resolved the same way (2.14): the day
    // that actually belonged to their start week, from the stored row. The
    // welcome says "from {startDate} to {finishDate}", and a member who joined
    // at week 14 must read two dates — never "week 14", which is the
    // organizer's frame (UI_STANDARDS 8c).
    startDate:
      resolveWeekDate({
        weekNumber: participation.startWeek,
        stored: storedWeekDates(participation.cycle.weeks),
        cycleStartDate: participation.cycle.startDate,
      })?.date ?? null,
    // ONE READ, SHARED BY THE PREVIEW AND THE SEND. Every surface that renders
    // a message goes through this function, so the address the organizer reads
    // before pressing send is by construction the address that leaves.
    portalUrl: portalUrlValue(await getSetting("portalUrl")),
    weeksCredited: standing.weeksCredited,
    weeksBehind: standing.weeksBehind,
    amountOutstanding: standing.amountOutstanding,
    totalPaid: standing.totalPaid,
    lastPaymentWeek: standing.lastPaymentWeek,
    // Each week's STORED date rides along (rule 7) so the my* tokens can pair
    // the member's own numbering with real days. From the cycle's own rows —
    // the same rows the window derivation read — never a projection.
    weeks: standing.weeks.map((w) => ({
      weekNumber: w.weekNumber,
      status: w.status,
      date: weekDateByNumber.get(w.weekNumber),
    })),
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
   * PREPARED, NOT SENT — it is waiting in `queued_messages` for the organizer.
   *
   * The outcome of an event-triggered message whose config setting says manual
   * (lib/payment-message.ts `configKeyForPaymentMessage`). `body` is the exact
   * sentence he will see and the exact one that will go out, because it was
   * rendered through this same function; nothing re-composes it later.
   */
  | { status: "QUEUED"; body: string }
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
  /**
   * The participation this message is ABOUT, when there is one.
   *
   * Only WHATSAPP_WELCOME uses it, and it uses it for the one thing in this
   * function that writes outside MessageLog: a delivered welcome sets
   * `agreementRequiredAt` on that participation, in the same transaction as
   * the log row. Optional because sendStatementToPerson has a person and may
   * have no participation at all (the lockout notice).
   */
  participationId?: string;
  /**
   * SEND (the default) delivers. QUEUE does everything up to the provider call
   * — the gate, the extras check, the render, the ContentVariables check — and
   * then parks the finished message for the organizer instead of sending it.
   *
   * ONE PATH, TWO ENDINGS, and that is the point. A queued message that
   * rendered here is byte for byte the message that will leave here, and a
   * message the boundary would refuse is refused NOW, at the moment the
   * evidence still exists, rather than days later when he presses send.
   */
  mode?: "SEND" | "QUEUE";
  /** QUEUE only: why it is waiting, in the words the organizer reads. */
  queueReason?: string;
}): Promise<SendOutcome> {
  const { person } = input;

  // ————— A SKIP NOBODY ASKED FOR MUST STILL LEAVE A RECORD —————
  //
  // WHAT THIS COST, 15 AUGUST 2026. Three part-payments were recorded and
  // produced NOTHING — no message, no queue row, no log row. Every `return
  // { status: "SKIPPED" }` below sits before this function's first write, so a
  // payment whose message was refused was indistinguishable from a payment that
  // never tried to send one. The organizer reads the log to know what was said
  // to whom, and a silence in it has to mean nothing happened.
  //
  // ONLY WHEN NOBODY IS WATCHING. A MANUAL send reports its outcome to the face
  // of the person who pressed the button — logging that too would fill the log
  // with rows nobody needs. An AUTOMATIC one fires from an event, and a QUEUE
  // one is being prepared on a member's behalf; neither has anyone reading the
  // answer, which is exactly the case this exists for.
  const unattended = input.trigger === "AUTOMATIC" || input.mode === "QUEUE";
  // THE RECORDER LIVES OUTSIDE THIS FUNCTION on purpose. Every gate below must
  // run BEFORE deliver() writes anything claiming a message was handled, and
  // three guard tests assert that by reading this function's own source. A log
  // write inlined here would sit textually above those gates and make the
  // assertion unreadable — while the real order, gate first and record second,
  // is exactly what recordUnsentMessage preserves.
  const skip = (reason: string, body = ""): Promise<SendOutcome> =>
    (unattended
      ? recordUnsentMessage({
          personId: person.id,
          phone: person.phone,
          key: input.key,
          status: "SKIPPED",
          reason,
          trigger: input.trigger === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL",
          body,
        })
      : Promise.resolve()
    ).then(() => ({ status: "SKIPPED" as const, reason }));

  const decision = sendDecision({
    key: input.key,
    trigger: input.trigger,
    noMessages: person.noMessages,
    hasPhone: (person.phone?.trim() ?? "") !== "",
    // The derived weeks let the gate leave deferred members out of the
    // chasing types — the debt stays on every statement either way.
    weeks: input.facts.weeks,
  });
  if (!decision.send) return skip(decision.reason);

  // The organizer's own switch: the choice about whether to send, distinct
  // from whether an approved template exists to carry it — the registry guard
  // below answers that per key.
  if (!(await getSetting("whatsappEnabled"))) {
    return skip(WHATSAPP_DISABLED_REASON);
  }

  // ————— THE WELCOME'S TWO REFUSALS, at the boundary —————
  //
  // The batch and the member profile both ask this same rule before offering
  // the button, which is where the organizer can act on it. This is the copy
  // that MATTERS: a UI check is a courtesy, and the send path is the only place
  // that cannot be gone around. The welcome makes two promises about the
  // platform — an address to open and a PIN that works — and both fail silently
  // when they are wrong, so both refuse rather than warn.
  if (input.key === "WHATSAPP_WELCOME") {
    // THIS MEMBER'S OWN OVERRIDE, read here rather than threaded through four
    // callers. It is one extra read on the rarest send in the platform, and it
    // is the only block that can be true for a single person while everyone
    // else is fine — so the boundary is exactly where it has to be asked.
    const override = await prisma.person.findUnique({
      where: { id: input.person.id },
      select: { pinLoginAllowed: true, nameEnglishFirst: true },
    });
    const check = welcomeSendCheck({
      portalUrl: portalUrlValue(await getSetting("portalUrl")),
      defaultPinFromPhone: await getSetting("defaultPinFromPhone"),
      pinLoginEnabled: await getSetting("pinLoginEnabled"),
      memberPinLoginAllowed: override?.pinLoginAllowed ?? null,
      memberName: override?.nameEnglishFirst,
    });
    if (!check.ok) return skip(check.reason);
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
  // CAPTURED BEFORE THE GUARD BELOW NARROWS IT AWAY.
  //
  // The requirement write further down once compared `input.key` to
  // "WHATSAPP_WELCOME" AFTER this guard had narrowed the type to
  // ApprovedTemplateKey — in the pre-approval era that comparison could never
  // be true, and `tsc` said so. Captured here, before the narrowing, the flag
  // is real — and since 13 Aug 2026 the welcome IS approved, so it is read on
  // every live welcome send.
  const isWelcome = input.key === "WHATSAPP_WELCOME";

  if (!isApprovedTemplateKey(input.key)) {
    // TWO ABSENCES, TWO SENTENCES. LOCKOUT_NOTICE has no approved template and
    // never will — that is a decision, and the organizer has nothing to do
    // about it. WHATSAPP_WELCOME is written and waiting on a submission, and
    // the next action is somebody's. Reading the first sentence about the
    // second would make a queued template look like a closed door.
    // THE BODY IS KEPT. It rendered before this guard, and "rendered and
    // recorded, not delivered" is only true if the record holds what was
    // rendered — LOCKOUT_NOTICE reaches here on every single lockout.
    return skip(
      isDraftTemplateKey(input.key)
        ? draftNotSubmittedRefusal(input.key)
        : `${input.key} has no Meta-approved WhatsApp template, so it cannot be sent. ` +
          `It was rendered and recorded, not delivered.`,
      body,
    );
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

  // ————— META WILL DROP THIS ONE, SO DO NOT PRETEND OTHERWISE —————
  //
  // A MARKETING-categorised template to a US number is accepted by Twilio and
  // then silently discarded by Meta (error 63049, asynchronous). The platform
  // would write an honest ACCEPTED and the member would hear nothing — which is
  // the worst shape a message record can take, because it reads as done.
  //
  // AFTER the ContentVariables check, so a template with a real second problem
  // still reports that one; and through skip(), so an automatic send leaves the
  // row that says why nobody was told.
  const marketing = marketingRefusal(input.key, to);
  if (marketing) return skip(marketing, body);

  // ————— THE FORK: park it, or send it —————
  //
  // AFTER the ContentVariables check on purpose. A message that would be
  // refused at the boundary must be refused while the payment that produced it
  // is still on screen — parking it and discovering the hole on send day puts
  // the failure as far as possible from the mistake that caused it.
  if (input.mode === "QUEUE") {
    await prisma.queuedMessage.create({
      data: {
        personId: person.id,
        participationId: input.participationId ?? null,
        templateKey: input.key,
        body,
        toPhone: to,
        // WHAT IT WAS COMPOSED FROM, stored so pressing send replays these
        // exact facts. The alternative — recomposing at send time — would let a
        // later edit quietly change a sentence the organizer already approved.
        extras: (input.extras ?? {}) as Prisma.InputJsonValue,
        reason: input.queueReason ?? "Waiting for you to review it.",
      },
    });
    return { status: "QUEUED", body };
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

  // ANNOTATED, not inferred. Hoisting this out of the `create(...)` call to
  // share a transaction below removes the contextual type that kept `trigger`
  // and `status` as literals; the annotation puts it back, so the enums still
  // check exactly as they did inline.
  const logRow: Prisma.MessageLogCreateArgs = {
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
  };

  // ————— SENDING THE WELCOME IS WHAT REQUIRES A SIGNATURE —————
  //
  // The organizer's ruling, and the whole mechanism behind the agreement gate
  // in app/me/layout.tsx. There is no exemption list and no date comparison:
  // `agreementRequiredAt` null means this member was never sent a welcome and
  // is therefore not gated, which is exactly how the 27 members already
  // mid-cycle stay untouched.
  //
  // ONLY ON A REAL SEND. `result.ok` is the condition, so a FAILED row sets
  // nothing — the agreement is owed by a member who was TOLD, and a member
  // whose welcome never left was not told. Gating them anyway would lock
  // someone out of the portal on the strength of a message that does not exist.
  //
  // A TIMESTAMP RATHER THAN A FLAG, which is what removes the re-sign problem:
  // send the welcome again after changing someone from 10 weeks to 12 and this
  // writes a LATER moment, so their earlier signature stops answering and they
  // sign the current terms. `updateMany` with `status: "ACTIVE"` rather than a
  // plain update because a participation closed between the send and this line
  // must not be gated — and because a missing row must not throw here, after
  // the message has already gone.
  //
  // ONE TRANSACTION, so the record of what was said and the obligation it
  // created cannot exist without each other. LIVE SINCE 13 Aug 2026: the pair
  // was written in the pre-approval era so that registering the welcome's
  // ContentSid would be the only remaining step — the SID landed
  // (HX90da7257223b48177b95dbbb132ea182) and this now fires on every real
  // welcome send. It is the entire mechanism behind the agreement gate.
  const participationId = input.participationId;
  if (isWelcome && result.ok && participationId !== undefined) {
    await prisma.$transaction([
      prisma.messageLog.create(logRow),
      prisma.participation.updateMany({
        where: { id: participationId, status: "ACTIVE" },
        data: { agreementRequiredAt: new Date() },
      }),
    ]);
  } else {
    await prisma.messageLog.create(logRow);
  }

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
    // THE BATCH AND THE PER-MEMBER SEND BOTH ARRIVE HERE, which is why the
    // welcome's requirement is set inside deliver() and not in either caller:
    // app/actions/messages.ts and app/actions/member-messaging.ts would
    // otherwise each need their own copy, and one of them would not get one.
    participationId: input.participationId,
  });
}

/**
 * Prepare one statement and PARK it for the organizer (2.20).
 *
 * Same loader, same gate, same render as `sendStatement` — only the last step
 * differs. A message that cannot be sent at all (hardship, no phone, channel
 * off) comes back SKIPPED and is not queued: a backlog of messages that can
 * never leave is not a queue, it is a pile.
 */
export async function queueStatement(input: {
  participationId: string;
  key: MessageKey;
  extras?: MessageExtras;
  reason: string;
}): Promise<SendOutcome> {
  const loaded = await loadStandingFacts(input.participationId);
  if (!loaded) return { status: "SKIPPED", reason: "Participation not found." };
  return deliver({
    person: loaded.participation.person,
    facts: loaded.facts,
    key: input.key,
    // THE TRIGGER IT WILL ACTUALLY HAVE. A queued message leaves because the
    // organizer pressed send, so the gate that decides whether it may leave is
    // asked the same question now as then — otherwise a message could pass
    // here and be refused there, after he had already approved it.
    trigger: "MANUAL",
    extras: input.extras,
    participationId: input.participationId,
    mode: "QUEUE",
    queueReason: input.reason,
  });
}

/**
 * Record a message that never reached `deliver()` at all.
 *
 * THE GAP THIS CLOSES. `deliver()` now logs its own skips, but a caller can
 * fail BEFORE calling it — `confirmPayment` composes the placeholders first,
 * and a composition it cannot complete produced no record of any kind. The
 * money was recorded and the member was told nothing, silently.
 *
 * NEVER THROWS. It runs after money has committed; a logging failure must not
 * turn a recorded payment into an error.
 */
export async function recordUnsentMessage(input: {
  personId: string;
  phone: string | null;
  key: MessageKey;
  status: "SKIPPED" | "FAILED";
  reason: string;
  trigger: "AUTOMATIC" | "MANUAL";
  /** What HAD rendered, when anything had. Empty is honest, not a placeholder. */
  body?: string;
}): Promise<void> {
  try {
    await prisma.messageLog.create({
      data: {
        personId: input.personId,
        templateId: null,
        templateKey: input.key,
        body: input.body ?? "",
        channel: "WHATSAPP",
        toPhone: (input.phone?.trim() ?? "") === "" ? "" : toE164(input.phone!),
        trigger: input.trigger,
        status: input.status,
        providerSid: null,
        error: input.reason,
      },
    });
  } catch (e) {
    console.error(`[statement] could not record an unsent ${input.key}:`, e);
  }
}

/** One prepared message, as the organizer's queue shows it. */
export type QueuedMessageRow = {
  id: string;
  personId: string;
  personName: string;
  templateKey: string;
  body: string;
  toPhone: string;
  reason: string;
  createdAt: Date;
};

/**
 * How many messages are waiting — for the badge on the Messages nav item.
 *
 * A COUNT, NOT THE ROWS. This runs on every admin page render, so it must cost
 * one cheap aggregate and carry nothing about anybody: the rail is on screen
 * during a screen share (2.4), and a number is the most it may ever say there.
 */
export async function countQueuedMessages(): Promise<number> {
  return prisma.queuedMessage.count();
}

/** Everything waiting, oldest first — the order he should work through them. */
export async function listQueuedMessages(limit = 100): Promise<QueuedMessageRow[]> {
  const rows = await prisma.queuedMessage.findMany({
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { person: { select: { nameEnglishFirst: true, nameEnglishLast: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: `${r.person.nameEnglishFirst}${r.person.nameEnglishLast ? ` ${r.person.nameEnglishLast}` : ""}`,
    templateKey: r.templateKey,
    body: r.body,
    toPhone: r.toPhone,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}

/**
 * Send one queued message, from the facts it was composed with.
 *
 * THE ROW SURVIVES A FAILURE. It is deleted only when the message actually
 * left (SENT or ACCEPTED); a FAILED or SKIPPED attempt leaves it queued, so the
 * organizer can fix the cause and press send again rather than discovering
 * later that his approval silently threw the message away.
 */
export async function sendQueuedMessage(id: string): Promise<SendOutcome> {
  const row = await prisma.queuedMessage.findUnique({ where: { id } });
  if (!row) return { status: "SKIPPED", reason: "That message is no longer queued." };
  if (!isMessageKey(row.templateKey)) {
    return { status: "SKIPPED", reason: `${row.templateKey} is not a message type any more.` };
  }
  // STORED FACTS, NOT FRESH ONES. The money figures are facts about the payment
  // that produced this message and do not move; re-deriving them here would let
  // a later edit change a sentence the organizer already read and approved.
  const extras = (row.extras ?? {}) as MessageExtras;
  const outcome = row.participationId
    ? await sendStatement({
        participationId: row.participationId,
        key: row.templateKey,
        trigger: "MANUAL",
        extras,
      })
    : await sendStatementToPerson({
        personId: row.personId,
        key: row.templateKey,
        trigger: "MANUAL",
        extras,
      });
  if (outcome.status === "SENT" || outcome.status === "ACCEPTED") {
    await prisma.queuedMessage.delete({ where: { id } });
  }
  return outcome;
}

/** Decide NOT to send one. It leaves no MessageLog row, because none was sent. */
export async function discardQueuedMessage(id: string): Promise<{ ok: boolean }> {
  await prisma.queuedMessage.deleteMany({ where: { id } });
  return { ok: true };
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
    // Undefined when they are in no active cycle, which is honest: with no
    // participation there is nothing to hang an agreement requirement on.
    participationId: active?.id,
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
