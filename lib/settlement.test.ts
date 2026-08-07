import { describe, expect, it } from "vitest";
import {
  allocatePinned,
  computeTermsSettlement,
  nameConfirmed,
  planWinnerWeekSettlement,
  resizeWinnerWeekSettlement,
  settledSoFarFromLedger,
  settlementDescriptionPrefix,
  settlementLedgerTag,
} from "./settlement";
import { ledgerBalance } from "./ledger";

// Real figures throughout — the organizer's own example: a $1,000 number
// over 20 weeks grosses $20,000, fee 2% = $400, net $19,600; the winner's
// $1,000 week-5 contribution comes out of it → $18,600 handed over.

describe("planWinnerWeekSettlement — the winner does not pay the week they win", () => {
  it("deducts the full week from the payout when nothing was paid", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 100_000,
      alreadyPaidOnWeek: 0,
      payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
    });
    expect(plan).toEqual({
      perPayout: [{ payoutId: "p1", deduct: 100_000 }],
      totalSettled: 100_000,
      unabsorbed: 0,
    });
  });

  it("deducts only the uncovered part of a partially paid week", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 100_000,
      alreadyPaidOnWeek: 40_000,
      payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
    });
    expect(plan.perPayout).toEqual([{ payoutId: "p1", deduct: 60_000 }]);
    expect(plan.totalSettled).toBe(60_000);
  });

  it("settles nothing for an excused week (amountDue 0) or an already covered week", () => {
    expect(
      planWinnerWeekSettlement({
        amountDue: 0,
        alreadyPaidOnWeek: 0,
        payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
      }).totalSettled,
    ).toBe(0);
    expect(
      planWinnerWeekSettlement({
        amountDue: 100_000,
        alreadyPaidOnWeek: 100_000,
        payouts: [{ payoutId: "p1", netAmount: 1_960_000 }],
      }).totalSettled,
    ).toBe(0);
  });

  it("waterfalls across several payouts in order", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 150_000,
      alreadyPaidOnWeek: 0,
      payouts: [
        { payoutId: "p1", netAmount: 90_000 },
        { payoutId: "p2", netAmount: 980_000 },
      ],
    });
    expect(plan.perPayout).toEqual([
      { payoutId: "p1", deduct: 90_000 },
      { payoutId: "p2", deduct: 60_000 },
    ]);
    expect(plan.unabsorbed).toBe(0);
  });

  it("reports what the payouts cannot absorb — the caller must refuse", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 100_000,
      alreadyPaidOnWeek: 0,
      payouts: [{ payoutId: "p1", netAmount: 30_000 }],
    });
    expect(plan.totalSettled).toBe(30_000);
    expect(plan.unabsorbed).toBe(70_000);
  });

  it("skips a payout whose net is already zero or negative", () => {
    const plan = planWinnerWeekSettlement({
      amountDue: 50_000,
      alreadyPaidOnWeek: 0,
      payouts: [
        { payoutId: "p1", netAmount: 0 },
        { payoutId: "p2", netAmount: 980_000 },
      ],
    });
    expect(plan.perPayout).toEqual([{ payoutId: "p2", deduct: 50_000 }]);
  });
});

describe("allocatePinned — a settlement replays onto its pinned week ONLY", () => {
  it("fills the pinned week exactly", () => {
    expect(
      allocatePinned(100_000, { amountDue: 100_000, amountAlreadyPaid: 0, isSkipped: false }),
    ).toEqual({ applied: 100_000, unallocated: 0 });
  });

  it("never overfills — the excess is unallocated, not moved to another week", () => {
    expect(
      allocatePinned(100_000, { amountDue: 100_000, amountAlreadyPaid: 70_000, isSkipped: false }),
    ).toEqual({ applied: 30_000, unallocated: 70_000 });
  });

  it("applies nothing to a SKIPPED week — nobody ever owed it", () => {
    expect(
      allocatePinned(100_000, { amountDue: 100_000, amountAlreadyPaid: 0, isSkipped: true }),
    ).toEqual({ applied: 0, unallocated: 100_000 });
  });

  // Organizer ruling (Aug 2026): deferral spares the chasing, not the debt —
  // so the winner does not pay the week they win even when it was deferred.
  it("still settles a DEFERRED week in full — the debt was real", () => {
    expect(
      allocatePinned(100_000, { amountDue: 100_000, amountAlreadyPaid: 0, isSkipped: false }),
    ).toEqual({ applied: 100_000, unallocated: 0 });
  });
});

