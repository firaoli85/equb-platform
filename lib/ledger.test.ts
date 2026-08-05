import { describe, expect, it } from "vitest";
import { ledgerBalance } from "./ledger";

describe("ledgerBalance — the carried balance (2.18)", () => {
  it("is zero with no entries", () => {
    expect(ledgerBalance([])).toBe(0);
  });

  it("DEBT raises it, PAYMENT settles it, order doesn't matter", () => {
    expect(
      ledgerBalance([
        { type: "DEBT", amount: 500_000 },
        { type: "PAYMENT", amount: 200_000 },
      ]),
    ).toBe(300_000);
    expect(
      ledgerBalance([
        { type: "PAYMENT", amount: 200_000 },
        { type: "DEBT", amount: 500_000 },
      ]),
    ).toBe(300_000);
  });

  it("never goes negative — an overpayment reads as settled in full", () => {
    expect(
      ledgerBalance([
        { type: "DEBT", amount: 100_000 },
        { type: "PAYMENT", amount: 150_000 },
      ]),
    ).toBe(0);
  });
});
