import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSettlementReceipt,
  settlementReceiptAmountRefusal,
  settlementReceiptDeleteRefusal,
} from "./settlement-receipt";

const SETTLEMENT = { pinnedWeekId: "week_12", settlementPayoutId: "payout_1" };
const ORDINARY = { pinnedWeekId: null, settlementPayoutId: null };

describe("what counts as a settlement receipt", () => {
  it("both links present — it came out of a payout", () => {
    expect(isSettlementReceipt(SETTLEMENT)).toBe(true);
  });

  it("an ordinary receipt is not one", () => {
    expect(isSettlementReceipt(ORDINARY)).toBe(false);
  });

  it("a half-linked row is NOT treated as one", () => {
    // `pinnedWeek` is onDelete: SetNull, so a deleted week leaves the pin
    // null while settlementPayoutId survives. Neither half alone proves a
    // live pair, and guessing wrong in this direction only blocks an edit
    // that has no payout to keep in step.
    expect(isSettlementReceipt({ pinnedWeekId: "week_12", settlementPayoutId: null })).toBe(false);
    expect(isSettlementReceipt({ pinnedWeekId: null, settlementPayoutId: "payout_1" })).toBe(false);
  });
});

describe("deleting", () => {
  it("refuses, and says where the reversal actually lives", () => {
    const refusal = settlementReceiptDeleteRefusal(SETTLEMENT);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("Undo the draw");
    expect(refusal).toContain("remove that winner from the week");
  });

  it("an ordinary receipt deletes freely", () => {
    expect(settlementReceiptDeleteRefusal(ORDINARY)).toBeNull();
  });
});

describe("editing the amount", () => {
  it("refuses a change, and names both places the money can be moved properly", () => {
    const refusal = settlementReceiptAmountRefusal({
      receipt: SETTLEMENT,
      amountBefore: 50_000,
      amountAfter: 1,
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("weekly amount");
    expect(refusal).toContain("Collections");
    // It must say what IS still allowed, or it reads as "this row is frozen".
    expect(refusal).toContain("date, method and notes");
  });

  it("refuses a RISE as well as a cut — both halves move together or neither does", () => {
    expect(
      settlementReceiptAmountRefusal({
        receipt: SETTLEMENT,
        amountBefore: 50_000,
        amountAfter: 90_000,
      }),
    ).not.toBeNull();
  });

  it("allows the date/method/notes edit that leaves the amount alone", () => {
    expect(
      settlementReceiptAmountRefusal({
        receipt: SETTLEMENT,
        amountBefore: 50_000,
        amountAfter: 50_000,
      }),
    ).toBeNull();
  });

  it("an ordinary receipt's amount is freely editable", () => {
    expect(
      settlementReceiptAmountRefusal({
        receipt: ORDINARY,
        amountBefore: 50_000,
        amountAfter: 1,
      }),
    ).toBeNull();
  });
});

// ————————————————————————————————————————————————————————————————
// GUARD — identification must never go back to sniffing text.
//
// The UI recognised settlement receipts with
// `event.notes?.includes("settled from the payout")`. The Save button on the
// same row can empty the notes, so one ordinary edit made a settlement receipt
// stop looking like one — while the money link to the payout survived. The
// warning disappeared; the trap did not.
// ————————————————————————————————————————————————————————————————

const ROOT = join(import.meta.dirname, "..");

describe("GUARD — no code identifies a settlement receipt by its notes", () => {
  const FILES = [
    "app/admin/(protected)/people/[id]/participation-editor.tsx",
    "app/actions/edits.ts",
  ];

  it("the phrase in the notes is never used as a test", () => {
    for (const file of FILES) {
      const source = readFileSync(join(ROOT, file), "utf8");
      // The phrase may be WRITTEN (draw-settlement composes it) and may be
      // displayed. It must never be read back as proof of anything.
      expect(source, file).not.toMatch(/notes[^\n]*\.includes\(\s*["'`]settled from the payout/);
    }
  });
});