describe("computeTermsSettlement — a paid-out member changing terms", () => {
  it("the organizer's example: received $19,600, now $500/week x 20 weeks → holds $9,800 too much", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 100_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 50_000,
      newWeeksCommitted: 20,
      feePercent: 2,
      alreadyReceived: 1_960_000,
    });
    expect(result.oldEntitlementGross).toBe(2_000_000);
    expect(result.newEntitlementGross).toBe(1_000_000);
    expect(result.newFee).toBe(20_000);
    expect(result.newEntitlementNet).toBe(980_000);
    expect(result.gap).toBe(980_000);
    // $500/week nets $490/week at 2% — $19,600 / $490 = 40 weeks balances it.
    expect(result.balancingWeeksExact).toBeCloseTo(40, 10);
    expect(result.balancingWeeksWhole).toBe(40);
  });

  it("the reverse: they increased and are now owed more than they received", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 50_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 100_000,
      newWeeksCommitted: 20,
      feePercent: 2,
      alreadyReceived: 980_000,
    });
    expect(result.newEntitlementNet).toBe(1_960_000);
    expect(result.gap).toBe(-980_000);
  });

  it("unchanged entitlement → zero gap, nothing owed either way", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 100_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 100_000,
      newWeeksCommitted: 20,
      feePercent: 2,
      alreadyReceived: 1_960_000,
    });
    expect(result.gap).toBe(0);
  });

  it("balancing weeks rounds to the nearest whole week when nothing balances exactly", () => {
    const result = computeTermsSettlement({
      oldWeeklyAmount: 100_000,
      oldWeeksCommitted: 20,
      newWeeklyAmount: 30_000,
      newWeeksCommitted: 10,
      feePercent: 0,
      alreadyReceived: 1_000_000,
    });
    // $10,000 / $300 = 33.33… → 33 whole weeks.
    expect(result.balancingWeeksWhole).toBe(33);
    expect(result.balancingWeeksExact).toBeCloseTo(33.3333, 3);
  });
});

describe("nameConfirmed — type the member's name, any name they go by", () => {
  const person = { nameEnglishFirst: "Abebe", nameEnglishLast: "Kebede", nameAmharic: "አበበ" };

  it("accepts first name, full name, and Amharic name — case and spacing forgiving", () => {
    expect(nameConfirmed("Abebe", person)).toBe(true);
    expect(nameConfirmed("  abebe  KEBEDE ", person)).toBe(true);
    expect(nameConfirmed("አበበ", person)).toBe(true);
  });

  it("rejects a wrong or empty name", () => {
    expect(nameConfirmed("Almaz", person)).toBe(false);
    expect(nameConfirmed("", person)).toBe(false);
    expect(nameConfirmed("   ", person)).toBe(false);
  });
});

// ————————————————— AUDIT H4: settlement is idempotent —————————————————
//
// The reported defect, reproduced to the cent. A $1,000/week × 20-week member
// is drawn: gross $20,000, fee $400, net $19,600, of which their own week-5
// contribution of $1,000 is settled from the payout ($18,600 handed over,
// $1,000 pinned receipt). The organizer then edits their terms TWICE.
//
// Old behaviour: $9,800 charged, then $11,260 charged = $21,060 against a
// true final gap of $11,760 — because (a) each edit re-charged the whole gap
// and (b) resizing the win-week receipt destroyed $500 of recorded cash.

const CYCLE_ID = "cyc_abc123";
const CYCLE = "Cycle 1";
const PREFIX = settlementDescriptionPrefix(CYCLE);

type Entry = {
  type: "DEBT" | "PAYMENT";
  amount: number;
  description: string;
  notes: string | null;
};

