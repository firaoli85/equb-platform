import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCarryDeduction,
  carryChoiceSummary,
  carryOffer,
  deductionRefusal,
  isCarryChoice,
  originSentence,
  type CarryIntention,
} from "./carry-balance";

// D-23: A CARRIED BALANCE IS NEVER TAKEN AUTOMATICALLY.
//
// This was the least-defended important protection in the codebase — a branch
// in a wizard with no test behind it. These tests are that protection.
//
// The load-bearing assertion is the negative one: an INTENTION recorded weeks
// earlier changes only whether a tick-box arrives pre-ticked. It can never, by
// any path, reduce a payout on its own.

const intention = (over: Partial<CarryIntention> = {}): CarryIntention => ({
  choice: "deduct",
  amountAtChoice: 125_000,
  decidedAt: new Date("2026-08-01T00:00:00Z"),
  cycleName: "Cycle 2 2026",
  ...over,
});

describe("the offer never applies anything", () => {
  it("offers, and reports what WOULD happen — it does not deduct", () => {
    const offer = carryOffer({
      ledgerBalance: 125_000, // $1,250 carried
      payoutNet: 980_000, // $9,800 payout
      intention: intention(),
    });
    expect(offer.kind).toBe("offer");
    if (offer.kind !== "offer") return;

    expect(offer.balance).toBe(125_000);
    expect(offer.suggested).toBe(125_000);
    expect(offer.netIfApplied).toBe(855_000); // $8,550 — IF confirmed
    // The result type has no "deducted" field at all: there is nothing here
    // a caller could mistake for money already moved.
    expect(offer).not.toHaveProperty("deducted");
    expect(offer).not.toHaveProperty("netAfter");
  });

  it("PRE-TICKS only when the organizer chose 'deduct' for this cycle", () => {
    const base = { ledgerBalance: 125_000, payoutNet: 980_000 };
    const ticked = carryOffer({ ...base, intention: intention({ choice: "deduct" }) });
    expect(ticked.kind === "offer" && ticked.preTicked).toBe(true);

    for (const choice of ["leave", "settle-now"] as const) {
      const offer = carryOffer({ ...base, intention: intention({ choice }) });
      expect(offer.kind === "offer" && offer.preTicked, choice).toBe(false);
    }
    const noIntention = carryOffer({ ...base, intention: null });
    expect(noIntention.kind === "offer" && noIntention.preTicked).toBe(false);
  });

  it("still OFFERS when they chose 'leave' — the organizer may change his mind (2.2)", () => {
    // Untickled, so the default action hands over the full payout; but the
    // option is there, because discretion at the table is a feature.
    const offer = carryOffer({
      ledgerBalance: 125_000,
      payoutNet: 980_000,
      intention: intention({ choice: "leave" }),
    });
    expect(offer.kind).toBe("offer");
    expect(offer.kind === "offer" && offer.preTicked).toBe(false);
  });

  it("says WHERE a pre-ticked offer came from", () => {
    const offer = carryOffer({
      ledgerBalance: 125_000,
      payoutNet: 980_000,
      intention: intention({ cycleName: "Cycle 2 2026" }),
    });
    expect(offer.kind === "offer" && offer.origin).toBe(
      "You chose this when adding them to Cycle 2 2026.",
    );
    expect(originSentence(intention())).toContain("when adding them to");
  });

  it("offers nothing, with a reason, when there is nothing to offer", () => {
    expect(carryOffer({ ledgerBalance: 0, payoutNet: 980_000 })).toEqual({
      kind: "none",
      reason: "They carry no balance.",
    });
    expect(carryOffer({ ledgerBalance: 125_000, payoutNet: 0 })).toEqual({
      kind: "none",
      reason: "There is nothing left in this payout to deduct from.",
    });
  });

  it("never proposes more than the payout holds", () => {
    // Balance $12,000, payout $9,800 → the offer caps at the payout.
    const offer = carryOffer({ ledgerBalance: 1_200_000, payoutNet: 980_000 });
    expect(offer.kind === "offer" && offer.suggested).toBe(980_000);
    expect(offer.kind === "offer" && offer.maxDeductible).toBe(980_000);
    expect(offer.kind === "offer" && offer.netIfApplied).toBe(0);
  });

  it("uses the LIVE balance, not the amount recorded at the choice", () => {
    // They chose "deduct" when they owed $1,250, then paid $1,000 of it off.
    // Only $250 may be offered.
    const offer = carryOffer({
      ledgerBalance: 25_000,
      payoutNet: 980_000,
      intention: intention({ amountAtChoice: 125_000 }),
    });
    expect(offer.kind === "offer" && offer.suggested).toBe(25_000);
  });
});

