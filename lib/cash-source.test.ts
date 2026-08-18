import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { cashOnHand, livePosition } from "./cycle-position";
import { cashPosition } from "./dashboard";

// GUARD — ONE CASH TRUTH, AND IT IS THE DERIVED ONE.
//
// The organizer's ruling, 18 Aug 2026: cash is a FLOW, not a snapshot. It moves
// every day, someone hands him money in the field, and a design that models it
// as a number typed on one screen and read on another models the opposite of
// how the equb runs.
//
// TWO NUMBERS, AND ONLY ONE OF THEM IS "WHAT I HOLD":
//
//   THE LIVE POSITION   `collected − handedOut`, derived at read time. It moves
//                       by itself the moment a payment is recorded or a payout
//                       marked. Every forward calculation anchors here.
//
//   A COUNTED READING   "I physically counted $X on this date." A declaration,
//                       an audit event, and stale as soon as the next payment
//                       lands. Its ONLY job is to be compared against the live
//                       position, so the gap between books and tin is visible.
//
// THE DEFECT THIS PINS. The end-of-cycle projection anchored to the READING. On
// the live cycle that reading was eight payments and $9,000 out of date, so the
// projection was wrong by that much with nothing on screen saying so — and it
// could not answer at all until he had typed one in. It now anchors to the live
// position, which is why there is no longer a "where do I update this": there
// is nothing to update, because recording the payment IS the update.

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments stripped — a guard a comment can satisfy reports on the prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const FILES = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib")), ...sourceFiles(join(ROOT, "components"))];
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

describe("the two numbers are different things", () => {
  it("scans a real set of files", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("the live position is one function, and it is a subtraction of two facts", () => {
    expect(livePosition({ collected: 1000, handedOut: 400 })).toBe(600);
    // Never negative-guarded: holding less than nothing IS possible on the
    // books and hiding it would be the lie.
    expect(livePosition({ collected: 100, handedOut: 400 })).toBe(-300);
  });

  it("both names for it agree, because one calls the other", () => {
    // `cashPosition().currentlyHeld` and `cashOnHand().shouldBeHolding` are
    // the same fact. They are allowed two names; they are not allowed two
    // derivations.
    const payments = [{ amountPaid: 700_000 }, { amountPaid: 300_000 }];
    const payouts = [
      { netAmount: 200_000, status: "COLLECTED" as const },
      { netAmount: 150_000, status: "PENDING" as const },
    ];
    const fromDashboard = cashPosition({ payments, payouts });
    const fromPosition = cashOnHand({
      collected: fromDashboard.totalReceived,
      handedOut: fromDashboard.totalPaidOut,
      drawnNotHandedOut: fromDashboard.committedPending,
      paidEarly: 0,
    });
    expect(fromPosition.shouldBeHolding).toBe(fromDashboard.currentlyHeld);
    expect(fromDashboard.currentlyHeld).toBe(800_000);
  });

  it("only ONE file writes the subtraction", () => {
    // If a second file ever computes received − paidOut itself, the most
    // looked-at figure in the platform can start disagreeing with itself.
    const writers = FILES.filter((f) => {
      const src = code(readFileSync(f, "utf8"));
      return /totalReceived\s*-\s*totalPaidOut|collected\s*-\s*(input\.)?handedOut/.test(src);
    }).map(rel);
    expect(writers, `these derive the live position themselves:\n  ${writers.join("\n  ")}`).toEqual([
      "lib/cycle-position.ts",
    ]);
  });
});

describe("nothing but the reconciliation consumes a counted reading", () => {
  // The reading may be READ freely for display — its date, its amount, its
  // history. What it may not be is an INPUT to a forward calculation.
  const ALLOWED = new Set([
    // The reconciliation itself: count vs books is the reading's whole job.
    "app/actions/cycle-position.ts",
    // The form and the history table — where a reading is made and listed.
    "app/admin/(protected)/cycle/position/cash-reading-panel.tsx",
    "app/admin/(protected)/cycle/position/page.tsx",
    // Shows the latest reading beside the projection, as an audit fact.
    "components/admin/end-of-cycle-panel.tsx",
    "app/admin/(protected)/cash/page.tsx",
    // How many readings fit on a page of the history list. It names the table,
    // never an amount, so it cannot carry a stale figure into a calculation.
    "lib/paging.ts",
  ]);

  it("no other file touches cashReading at all", () => {
    const touchers = FILES.filter((f) => /cashReading|latestReading/.test(code(readFileSync(f, "utf8"))))
      .map(rel)
      .filter((f) => !ALLOWED.has(f));
    expect(
      touchers,
      `these read the counted reading and are not the reconciliation:\n  ${touchers.join("\n  ")}`,
    ).toEqual([]);
  });

  it("THE REGRESSION: the projection never anchors to a reading", () => {
    // `inHand: latest?.totalAmount` is exactly what was wrong. If it comes
    // back, so does a projection that is stale by however long ago he counted.
    const action = code(readFileSync(join(ROOT, "app/actions/cycle-position.ts"), "utf8"));
    expect(action).not.toMatch(/inHand:\s*latest/);
    expect(action).toMatch(/inHand:\s*holding\.shouldBeHolding/);
  });

  it("the projection has no reading-shaped gate left", () => {
    // It used to refuse to answer without one.
    const page = code(readFileSync(join(ROOT, "app/admin/(protected)/cash/page.tsx"), "utf8"));
    expect(page).not.toMatch(/hasReading/);
  });

  it("the reading is still compared against the live position", () => {
    // Removing the projection's dependency must not remove the reconciliation
    // — that comparison is the reading's entire purpose.
    const action = code(readFileSync(join(ROOT, "app/actions/cycle-position.ts"), "utf8"));
    expect(action).toMatch(/actual:\s*latest\.totalAmount/);
    expect(action).toMatch(/differenceVsExpectedToday/);
  });
});

describe("wherever the reading is shown, its date and a way to act are shown too", () => {
  const panel = readFileSync(join(ROOT, "components/admin/end-of-cycle-panel.tsx"), "utf8");

  it("the panel shows when it was counted", () => {
    // A cash figure without its date invites him to trust a number that may be
    // a week old.
    expect(panel).toMatch(/readAt|countedOn/);
  });

  it("and links to the ONE form rather than growing a second", () => {
    expect(panel).toContain("/admin/cycle/position#cash-reading");
    // No second form: the panel must not import the reading action.
    expect(code(panel)).not.toContain("recordCashReading");
  });
});