/** One edit of a drawn member's terms, exactly as the action now does it. */
function applyEdit(
  state: { payoutNet: number; settlementEvent: number; ledger: Entry[] },
  next: { weekly: number; weeks: number; oldWeekly: number; oldWeeks: number },
) {
  const alreadyReceived = state.payoutNet + state.settlementEvent;
  const terms = computeTermsSettlement({
    oldWeeklyAmount: next.oldWeekly,
    oldWeeksCommitted: next.oldWeeks,
    newWeeklyAmount: next.weekly,
    newWeeksCommitted: next.weeks,
    feePercent: 2,
    alreadyReceived,
  });
  const priorSettled = settledSoFarFromLedger(state.ledger, CYCLE_ID);
  const gap = terms.gap - priorSettled;
  if (gap > 0) {
    state.ledger.push({
      type: "DEBT",
      amount: gap,
      description: `${PREFIX} terms cut after payout — nothing returned`,
      notes: settlementLedgerTag(CYCLE_ID, "debt"),
    });
  } else if (gap < 0) {
    state.ledger.push({
      type: "PAYMENT",
      amount: -gap,
      description: `${PREFIX} terms increased after payout — owed TO them`,
      notes: settlementLedgerTag(CYCLE_ID, "credit"),
    });
  }
  // The win-week receipt is resized to the new weekly, and the difference is
  // credited BACK to the payout it came out of.
  const { resized, credit } = resizeWinnerWeekSettlement(state.settlementEvent, next.weekly);
  state.settlementEvent = resized;
  state.payoutNet += credit;
  return { alreadyReceived, totalGap: terms.gap, priorSettled, charged: gap };
}

describe("audit H4 — a repeated edit charges the DIFFERENCE, never the gap again", () => {
  it("the reported scenario: two edits total $11,760, not $21,060", () => {
    const state = { payoutNet: 1_860_000, settlementEvent: 100_000, ledger: [] as Entry[] };

    // Edit 1 — $1,000/wk × 20  →  $500/wk × 20.
    const first = applyEdit(state, { weekly: 50_000, weeks: 20, oldWeekly: 100_000, oldWeeks: 20 });
    expect(first.alreadyReceived).toBe(1_960_000); // $19,600
    expect(first.charged).toBe(980_000); // $9,800
    // The resize credited $500 back instead of destroying it.
    expect(state.settlementEvent).toBe(50_000);
    expect(state.payoutNet).toBe(1_910_000);

    // Edit 2 — $500/wk × 20  →  $500/wk × 16.
    const second = applyEdit(state, { weekly: 50_000, weeks: 16, oldWeekly: 50_000, oldWeeks: 20 });
    // "Already received" is INVARIANT — the credit kept the books whole.
    expect(second.alreadyReceived).toBe(1_960_000);
    expect(second.totalGap).toBe(1_176_000); // the TRUE gap, $11,760
    expect(second.priorSettled).toBe(980_000);
    expect(second.charged).toBe(196_000); // only the difference, $1,960

    const totalCharged = first.charged + second.charged;
    expect(totalCharged).toBe(1_176_000); // $11,760 — the true gap
    expect(totalCharged).not.toBe(2_106_000); // NOT the reported $21,060
    expect(ledgerBalance(state.ledger)).toBe(1_176_000);
  });

  it("re-running the SAME edit settles nothing more (pure idempotency)", () => {
    const state = { payoutNet: 1_860_000, settlementEvent: 100_000, ledger: [] as Entry[] };
    applyEdit(state, { weekly: 50_000, weeks: 20, oldWeekly: 100_000, oldWeeks: 20 });
    const again = applyEdit(state, { weekly: 50_000, weeks: 20, oldWeekly: 50_000, oldWeeks: 20 });
    expect(again.charged).toBe(0);
    expect(ledgerBalance(state.ledger)).toBe(980_000);
  });

  it("editing BACK to the original terms cancels the settlement out", () => {
    const state = { payoutNet: 1_860_000, settlementEvent: 100_000, ledger: [] as Entry[] };
    applyEdit(state, { weekly: 50_000, weeks: 20, oldWeekly: 100_000, oldWeeks: 20 });
    expect(ledgerBalance(state.ledger)).toBe(980_000);
    const back = applyEdit(state, { weekly: 100_000, weeks: 20, oldWeekly: 50_000, oldWeeks: 20 });
    expect(back.totalGap).toBe(0);
    expect(back.charged).toBe(-980_000); // a credit of exactly what was charged
    expect(ledgerBalance(state.ledger)).toBe(0);
  });
});

