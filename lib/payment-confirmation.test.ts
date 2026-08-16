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
import {
  APPROVED_TEMPLATES,
  buildContentVariables,
  MARKETING_TEMPLATE_KEYS,
  marketingRefusal,
} from "./whatsapp-templates";
import { CONFIGURABLE_MESSAGE_KEYS, resolveMessagingConfig } from "./messaging-config";
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

  // THESE THREE SHARED ONE SETTING UNTIL 15 AUGUST 2026, and the sharing was
  // deliberate, documented — and invisible. The organizer went looking for the
  // part-payment-completed switch, could not find it, and had no way to learn
  // it was riding on the part-payment one. A setting he cannot SEE is not a
  // setting he has (2.10). Each now answers under its own name.
  it("every payment message has its OWN setting, by its own name", () => {
    for (const key of [
      "PAYMENT_CONFIRMED_WITH_PARTIAL",
      "PARTIAL_CONFIRMED",
      "PARTIAL_COMPLETED",
    ] as PaymentMessageKey[]) {
      expect(configKeyForPaymentMessage(key)).toBe(key);
      // And the name is on the settings screen, which iterates this list.
      expect(CONFIGURABLE_MESSAGE_KEYS as readonly string[]).toContain(key);
    }
    // v4 IS the payment confirmation, so it reads that setting. One message
    // under one name is not a sharing — the legacy key is being retired.
    expect(configKeyForPaymentMessage("PAYMENT_CONFIRMED_V4")).toBe("PAYMENT_CONFIRMED");
  });

  it("all three money-still-owed types still SHIP manual", () => {
    // The behaviour is unchanged by splitting the switch: a wrong notice about
    // a debt is still worse than a late one. Only the visibility changed.
    const config = resolveMessagingConfig(defaultSettingValues());
    for (const key of [
      "PAYMENT_CONFIRMED_WITH_PARTIAL",
      "PARTIAL_CONFIRMED",
      "PARTIAL_COMPLETED",
    ] as PaymentMessageKey[]) {
      expect(config.message[configKeyForPaymentMessage(key)].auto, key).toBe(false);
    }
  });

  // THE INCIDENT, 15 AUGUST 2026. This test used to assert the opposite — that
  // three event-triggered keys were absent from AUTOMATIC_MESSAGE_KEYS — and it
  // passed, because it was describing the bug rather than the law. The two
  // lists were both answering "may this send automatically", and they
  // disagreed: the organizer switched the part-payment confirmation ON,
  // confirmPayment sent with trigger AUTOMATIC, and sendDecision refused it.
  // Three part-payments produced no message, no queue row and no log row.
  //
  // The questions really are different — but the difference is MAY versus DOES,
  // not which keys. Every event-triggered key MAY be automatic; the config
  // decides which ones ARE.
  it("every event-triggered key is PERMITTED to be automatic", () => {
    for (const key of EVENT_TRIGGERED_KEYS) {
      expect(
        (AUTOMATIC_MESSAGE_KEYS as readonly string[]).includes(key),
        `${key} fires from a payment, so the gate must let an automatic trigger through — ` +
          `otherwise turning its setting on produces silence`,
      ).toBe(true);
    }
  });

  it("the setting, not the constant, decides which ones actually fire", () => {
    const config = resolveMessagingConfig(defaultSettingValues());
    // Both are permitted; only one ships on. That is the whole separation, and
    // it is only visible because "may" and "does" are now different things.
    expect(AUTOMATIC_MESSAGE_KEYS).toContain("PARTIAL_CONFIRMED");
    expect(config.message.PARTIAL_CONFIRMED.auto).toBe(false);
    expect(AUTOMATIC_MESSAGE_KEYS).toContain("PAYMENT_CONFIRMED_V4");
    expect(config.message.PAYMENT_CONFIRMED.auto).toBe(true);
  });

  it("a judgement about a member still cannot fire on its own", () => {
    // What the gate list has always been FOR, unchanged by the fix: a late
    // notice or a winner announcement is the organizer's call, and no setting
    // and no caller can make one send itself.
    for (const key of ["LATE_NOTICE", "LATE_NOTICE_V4", "BEHIND_NOTICE", "WINNER_ANNOUNCEMENT"]) {
      expect(AUTOMATIC_MESSAGE_KEYS as readonly string[]).not.toContain(key);
    }
  });
});

