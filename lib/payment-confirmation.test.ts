import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { describePayment, paymentMessageFor, type PaymentMessageKey } from "./engine";
import {
  configKeyForPaymentMessage,
  lateNoticeExtras,
  paymentMessageExtras,
} from "./payment-message";
import {
  AUTOMATIC_MESSAGE_KEYS,
  EVENT_TRIGGERED_KEYS,
  MANUAL_MESSAGE_KEYS,
  placeholderValues,
  type MessageExtras,
  type StandingFacts,
} from "./messages";
import { APPROVED_TEMPLATES, buildContentVariables } from "./whatsapp-templates";
import { resolveMessagingConfig } from "./messaging-config";
import { SETTING_DEFAULTS } from "./setting-defaults";

// PHASE 4b-ii — THE SENTENCE A MEMBER ACTUALLY READS.
//
// Every other test in this build proves a number. This one proves the ENGLISH,
// end to end and without a database: the event the engine derived, the template
// the router picked, the phrases the composer built, the variables the Twilio
// boundary assembled, and the body Meta substitutes them into. That last string
// is the product. It is the only artefact of this platform a member ever holds,
// and until now nothing checked it.
//
// THE BUG AT THE CENTRE OF IT. Markos paid $200 toward a $2,000 week and was
// told "we received $200 for your Equb — recorded on your week 14. Thank you."
// The allocation was right; the sentence said the week was dealt with. He was
// chased for the same week days later. Everything below exists so that the
// sentence and the money cannot disagree again.

const WEEKLY = 200_000; // $2,000 a week
const TODAY = new Date(Date.UTC(2026, 7, 15));
const weekDate = (n: number) => new Date(Date.UTC(2026, 4, 3 + (n - 1) * 7));
const START_WEEK = 1;

/** The member's window before the payment: `covered` names the exceptions. */
function before(covered: Record<number, number>, weeks = 20) {
  return Array.from({ length: weeks }, (_, i) => ({
    weekNumber: i + 1,
    date: weekDate(i + 1),
    amountDue: WEEKLY,
    covered: covered[i + 1] ?? 0,
    isDeferred: false,
    isSkipped: false,
  }));
}

const DATE_BY_WEEK = new Map(
  Array.from({ length: 20 }, (_, i) => [i + 1, weekDate(i + 1)] as const),
);

function facts(over: Partial<StandingFacts> = {}): StandingFacts {
  return {
    name: "Markos",
    weeklyAmount: WEEKLY,
    weeksCommitted: 40,
    currentCycleWeek: 15,
    finishWeek: 40,
    weeksCredited: 13,
    weeksBehind: 1,
    amountOutstanding: 180_000,
    totalPaid: 13 * WEEKLY,
    lastPaymentWeek: 14,
    weeks: Array.from({ length: 20 }, (_, i) => ({
      weekNumber: i + 1,
      status: i < 13 ? "PAID" : "LATE",
      date: weekDate(i + 1),
    })),
    ...over,
  };
}

/**
 * THE WHOLE PIPELINE, exactly as a real send runs it — the engine, the router,
 * the composer, the ContentVariables boundary, and Meta's own substitution into
 * the APPROVED body. No mocks: every function here is the one production calls.
 */
function messageFor(input: {
  amount: number;
  covered: Record<number, number>;
  standing?: Partial<StandingFacts>;
  weeksBehindAfter?: number;
}): { key: PaymentMessageKey | null; extras: MessageExtras; text: string } {
  const event = describePayment({
    amount: input.amount,
    today: TODAY,
    weeklyAmount: WEEKLY,
    weeksBefore: before(input.covered),
    weeksBehindAfter: input.weeksBehindAfter ?? 0,
  });
  const key = paymentMessageFor(event);
  if (key === null) return { key: null, extras: {}, text: "" };

  const composed = paymentMessageExtras({ key, event, dateByWeek: DATE_BY_WEEK, startWeek: START_WEEK });
  if (!composed.ok) throw new Error(`composition refused: ${composed.error}`);

  const values = placeholderValues(facts(input.standing), composed.extras);
  const variables = buildContentVariables(key, values);
  if (!variables.ok) throw new Error(`the boundary refused: ${variables.error}`);

  // What Twilio does with a Content template: substitute {{n}} into the body
  // Meta approved. The result is the member's message, character for character.
  const text = APPROVED_TEMPLATES[key].approvedBody.replace(
    /\{\{(\d+)\}\}/g,
    (_m, n: string) => variables.variables[n] ?? "",
  );
  return { key, extras: composed.extras, text };
}