describe("settledSoFarFromLedger — recognition is keyed by cycle ID, not name", () => {
  const debt = (amount: number, cycleId = CYCLE_ID): Entry => ({
    type: "DEBT",
    amount,
    description: `${PREFIX} terms cut after payout`,
    notes: settlementLedgerTag(cycleId, "debt"),
  });

  it("counts this cycle's settlement debts and ignores everything else", () => {
    const ledger: Entry[] = [
      debt(980_000),
      // An ordinary carried balance (2.18) — untagged, never recognised.
      {
        type: "DEBT",
        amount: 500_000,
        description: "Cycle 1, 2025 — 8 weeks unpaid",
        notes: null,
      },
      // A settlement in a DIFFERENT cycle.
      debt(300_000, "cyc_other"),
    ];
    expect(settledSoFarFromLedger(ledger, CYCLE_ID)).toBe(980_000);
  });

  it("RENAMING the cycle cannot un-recognise a settlement (the rename bug)", () => {
    // The description embeds the name the cycle had at the time. Recognition
    // must not care — otherwise a rename re-charges a gap already settled.
    const renamed: Entry = {
      type: "DEBT",
      amount: 980_000,
      description: "Settlement in Some Old Name: terms cut after payout",
      notes: settlementLedgerTag(CYCLE_ID, "debt"),
    };
    expect(settledSoFarFromLedger([renamed], CYCLE_ID)).toBe(980_000);
  });

  it("a hand-typed description can never impersonate a settlement", () => {
    // Free-text descriptions are organizer-controlled; only the tag counts.
    const spoof: Entry = {
      type: "DEBT",
      amount: 999_999,
      description: `${PREFIX} terms cut after payout`,
      notes: null,
    };
    expect(settledSoFarFromLedger([spoof], CYCLE_ID)).toBe(0);
  });

  it("similar cycle ids do not collide", () => {
    expect(settledSoFarFromLedger([debt(500_000, "cyc_1")], "cyc_10")).toBe(0);
    expect(settledSoFarFromLedger([debt(500_000, "cyc_10")], "cyc_1")).toBe(0);
  });

  it("returned CASH does not un-recognise the debt it paid", () => {
    // The action writes the whole obligation as a DEBT and the cash as a
    // PAYMENT against it: balance = remainder, recognition = the full gap.
    const ledger: Entry[] = [
      debt(980_000),
      {
        type: "PAYMENT",
        amount: 400_000,
        description: `${PREFIX} returned $4,000 in cash`,
        notes: settlementLedgerTag(CYCLE_ID, "returned"),
      },
    ];
    expect(settledSoFarFromLedger(ledger, CYCLE_ID)).toBe(980_000);
    expect(ledgerBalance(ledger)).toBe(580_000);
  });

  it("a credit for money owed TO them counts the other way", () => {
    const ledger: Entry[] = [
      debt(980_000),
      {
        type: "PAYMENT",
        amount: 980_000,
        description: `${PREFIX} terms increased — owed TO them`,
        notes: settlementLedgerTag(CYCLE_ID, "credit"),
      },
    ];
    expect(settledSoFarFromLedger(ledger, CYCLE_ID)).toBe(0);
  });

  it("an empty ledger recognises nothing", () => {
    expect(settledSoFarFromLedger([], CYCLE_ID)).toBe(0);
  });
});

