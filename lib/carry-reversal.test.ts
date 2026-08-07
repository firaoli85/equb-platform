import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { carryReversalClause } from "./carry-reversal";

describe("the clause a caller appends to its own audit entry", () => {
  it("says nothing when there was no deduction to reverse", () => {
    expect(carryReversalClause({ restored: 0, entries: 0 })).toBe("");
  });

  it("names the money that is owed again", () => {
    const clause = carryReversalClause({ restored: 100_000, entries: 1 });
    expect(clause).toContain("$1,000");
    expect(clause).toContain("owed again");
  });
});

// ————————————————————————————————————————————————————————————————
// GUARD — every path that destroys or resets a payout reverses the ledger half.
//
// A carry deduction is ONE fact in TWO rows: Payout.netAmount goes down, and a
// LedgerEntry PAYMENT says the member settled that much out of it.
//
// Only the payout half was reversible. Five paths destroy or reset a payout,
// and every one of them left the PAYMENT entry standing: the member's balance
// read as settled while the payout was gone or restored to full, so they
// collected the whole amount AND kept the credit. Nothing in the repo ever
// deleted or updated a LedgerEntry, so there was no path back.
//
// The asymmetry was visible inside deletePayout itself, which called
// unsettlePayout to reverse the winner-week settlement — because that half had
// a foreign key — and did nothing for the deduction, because that half had
// none. It has one now.
//
// This scans for the payout-destroying calls and fails when one ships without
// the reversal beside it. Its limit, stated: it matches on the call shape, so
// a path that deletes a payout through an unnamed helper would slip past.
// ————————————————————————————————————————————————————————————————

const ROOT = join(import.meta.dirname, "..");
const ACTIONS = join(ROOT, "app/actions");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function actionsIn(source: string): { name: string; body: string }[] {
  return source
    .split(/export async function /)
    .slice(1)
    .map((p) => ({ name: p.slice(0, p.indexOf("(")).trim(), body: p }));
}

describe("GUARD — destroying a payout reverses its carry deduction", () => {
  /**
   * Actions that touch a payout WITHOUT needing the reversal, each with the
   * reason. Anything else that deletes a payout, or writes netAmount from
   * something other than a deduction, must carry it.
   */
  const EXEMPT: Record<string, string> = {
    // Creates payouts; there is nothing yet to reverse.
    addWinnerToWeek: "creates a payout, never destroys one",
    // assignPayoutManually was exempted here with the reason "its replace path
    // deletes through undoDraw". That was simply WRONG — it calls
    // `tx.payout.deleteMany` directly, and the exemption is what let the guard
    // pass while the action still stranded a carry deduction. An EXEMPT entry
    // is a claim about the code, and this one was never checked.
    recordDraw: "creates",
    spinWheel: "creates",
    // This IS the deduction.
    deductCarryFromPayout: "it is the action that makes the deduction",
    // Collect only flips status and paidAt.
    collectPayout: "flips status, never touches netAmount",
  };

  it("every payout-destroying action calls reverseCarryDeduction", () => {
    const offenders: string[] = [];
    // `payout.delete` / `payout.deleteMany` — the row goes.
    const destroys = /tx\.payout\.(delete|deleteMany)\b/;

    for (const file of tsFiles(ACTIONS)) {
      const source = readFileSync(file, "utf8");
      for (const action of actionsIn(source)) {
        if (EXEMPT[action.name]) continue;
        if (!destroys.test(action.body)) continue;
        if (action.body.includes("reverseCarryDeduction")) continue;
        offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")} :: ${action.name}`);
      }
    }

    expect(
      offenders,
      "These actions delete a payout without reversing the carried-balance " +
        "deduction that may have come out of it (D-23). The member would keep " +
        "the credit on their ledger while the payout that paid for it is gone.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the reversal itself deletes the ledger row and audits it", () => {
    // Accepting `reverseCarryDeduction` above is only safe while it really
    // undoes the entry. If this module is ever gutted, this test notices —
    // not a member who kept a credit.
    const source = readFileSync(join(ROOT, "lib/carry-reversal.ts"), "utf8");
    expect(source).toMatch(/tx\.ledgerEntry\.delete/);
    expect(source).toMatch(/logAudit/);
    expect(source).toContain('type: "PAYMENT"');
  });

  it("the deduction writes the link the reversal finds it by", () => {
    const source = readFileSync(join(ROOT, "app/actions/carry-deduction.ts"), "utf8");
    expect(source).toMatch(/payoutId: payout\.id/);
  });

  it("the re-read that bounds the amount happens INSIDE the transaction", () => {
    // It used the plain client while sitting inside serializableTransaction,
    // so Postgres SSI had no read-set on ledger_entries and two concurrent
    // deductions against the same balance both committed.
    const source = readFileSync(join(ROOT, "app/actions/carry-deduction.ts"), "utf8");
    expect(source).toMatch(/loadPayoutContext\(tx, input\.payoutId\)/);
    expect(source).not.toMatch(/loadPayoutContext\(prisma, input\.payoutId\)[\s\S]{0,400}applyCarryDeduction/);
  });

  it("a COLLECTED payout cannot be deducted from", () => {
    const source = readFileSync(join(ROOT, "app/actions/carry-deduction.ts"), "utf8");
    expect(source).toMatch(/payout\.status === "COLLECTED"/);
  });
});