describe("MARKOS — the bug that started everything, at the member's phone", () => {
  // $200 toward a $2,000 week. Weeks 1 to 13 are settled; week 14 is his oldest
  // unpaid week and its window has closed.
  const markos = () => messageFor({ amount: 20_000, covered: paidThrough(13), weeksBehindAfter: 1 });

  it("routes to PARTIAL_CONFIRMED, not to any confirmation of payment", () => {
    expect(markos().key).toBe("PARTIAL_CONFIRMED");
  });

  it("says $1,800 is still due, and names the week it is due for", () => {
    expect(markos().extras.stillDueOnWeek).toBe(
      "$1,800 is still due for your week 14 (Aug 2)",
    );
  });

  it("the message a member reads, in full", () => {
    expect(markos().text).toBe(
      "Hi Markos, we received $200 for your Equb. That paid part of your week 14 " +
        "(Sunday, August 2). $1,800 is still due for your week 14 (Aug 2). You have now " +
        "paid 13 of your 40 weeks. Thank you.",
    );
  });

  it("NEVER thanks him for a week he has not paid", () => {
    const { text } = markos();
    // The old message's two lies, both by construction impossible now: it said
    // the money was "recorded on your week 14" — the phrase a member reads as
    // "week 14 is dealt with" — and it said nothing about the $1,800.
    expect(text).not.toContain("recorded on");
    expect(text).toContain("part of your week 14");
    expect(text).toContain("$1,800 is still due");
  });

  it("QUEUES for the organizer — it does not send itself", () => {
    const config = resolveMessagingConfig(defaultSettingValues());
    expect(config.message[configKeyForPaymentMessage("PARTIAL_CONFIRMED")].auto).toBe(false);
  });
});

describe("THE NO-OP — a clean full payment is unchanged for the member", () => {
  // Two whole weeks, nothing owed before or after: the case that has always
  // worked, and the one this build must not disturb.
  const clean = () => messageFor({ amount: 2 * WEEKLY, covered: {}, standing: { weeksCredited: 2 } });

  it("routes to the confirmation, exactly as before", () => {
    expect(clean().key).toBe("PAYMENT_CONFIRMED_V4");
  });

  it("still SENDS ITSELF — the setting says automatic and the gate allows it", () => {
    const config = resolveMessagingConfig(defaultSettingValues());
    expect(config.message[configKeyForPaymentMessage("PAYMENT_CONFIRMED_V4")].auto).toBe(true);
    // The gate refuses an AUTOMATIC trigger for any key not on this list, so a
    // v4 that were missing from it would turn every confirmation into a skip.
    expect(AUTOMATIC_MESSAGE_KEYS).toContain("PAYMENT_CONFIRMED_V4");
  });

  it("says the same thing it always said, in the same shape", () => {
    expect(clean().text).toBe(
      "Hi Markos, we received $4,000 for your Equb. That paid week 1 (May 3) and week 2 " +
        "(May 10). You have now paid 2 of your 40 weeks. Thank you.",
    );
  });

  it("carries no talk of anything still owed, because nothing is", () => {
    const { text, extras } = clean();
    expect(extras.stillDueOnWeek).toBeUndefined();
    expect(text).not.toContain("still due");
    expect(text).not.toContain("part of");
  });
});