describe("NEVER NOTHING — a payment always leaves a trace of what it told the member", () => {
  const engine = readFileSync("lib/messaging-engine.ts", "utf8");
  const confirmation = readFileSync("lib/payment-confirmation.ts", "utf8");

  it("an unattended skip is recorded, and an attended one is not", () => {
    // THE RULE. A MANUAL send reports its outcome to the face of the person who
    // pressed the button. An AUTOMATIC one fires from an event and a QUEUE one
    // is prepared on a member's behalf — neither has anyone reading the answer,
    // which is why only those two write a row.
    expect(engine).toContain(
      'const unattended = input.trigger === "AUTOMATIC" || input.mode === "QUEUE"',
    );
    // BOUNDED TO deliver() ITSELF. Its callers skip too — "Participation not
    // found", "Person not found" — and those cannot write a row because there
    // is no person to attach one to, which is a different situation and an
    // honest one.
    const start = engine.indexOf("async function deliver(");
    const end = engine.indexOf("export async function sendStatement(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const deliver = engine.slice(start, end);

    // EVERY refusal inside deliver goes through the recorder. A bare
    // `return { status: "SKIPPED" }` here is the defect coming back.
    const bare = deliver.match(/return \{ status: "SKIPPED"/g) ?? [];
    expect(bare).toHaveLength(0);
    // And there are real refusals in there to have routed — an empty scan
    // would satisfy the line above while proving nothing.
    expect((deliver.match(/return skip\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("a composition failure is logged FAILED before it returns", () => {
    // This one happens BEFORE deliver(), so nothing downstream would write a
    // row: the money recorded, the member told nothing, the log silent.
    const branch = confirmation.slice(
      confirmation.indexOf("if (!composed.ok)"),
      confirmation.indexOf("// ————— THE CONFIG GATE"),
    );
    expect(branch).toContain("recordUnsentMessage(");
    expect(branch).toContain('status: "FAILED"');
    expect(branch).toContain("reason: composed.error");
  });

  it("recording the skip can never fail the payment", () => {
    // It runs after the money has committed. A logging problem must not turn a
    // recorded payment into an error on the organizer's screen.
    const recorder = engine.slice(
      engine.indexOf("export async function recordUnsentMessage("),
      engine.indexOf("/** One prepared message, as the organizer's queue shows it. */"),
    );
    expect(recorder).toContain("try {");
    expect(recorder).toContain("catch");
    expect(recorder).toContain("console.error");
    expect(recorder).not.toContain("throw");
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
  autoSendPaymentConfirmedWithPartial: SETTING_DEFAULTS.autoSendPaymentConfirmedWithPartial,
  autoSendPartialCompleted: SETTING_DEFAULTS.autoSendPartialCompleted,
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

describe("META WILL DROP IT — a marketing template must never look sent", () => {
  it("refuses a MARKETING template to a US number, and says why", () => {
    const reason = marketingRefusal("GROUP_ANNOUNCEMENT", "+13015416005");
    expect(reason).toBeTruthy();
    // THE ORGANIZER'S NEXT ACTION IS IN THE SENTENCE. "Undeliverable" tells him
    // nothing he can do; the remedy is at Meta, not in this codebase.
    expect(reason).toContain("MARKETING");
    expect(reason).toContain("United States");
    expect(reason).toContain("UTILITY");
  });

  it("does NOT refuse the same template to a non-US number", () => {
    // The restriction is Meta's and it is specific. Refusing everyone would
    // withhold messages that would have arrived.
    expect(marketingRefusal("GROUP_ANNOUNCEMENT", "+251911234567")).toBeNull();
  });

  it("PARTIAL_COMPLETED is deliverable again — resubmitted and confirmed UTILITY", () => {
    // 16 Aug 2026. It was refused while Meta had it filed as MARKETING; the
    // resubmission came back UTILITY and the refusal was lifted ON THAT READ,
    // not on the resubmission. A US member receives it again.
    expect(marketingRefusal("PARTIAL_COMPLETED", "+13015416005")).toBeNull();
  });

  it("does NOT refuse a UTILITY template to a US number", () => {
    // partial_confirmed delivered to the same number 49 seconds before
    // partial_completed was dropped. Only the category differed.
    expect(marketingRefusal("PARTIAL_CONFIRMED", "+13015416005")).toBeNull();
    expect(marketingRefusal("PAYMENT_CONFIRMED_V4", "+13015416005")).toBeNull();
  });

  it("names exactly the templates Meta currently files as MARKETING", () => {
    // EXACT, not a minimum. This list is a claim about somebody else's system;
    // scripts/check-template-categories.mts verifies it against Twilio, and this
    // stops it growing or shrinking by accident in between.
    //
    // IT SHRANK BY ONE ON 16 AUG 2026, and only by one. Both templates were
    // resubmitted together; partial_completed came back UTILITY and left,
    // group_announcement came back MARKETING again and stayed. Membership is
    // decided by the category read, never by the fact of a resubmission.
    expect([...MARKETING_TEMPLATE_KEYS]).toEqual(["GROUP_ANNOUNCEMENT"]);
  });

  it("the send path asks BEFORE handing anything to Twilio", () => {
    const engine = readFileSync("lib/messaging-engine.ts", "utf8");
    const deliver = engine.slice(
      engine.indexOf("async function deliver("),
      engine.indexOf("export async function sendStatement("),
    );
    const refusal = deliver.indexOf("marketingRefusal(");
    expect(refusal).toBeGreaterThan(-1);
    // Before the provider call, so no SID and no ACCEPTED row is ever created
    // for a message Meta has already decided not to deliver.
    expect(refusal).toBeLessThan(deliver.indexOf("sendWhatsAppMessage("));
    // And it routes through skip(), so an automatic send still leaves the row
    // that explains why nobody was told.
    expect(deliver.slice(refusal, refusal + 200)).toContain("skip(");
  });
});

describe("ACCEPTED MUST NOT MEAN DELIVERED FOREVER", () => {
  it("the reconciliation looks at ACCEPTED rows, which are the ones that go stale", () => {
    const script = readFileSync("scripts/reconcile-message-status.mts", "utf8");
    // IT ONLY LOOKED AT SENT UNTIL 15 AUG 2026 — the six rows that could not be
    // wrong — and reported "0 of 6 disagree" while 75 rows were stale.
    expect(script).toContain('status: { in: ["SENT", "ACCEPTED"] }');
  });

  it("the organizer can run it himself, without a terminal (2.23)", () => {
    const actions = readFileSync("app/actions/messages.ts", "utf8");
    const page = readFileSync("app/admin/(protected)/messages/page.tsx", "utf8");
    expect(actions).toContain("export async function reconcileDeliveries()");
    expect(page).toContain("<DeliveryCheck />");
  });

  it("it corrects ONLY the status and the reason, never what was said", () => {
    const lib = readFileSync("lib/message-reconcile.ts", "utf8");
    const update = lib.slice(lib.indexOf("await prisma.messageLog.update("));
    const data = update.slice(update.indexOf("data:"), update.indexOf("});"));
    // The body, the recipient and the template are the record of what was said
    // and are append-only. Touching them here would be editing history.
    for (const field of ["body", "toPhone", "templateKey", "personId", "trigger"]) {
      expect(data, `${field} must never be rewritten by reconciliation`).not.toContain(field);
    }
    expect(data).toContain("status");
    expect(data).toContain("error");
  });
});

describe("A COMPLETING PAYMENT ALWAYS LEAVES A RECORD", () => {
  const confirmation = readFileSync("lib/payment-confirmation.ts", "utf8");

  it("the completion routes, composes and is never dropped", () => {
    // THE REPORT, 16 Aug 2026: a payment completing a part-paid week "sent no
    // message". It had in fact been QUEUED, twice, with correct bodies — the
    // record was there and the organizer could not see it from where he works.
    // The routing was never the problem, and this pins that down.
    // WEEKS 1 TO 14 SETTLED, so the $800 lands where it is meant to. Coverage
    // runs oldest first: with the earlier weeks empty this payment would go to
    // week 1 and the test would describe a different event entirely.
    const { key, extras, text } = messageFor({
      amount: 80_000, // $800 onto a week holding $1,200 of $2,000
      covered: { ...paidThrough(14), 15: 120_000 },
      standing: { weeksCredited: 15 },
    });
    expect(key).toBe("PARTIAL_COMPLETED");
    expect(extras.priorPaidOnWeek).toBe(120_000);
    expect(text).toContain("already paid $1,200");
    expect(text).toContain("now paid in full");
  });

  it("every routed key produces EITHER a send or a queue — there is no third path", () => {
    // The gate is a boolean over a config key that always resolves, so the
    // ternary is total. A key whose setting did not resolve would be the hole
    // this test exists to rule out.
    const gate = confirmation.slice(confirmation.indexOf("const auto ="));
    expect(gate).toContain("await sendStatement({");
    expect(gate).toContain("await queueStatement({");
    // No branch between them that could return without doing either.
    expect(gate).not.toContain("return { outcome: { status: \"SKIPPED\"");
  });

  it("every payment key has its own config key, and every one resolves", () => {
    // PARTIAL_COMPLETED rode on PARTIAL_CONFIRMED's switch until 15 Aug 2026.
    // Splitting them is what made this message queue: the new key had no stored
    // row and fell back to its shipped default of OFF, so an install that had
    // turned the shared switch ON went quiet. That is what
    // scripts/seed-partial-settings.mts exists to carry across.
    const config = resolveMessagingConfig(defaultSettingValues());
    for (const key of [
      "PAYMENT_CONFIRMED_V4",
      "PAYMENT_CONFIRMED_WITH_PARTIAL",
      "PARTIAL_CONFIRMED",
      "PARTIAL_COMPLETED",
    ] as PaymentMessageKey[]) {
      const configKey = configKeyForPaymentMessage(key);
      expect(CONFIGURABLE_MESSAGE_KEYS as readonly string[]).toContain(configKey);
      // Resolves to a real boolean, never undefined — the "falls through to a
      // default that skips" shape.
      expect(typeof config.message[configKey].auto).toBe("boolean");
    }
  });

  it("the queue reason names the RIGHT switch for each message", () => {
    // It said "messages about money still owed" on the completion — a message
    // whose whole point is that the week is now paid in full. A reason that
    // describes a different message sends him to the wrong switch.
    const reason = confirmation.slice(
      confirmation.indexOf("function queueReasonFor("),
      confirmation.indexOf("export type PaymentConfirmation"),
    );
    expect(reason).toContain('case "PARTIAL_COMPLETED":');
    const completed = reason.slice(reason.indexOf('case "PARTIAL_COMPLETED":'));
    expect(completed).toContain("now complete");
    expect(completed).not.toContain("still owed");
  });

  it("a new settings key must carry the old shared value across", () => {
    // The migration that stops a split from going quiet. It is a script rather
    // than a SQL migration because it copies a VALUE the organizer chose, and
    // it must never overwrite a decision he has since made.
    const seed = readFileSync("scripts/seed-partial-settings.mts", "utf8");
    expect(seed).toContain('const SOURCE = "autoSendPartialConfirmed"');
    expect(seed).toContain("autoSendPartialCompleted");
    expect(seed).toContain("already set to");
  });
});