describe("applying requires an explicit organizer confirmation", () => {
  const base = { amount: 125_000, ledgerBalance: 125_000, payoutNet: 980_000 };

  it("REFUSES without confirmation — this is the whole rule", () => {
    const result = applyCarryDeduction({ ...base, confirmedByOrganizer: false });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(
      "A carried balance is never taken automatically — the organizer must confirm this deduction.",
    );
  });

  it("refuses even when an intention said 'deduct' — an intention is not consent", () => {
    // There is no path from `intention.choice === "deduct"` into this
    // function: it takes no intention at all. Stated as a test because it is
    // the exact confusion D-23 exists to prevent.
    expect(applyCarryDeduction({ ...base, confirmedByOrganizer: false }).ok).toBe(false);
  });

  it("applies once confirmed, and the arithmetic is plain", () => {
    const result = applyCarryDeduction({ ...base, confirmedByOrganizer: true });
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.data).toEqual({
      deducted: 125_000,
      netAfter: 855_000, // $9,800 − $1,250
      balanceAfter: 0,
    });
  });

  it("takes a PARTIAL amount when the organizer edits the figure down", () => {
    const result = applyCarryDeduction({ ...base, amount: 50_000, confirmedByOrganizer: true });
    expect(result.ok === true && result.data).toEqual({
      deducted: 50_000,
      netAfter: 930_000,
      balanceAfter: 75_000,
    });
  });

  it("refuses more than they carry, and more than the payout holds", () => {
    expect(
      applyCarryDeduction({ ...base, amount: 200_000, confirmedByOrganizer: true }),
    ).toEqual({ ok: false, error: "That is more than they carry." });

    expect(
      applyCarryDeduction({
        confirmedByOrganizer: true,
        amount: 1_000_000,
        ledgerBalance: 1_200_000,
        payoutNet: 980_000,
      }),
    ).toEqual({ ok: false, error: "That is more than this payout holds." });
  });

  it("refuses zero, negative and non-integer amounts", () => {
    for (const amount of [0, -1, 12.5, Number.NaN]) {
      const result = applyCarryDeduction({ ...base, amount, confirmedByOrganizer: true });
      expect(result.ok, String(amount)).toBe(false);
    }
  });

  it("returns a refusal rather than throwing — a caller cannot ignore it", () => {
    // Not catching an exception is easy; not handling a discriminated union
    // and still reading `.data` is a type error.
    expect(() => applyCarryDeduction({ ...base, confirmedByOrganizer: false })).not.toThrow();
    expect(deductionRefusal({ ...base, confirmedByOrganizer: false })).toBeTruthy();
    expect(deductionRefusal({ ...base, confirmedByOrganizer: true })).toBeNull();
  });
});

describe("the recorded choice", () => {
  it("recognises exactly the three choices", () => {
    for (const value of ["leave", "deduct", "settle-now"]) {
      expect(isCarryChoice(value)).toBe(true);
    }
    for (const value of ["DEDUCT", "", null, undefined, 1, "auto"]) {
      expect(isCarryChoice(value)).toBe(false);
    }
  });

  it("records 'deduct' as an INTENTION in the audit wording, never as done", () => {
    const said = carryChoiceSummary("deduct");
    expect(said).toContain("INTENTION only");
    expect(said).toContain("requires confirmation");
    expect(said).toContain("never applied automatically");
  });
});

// ————————————————————————————————————————————————————————————————
// THE GUARD.
//
// The tests above prove the pure functions behave. This one proves nothing
// ELSE in the codebase quietly does the same arithmetic somewhere else — the
// failure mode that made D-1 a gap in the first place was not a wrong
// function, it was the rule living in one screen with no owner.
//
// Its limits, stated honestly: this is a source scan, not a proof. It catches
// a new subtraction of a balance from a payout written in the obvious way. It
// would not catch arithmetic laundered through several variables. It is a
// tripwire for the likely mistake, not a guarantee against a determined one.
// ————————————————————————————————————————————————————————————————

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["app", "lib", "components"];
/** The one module allowed to reduce a payout by a balance. */
const OWNER = "lib/carry-balance.ts";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

describe("GUARD — no other code path deducts a balance from a payout", () => {
  it("scans a realistic number of files (the walker itself works)", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it("only lib/carry-balance.ts subtracts a balance from a payout", () => {
    // A subtraction with a balance-ish name on one side and a payout-ish name
    // on the other, in either order.
    const BALANCE = "[A-Za-z.]*(?:ledgerBalance|carriedBalance|carried|balance)[A-Za-z.]*";
    const PAYOUT = "[A-Za-z.]*(?:payoutNet|netAmount|payout|net)[A-Za-z.]*";
    const pattern = new RegExp(`(?:${PAYOUT})\\s*-\\s*(?:${BALANCE})`, "i");

    const offenders: string[] = [];
    for (const file of files) {
      if (rel(file) === OWNER) continue;
      const source = readFileSync(file, "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        // Comments describe the rule; they are not code paths.
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (pattern.test(code)) offenders.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
      }
    }

    expect(
      offenders,
      "A payout may only be reduced by a carried balance through " +
        "applyCarryDeduction(), which requires confirmedByOrganizer (D-23).\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("every caller of applyCarryDeduction passes an explicit confirmation", () => {
    const callers = files.filter(
      (f) => rel(f) !== OWNER && readFileSync(f, "utf8").includes("applyCarryDeduction("),
    );
    for (const file of callers) {
      const source = readFileSync(file, "utf8");
      expect(
        source,
        `${rel(file)} calls applyCarryDeduction but never mentions confirmedByOrganizer`,
      ).toContain("confirmedByOrganizer");
      // Hardcoding `true` at the call site would defeat the rule as surely as
      // omitting it: the value must come from organizer input.
      expect(
        source.includes("confirmedByOrganizer: true"),
        `${rel(file)} hardcodes confirmedByOrganizer: true — it must come from the organizer`,
      ).toBe(false);
    }
  });

  it("the carry intention is never read as permission to deduct", () => {
    // `applyCarryDeduction` takes no intention, by design. If a future caller
    // wires one in, this fails.
    const owner = readFileSync(join(ROOT, OWNER), "utf8");
    const applyBody = owner.slice(owner.indexOf("export function applyCarryDeduction"));
    expect(applyBody).not.toContain("intention");
    expect(applyBody).not.toContain("preTicked");
  });
});