describe("THE OTHER TWO BRANCHES", () => {
  it("WITH_PARTIAL completes the older week AND names what is still due on the next", () => {
    // Week 1 holds $1,000. $2,500 finishes it and puts $1,500 on week 2.
    const { key, text } = messageFor({
      amount: 250_000,
      covered: { 1: 100_000 },
      standing: { weeksCredited: 1 },
    });
    expect(key).toBe("PAYMENT_CONFIRMED_WITH_PARTIAL");
    expect(text).toBe(
      "Hi Markos, we received $2,500 for your Equb. That paid week 1 (May 3). $500 is " +
        "still due for your week 2 (May 10). You have now paid 1 of your 40 weeks. Thank you.",
    );
  });

  it("PARTIAL_COMPLETED names the EXACT amount already paid, not the word “part”", () => {
    // Week 1 held $200; $1,800 finishes it.
    const { key, extras, text } = messageFor({
      amount: 180_000,
      covered: { 1: 20_000 },
      standing: { weeksCredited: 1 },
    });
    expect(key).toBe("PARTIAL_COMPLETED");
    expect(extras.priorPaidOnWeek).toBe(20_000);
    expect(text).toBe(
      "Hi Markos, we received $1,800 for your Equb. You had already paid $200 toward " +
        "your week 1 (Sunday, May 3), and it is now paid in full. You have now paid 1 of your " +
        "40 weeks. Thank you.",
    );
  });

  it("PARTIAL_COMPLETED's figure survives the unallocated trap", () => {
    // THE TRAP. Week 1 holds $200 and every other week is settled, so a $5,000
    // payment applies only $1,800 and $3,200 fits nowhere. A prior figure taken
    // from the event's own amount would read "$3,000 already paid" and be wrong
    // by exactly the unallocated remainder; the subtraction is amountDue minus
    // what landed ON THAT WEEK, so it is $200 either way.
    const covered: Record<number, number> = { 1: 20_000 };
    for (let n = 2; n <= 20; n += 1) covered[n] = WEEKLY;
    const { key, extras } = messageFor({ amount: 500_000, covered, standing: { weeksCredited: 20 } });
    expect(key).toBe("PARTIAL_COMPLETED");
    expect(extras.priorPaidOnWeek).toBe(20_000);
  });
});

describe("THE TWO AXES, READ AT THE CALL SITE", () => {
  it("all four routed keys are EVENT_TRIGGERED, so none appears in the picker", () => {
    const routed: PaymentMessageKey[] = [
      "PAYMENT_CONFIRMED_V4",
      "PAYMENT_CONFIRMED_WITH_PARTIAL",
      "PARTIAL_CONFIRMED",
      "PARTIAL_COMPLETED",
    ];
    for (const key of routed) {
      expect(EVENT_TRIGGERED_KEYS as readonly string[]).toContain(key);
      expect(MANUAL_MESSAGE_KEYS as readonly string[]).not.toContain(key);
    }
  });

  it("the money-still-owed three share ONE setting, and it is manual", () => {
    // ONE SWITCH PER DECISION HE MAKES, not one per template. All three tell a
    // member something about a week that was not settled when the money came.
    for (const key of [
      "PAYMENT_CONFIRMED_WITH_PARTIAL",
      "PARTIAL_CONFIRMED",
      "PARTIAL_COMPLETED",
    ] as PaymentMessageKey[]) {
      expect(configKeyForPaymentMessage(key)).toBe("PARTIAL_CONFIRMED");
    }
    expect(configKeyForPaymentMessage("PAYMENT_CONFIRMED_V4")).toBe("PAYMENT_CONFIRMED");
  });

  it("EVENT_TRIGGERED and AUTOMATIC are genuinely different questions", () => {
    // The proof the split was needed: three keys are event-triggered AND not
    // automatic. One flag could not have expressed that, which is why 4b-i
    // separated them and why this file reads both.
    const eventButNotAuto = (EVENT_TRIGGERED_KEYS as readonly string[]).filter(
      (k) => !(AUTOMATIC_MESSAGE_KEYS as readonly string[]).includes(k),
    );
    expect(eventButNotAuto.sort()).toEqual([
      "PARTIAL_COMPLETED",
      "PARTIAL_CONFIRMED",
      "PAYMENT_CONFIRMED_WITH_PARTIAL",
    ]);
  });
});

