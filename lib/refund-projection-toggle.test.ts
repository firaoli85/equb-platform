import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// GUARD — THE TOGGLE MOVES ONE FIGURE IN ONE SUM, AND NOTHING ELSE.
//
// A switch on a money screen that could quietly remove an obligation from view
// would be worse than the confusion it exists to fix. What the organizer owes
// a stopped member stays on the cash screen, on their own page and in their
// portal whichever way this is set; the flag decides whether the figure enters
// the end-of-cycle projection, and that is all it decides.
//
// AND ONLY ONE DIRECTION IS A CHOICE. A member who took the pot and stopped
// owes HIM. That hole has to be covered whatever he would prefer, so no
// question is asked and no toggle is offered — offering one would imply a
// choice that does not exist.

const ROOT = join(import.meta.dirname, "..");

/** Comments stripped — a guard a comment can satisfy reports on the prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const POSITION_ACTION = code(readFileSync(join(ROOT, "app/actions/cycle-position.ts"), "utf8"));
const CLOSE_ACTION = code(readFileSync(join(ROOT, "app/actions/participation-close.ts"), "utf8"));
const CLOSE_UI = code(readFileSync(join(ROOT, "components/admin/close-participation.tsx"), "utf8"));
const PANEL = code(readFileSync(join(ROOT, "components/admin/end-of-cycle-panel.tsx"), "utf8"));
const TOGGLE = code(readFileSync(join(ROOT, "components/admin/refund-in-projection-toggle.tsx"), "utf8"));
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");

describe("the stored choice", () => {
  it("is one boolean on the participation, defaulting to counted", () => {
    // Counting it is the honest starting position: a debt he has belongs in
    // his own forecast unless he says otherwise. It also means every member
    // already on the books starts counted, with no backfill.
    expect(SCHEMA).toMatch(/refundCountedInProjection\s+Boolean\s+@default\(true\)/);
  });

  it("the migration is additive and defaults the same way", () => {
    const sql = readFileSync(
      join(ROOT, "prisma/migrations/20260818010000_refund_counted_in_projection/migration.sql"),
      "utf8",
    );
    expect(sql).toMatch(/ADD COLUMN "refundCountedInProjection" BOOLEAN NOT NULL DEFAULT true/);
    // Nothing destructive in a migration that exists to add one flag.
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
  });
});

describe("only the you-owe-them direction is a choice", () => {
  it("the toggle action refuses a member who was already paid out", () => {
    expect(POSITION_ACTION).toMatch(/paidOut > 0/);
    expect(POSITION_ACTION).toContain("not back to them");
  });

  it("the toggle action refuses a member who is still in the cycle", () => {
    expect(POSITION_ACTION).toMatch(/status !== "CLOSED"/);
  });

  it("it decides the direction from the receipts, never from the caller", () => {
    // The input carries only which participation and which way — never how
    // much, and never which direction.
    expect(POSITION_ACTION).toMatch(/participationId: string;\s*\n\s*counted: boolean;\s*\n\}/);
    expect(POSITION_ACTION).toContain("recoverableForUndrawn");
  });

  it("the close screen asks ONLY when he will owe them", () => {
    // refundOwed is 0 whenever they were drawn, and the whole fieldset hangs
    // off it being positive.
    expect(CLOSE_ACTION).toMatch(/plan\.alreadyPaidOut > 0\s*\n?\s*\?\s*0/);
    expect(CLOSE_UI).toMatch(/refundOwed > 0 &&/);
  });

  it("closing a member who owes HIM never writes the flag", () => {
    // owesThem gates the write; without it, a drawn member's close would
    // stamp a choice that has no meaning for them.
    expect(CLOSE_ACTION).toMatch(/const owesThem = plan\.alreadyPaidOut === 0;/);
    expect(CLOSE_ACTION).toMatch(/owesThem && input\.countRefundInProjection !== undefined/);
  });
});

describe("the debt is never hidden", () => {
  it("the panel states what is owed in full, counted or not", () => {
    expect(PANEL).toContain("refundsOwedInFull");
    expect(PANEL).toContain("refundsHandledByHand");
  });

  it("every member he owes is listed by name, whichever way the toggle is set", () => {
    // The list renders from `p.refunds`, which is every one of them — not
    // from the counted subset.
    expect(PANEL).toMatch(/p\.refunds\.map/);
    expect(PANEL).not.toMatch(/refunds\.filter\([^)]*counted/);
  });

  it("the toggle itself says what it does not do", () => {
    expect(TOGGLE).toContain("Still owed to");
    expect(TOGGLE).toContain("still on their record");
  });

  it("the choice is reversible from the cash screen", () => {
    // He may decide differently later, per member.
    expect(TOGGLE).toContain("setRefundCountedInProjection");
    expect(PANEL).toContain("RefundInProjectionToggle");
  });
});

describe("the fee is never a term in the projection", () => {
  it("the action reads the payout rule rather than doing fee arithmetic", () => {
    expect(POSITION_ACTION).toContain("calculatePayout");
    // The two figures come off the SAME derivation, so they cannot drift.
    expect(POSITION_ACTION).toMatch(/payoutsStillToGoOut \+= due\.net/);
    expect(POSITION_ACTION).toMatch(/feeStillToEarn \+= due\.fee/);
  });

  it("nothing adds the fee back into either total", () => {
    // The one mistake this whole panel exists to stop: the pot counted at
    // full size and the fee added again as income.
    expect(POSITION_ACTION).not.toMatch(/comingIn[^\n]*fee/i);
    expect(PANEL).not.toMatch(/[+\-]\s*(p\.)?feeStillToEarn/);
  });

  it("the panel states the fee without using it", () => {
    expect(PANEL).toContain("feeStillToEarn");
    expect(PANEL).toContain("not added anywhere else");
  });
});

describe("the by-week shorts are totalled honestly", () => {
  const PAGE = code(readFileSync(join(ROOT, "app/admin/(protected)/cash/page.tsx"), "utf8"));

  it("elapsed and future gaps are totalled apart", () => {
    // A gap on a week that has not happened is nobody being late. One
    // combined figure under "short" would say members owe thousands more
    // than they do.
    expect(PAGE).toMatch(/overdueTotal[^\n]*filter\(\(w\) => w\.elapsed\)/);
    expect(PAGE).toMatch(/notDueTotal[^\n]*filter\(\(w\) => !w\.elapsed\)/);
  });

  it("both totals use the SAME expression the rows render", () => {
    // A total computed a second way is a total that can disagree with its
    // own column.
    expect(PAGE).toMatch(/const gapOf = \(w[^)]*\) => Math\.max\(0, w\.expected - w\.received\)/);
  });

  it("the not-due figure is never called overdue", () => {
    expect(PAGE).toContain("Not due yet");
    expect(PAGE).toContain("nobody is late for those");
  });
});