describe("resizeWinnerWeekSettlement — the cash always lands somewhere (2.14)", () => {
  it("a cheaper week returns the difference to the payout", () => {
    expect(resizeWinnerWeekSettlement(100_000, 50_000)).toEqual({
      resized: 50_000,
      credit: 50_000,
      refusal: null,
    });
  });

  it("an unchanged week moves nothing", () => {
    expect(resizeWinnerWeekSettlement(100_000, 100_000)).toEqual({
      resized: 100_000,
      credit: 0,
      refusal: null,
    });
  });

  it("a DEARER week is funded from the payout — it is not left half-paid", () => {
    // This was the ratchet: Math.min() left the receipt at the old, smaller
    // figure while the week itself now cost more, so the winner was dunned
    // PARTIAL for the very week they won (rule 6) and the payout kept a
    // credit it was no longer entitled to.
    expect(resizeWinnerWeekSettlement(50_000, 100_000, 1_000_000)).toEqual({
      resized: 100_000,
      credit: -50_000,
      refusal: null,
    });
  });

  it("REVERSING an edit puts the books back exactly where they started", () => {
    // $500/wk drawn in week 12, settlement receipt $500, payout net $18,600.
    let event = 50_000;
    let payoutNet = 1_860_000;

    // Cut to $250: the receipt shrinks and $250 goes back to the payout.
    let step = resizeWinnerWeekSettlement(event, 25_000, payoutNet);
    event = step.resized;
    payoutNet += step.credit;
    expect(event).toBe(25_000);
    expect(payoutNet).toBe(1_885_000);

    // Put it back to $500. Under the old ratchet this was a no-op, leaving
    // week 12 half-paid forever.
    step = resizeWinnerWeekSettlement(event, 50_000, payoutNet);
    event = step.resized;
    payoutNet += step.credit;
    expect(step.refusal).toBeNull();
    expect(event).toBe(50_000);
    expect(payoutNet).toBe(1_860_000); // exactly where it started
  });

  it("refuses a rise the payout cannot fund rather than writing a negative payout", () => {
    const step = resizeWinnerWeekSettlement(50_000, 200_000, 100_000);
    expect(step.refusal).not.toBeNull();
    expect(step.refusal).toContain("$1,000"); // what is left in the payout
    expect(step.refusal).toContain("$1,500"); // the extra it would need

    // Exactly enough is allowed — the boundary is a real one, not a margin.
    expect(resizeWinnerWeekSettlement(50_000, 200_000, 150_000).refusal).toBeNull();
  });

  it("without a payout figure it computes but cannot refuse — the caller must pass one", () => {
    expect(resizeWinnerWeekSettlement(50_000, 999_999_00).refusal).toBeNull();
  });

  it("resized + credit always equals what was originally settled", () => {
    for (const [event, weekly] of [
      [100_000, 0],
      [100_000, 37_500],
      [45_000, 45_000],
      [45_000, 1],
      [45_000, 90_000], // the grow path — conservation holds there too
      [0, 50_000],
    ]) {
      const { resized, credit } = resizeWinnerWeekSettlement(event, weekly);
      expect(resized + credit, `${event} → ${weekly}`).toBe(event);
    }
  });
});

describe("audit H4 follow-up — a tag alone is not proof of a settlement", () => {
  // LedgerEntry.notes is ALSO organizer free text: recordLedgerPayment writes
  // whatever is typed. So the entry TYPE must agree with the tag, or a typed
  // note could invent a recognised obligation and suppress a real charge.
  it("ignores a debt tag sitting on a PAYMENT row", () => {
    const spoof: Entry[] = [
      {
        type: "PAYMENT",
        amount: 900_000,
        description: "settling my balance",
        notes: settlementLedgerTag(CYCLE_ID, "debt"),
      },
    ];
    expect(settledSoFarFromLedger(spoof, CYCLE_ID)).toBe(0);
  });

  it("ignores a credit tag sitting on a DEBT row", () => {
    const spoof: Entry[] = [
      {
        type: "DEBT",
        amount: 900_000,
        description: "an old balance",
        notes: settlementLedgerTag(CYCLE_ID, "credit"),
      },
    ];
    expect(settledSoFarFromLedger(spoof, CYCLE_ID)).toBe(0);
  });

  it("still counts the genuine pair the action writes", () => {
    const real: Entry[] = [
      {
        type: "DEBT",
        amount: 980_000,
        description: `${PREFIX} terms cut after payout`,
        notes: settlementLedgerTag(CYCLE_ID, "debt"),
      },
      {
        type: "PAYMENT",
        amount: 980_000,
        description: `${PREFIX} terms increased — owed TO them`,
        notes: settlementLedgerTag(CYCLE_ID, "credit"),
      },
    ];
    expect(settledSoFarFromLedger(real, CYCLE_ID)).toBe(0);
    expect(settledSoFarFromLedger([real[0]], CYCLE_ID)).toBe(980_000);
  });
});