describe("LATE_NOTICE_V4 — chasing a part-payer without calling them a non-payer", () => {
  // A member owing $1,800 of a $2,000 week that has closed. late_notice_v3
  // opened "we did not receive your payment" — false — and quoted their WHOLE
  // outstanding total where the sentence named one week.
  const partPayer = [
    { weekNumber: 14, date: weekDate(14), amountDue: WEEKLY, coveredAtCurrentRate: 20_000, status: "PARTIAL_LATE" },
    { weekNumber: 15, date: weekDate(15), amountDue: WEEKLY, coveredAtCurrentRate: 0, status: "DUE" },
  ];

  it("names the WEEK'S remainder, not the member's total", () => {
    const extras = lateNoticeExtras({ weeks: partPayer, startWeek: START_WEEK });
    expect(extras?.stillDueOnWeek).toBe("$1,800 is still due for your week 14 (Aug 2)");
  });

  it("the notice a part-payer reads, in full — and it never denies their payment", () => {
    const extras = lateNoticeExtras({ weeks: partPayer, startWeek: START_WEEK })!;
    const values = placeholderValues(facts(), extras);
    const variables = buildContentVariables("LATE_NOTICE_V4", values);
    expect(variables.ok).toBe(true);
    if (!variables.ok) return;
    const text = APPROVED_TEMPLATES.LATE_NOTICE_V4.approvedBody.replace(
      /\{\{(\d+)\}\}/g,
      (_m, n: string) => variables.variables[n] ?? "",
    );
    expect(text).toContain("$1,800 is still due for your week 14 (Aug 2)");
    expect(text).not.toContain("did not receive");
  });

  it("chases the OLDEST unpaid week, matching where their next payment lands", () => {
    const twoLate = [
      { weekNumber: 15, date: weekDate(15), amountDue: WEEKLY, coveredAtCurrentRate: 0, status: "LATE" },
      { weekNumber: 12, date: weekDate(12), amountDue: WEEKLY, coveredAtCurrentRate: 50_000, status: "PARTIAL_LATE" },
    ];
    expect(lateNoticeExtras({ weeks: twoLate, startWeek: START_WEEK })?.stillDueOnWeek).toContain(
      "week 12",
    );
  });

  it("a DEFERRED week is not chased, and no figure is invented for it", () => {
    // D-42: the money is still owed and every statement says so, but a paused
    // week is not chased. Nothing chaseable means null — the gate refuses the
    // send for the same reason, so the caller never has to fabricate a week.
    const deferredOnly = [
      { weekNumber: 14, date: weekDate(14), amountDue: WEEKLY, coveredAtCurrentRate: 0, status: "DEFERRED" },
    ];
    expect(lateNoticeExtras({ weeks: deferredOnly, startWeek: START_WEEK })).toBeNull();
  });

  it("BOTH manual paths compose it — a helper only one of them calls is the old defect", () => {
    const perMember = readFileSync("app/actions/member-messaging.ts", "utf8");
    const batch = readFileSync("app/actions/messages.ts", "utf8");
    expect(perMember).toContain("lateNoticeExtrasForParticipation(");
    expect(batch).toContain("lateNoticeExtrasForParticipation(");
    // AND THE PREVIEW USES IT TOO. An unsupplied required extra renders as the
    // NO_VALUE dash, so the organizer would read "— is still due" and then send
    // a real figure.
    const prepare = batch.slice(batch.indexOf("export async function prepareBatch("));
    expect(prepare.indexOf("lateNoticeExtrasForParticipation(")).toBeLessThan(
      prepare.indexOf("placeholderValues(loaded.facts, rowExtras)"),
    );
  });
});

describe("GUARD — the call site routes, and the queue is a real ending", () => {
  const confirmation = readFileSync("lib/payment-confirmation.ts", "utf8");
  const payments = readFileSync("app/actions/payments.ts", "utf8");

  it("no hard-coded template survives at the payment site", () => {
    // The whole defect in one line. recordPayment fired this key unconditionally
    // for every payment, full or partial, and that is what told Markos his week
    // was dealt with.
    expect(payments).not.toContain('key: "PAYMENT_CONFIRMED"');
    expect(payments).toContain("confirmPayment(");
  });

  it("the BEFORE state is captured inside the transaction, where it still exists", () => {
    const tx = payments.slice(
      payments.indexOf("const data = await serializableTransaction("),
      payments.indexOf("revalidatePath("),
    );
    // One line after the upsert loop, "already part paid, now finished" and
    // "settled outright" are indistinguishable — and that pair is exactly what
    // the member's sentence turns on.
    expect(tx).toContain("weeksBefore:");
    expect(tx.indexOf("weeksBefore:")).toBeGreaterThan(tx.indexOf("payment.upsert"));
  });

  it("the manual branch QUEUES and does not send", () => {
    const gate = confirmation.slice(confirmation.indexOf("const auto ="));
    expect(gate).toContain("queueStatement(");
    expect(gate).toContain('trigger: "AUTOMATIC"');
    // Both endings are present and the automatic one is behind the setting.
    expect(gate.indexOf("auto")).toBeLessThan(gate.indexOf("sendStatement("));
  });

  it("a queued message is not written to the message log", () => {
    // message_logs answers ONE question — what did the platform SEND. A draft
    // parked there would appear in the member's own history as something they
    // were told.
    const engine = readFileSync("lib/messaging-engine.ts", "utf8");
    const queueBranch = engine.slice(
      engine.indexOf('if (input.mode === "QUEUE")'),
      engine.indexOf("const result = await sendWhatsAppMessage("),
    );
    expect(queueBranch).toContain("queuedMessage.create");
    expect(queueBranch).not.toContain("messageLog.create");
  });

  it("the queue renders through the SAME path the send does", () => {
    // The preview promise: the parked body was produced by deliver(), after the
    // extras check and after the ContentVariables check, so it is byte for byte
    // what will leave — and a message the boundary would refuse is refused now,
    // while the payment that produced it is still on screen.
    const engine = readFileSync("lib/messaging-engine.ts", "utf8");
    const deliver = engine.slice(engine.indexOf("async function deliver("));
    expect(deliver.indexOf("buildContentVariables(")).toBeLessThan(
      deliver.indexOf('if (input.mode === "QUEUE")'),
    );
  });
});

/** Weeks 1..n settled in full — the ordinary shape of a member in good standing. */
function paidThrough(n: number): Record<number, number> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, WEEKLY]));
}

/** The settings as they ship, resolved by the same function production uses. */
function defaultSettingValues() {
  return {
    autoSendPaymentConfirmed: SETTING_DEFAULTS.autoSendPaymentConfirmed,
    autoSendPartialConfirmed: SETTING_DEFAULTS.autoSendPartialConfirmed,
    autoSendLateNotice: SETTING_DEFAULTS.autoSendLateNotice,
    autoSendBehindNotice: SETTING_DEFAULTS.autoSendBehindNotice,
    autoSendWinnerAnnouncement: SETTING_DEFAULTS.autoSendWinnerAnnouncement,
    autoSendWeeklyReminder: SETTING_DEFAULTS.autoSendWeeklyReminder,
    autoSendGroupAnnouncement: SETTING_DEFAULTS.autoSendGroupAnnouncement,
    lateNoticeDay: SETTING_DEFAULTS.lateNoticeDay,
    lateNoticeTime: SETTING_DEFAULTS.lateNoticeTime,
    weeklyReminderDay: SETTING_DEFAULTS.weeklyReminderDay,
    weeklyReminderTime: SETTING_DEFAULTS.weeklyReminderTime,
    equbTimezone: SETTING_DEFAULTS.equbTimezone,
  };
}
