import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { closedCycleAllows, closeTiming, CLOSING_WAIT_DAYS_DEFAULT } from "./cycle-lock";
import { frozenCycleRefusal } from "./cycle-close";

const SEP_27 = new Date(Date.UTC(2026, 8, 27));
const LABEL = "Sunday, September 27, 2026";

describe("the wait period before closing is offered", () => {
  it("refuses on the day the last week happened", () => {
    const t = closeTiming({ finalWeekDate: SEP_27, today: SEP_27, finalWeekLabel: LABEL });
    expect(t.state).toBe("too-soon");
    expect(t.state === "too-soon" && t.daysRemaining).toBe(5);
  });

  it("counts down day by day", () => {
    for (const [daysAfter, remaining] of [
      [1, 4],
      [2, 3],
      [4, 1],
    ] as const) {
      const today = new Date(SEP_27.getTime() + daysAfter * 86_400_000);
      const t = closeTiming({ finalWeekDate: SEP_27, today, finalWeekLabel: LABEL });
      expect(t.state === "too-soon" && t.daysRemaining, `day ${daysAfter}`).toBe(remaining);
    }
  });

  it("is READY on the fifth day — the same window a payment gets", () => {
    // PAYMENT_WINDOW_DAYS is 5, so a week's money can legitimately arrive up
    // to day 5. Closing before that turns money in transit into a debt.
    const today = new Date(SEP_27.getTime() + 5 * 86_400_000);
    expect(closeTiming({ finalWeekDate: SEP_27, today, finalWeekLabel: LABEL }).state).toBe("ready");
    expect(CLOSING_WAIT_DAYS_DEFAULT).toBe(5);
  });

  it("stays ready long afterwards", () => {
    const today = new Date(SEP_27.getTime() + 90 * 86_400_000);
    expect(closeTiming({ finalWeekDate: SEP_27, today, finalWeekLabel: LABEL }).state).toBe("ready");
  });

  it("follows a CHANGED setting (2.6), not the constant", () => {
    const twoDaysLater = new Date(SEP_27.getTime() + 2 * 86_400_000);
    expect(
      closeTiming({ finalWeekDate: SEP_27, today: twoDaysLater, waitDays: 2, finalWeekLabel: LABEL })
        .state,
    ).toBe("ready");
    expect(
      closeTiming({ finalWeekDate: SEP_27, today: twoDaysLater, waitDays: 10, finalWeekLabel: LABEL })
        .state,
    ).toBe("too-soon");
  });

  it("a wait of ZERO offers closing immediately — the organizer may switch it off", () => {
    const t = closeTiming({ finalWeekDate: SEP_27, today: SEP_27, waitDays: 0, finalWeekLabel: LABEL });
    expect(t.state).toBe("ready");
  });

  it("falls back to the default on a nonsense setting rather than closing early", () => {
    for (const bad of [Number.NaN, -3, undefined]) {
      const t = closeTiming({
        finalWeekDate: SEP_27,
        today: SEP_27,
        waitDays: bad as number,
        finalWeekLabel: LABEL,
      });
      expect(t.state, String(bad)).toBe("too-soon");
    }
  });

  it("says WHEN closing becomes available, and why", () => {
    const t = closeTiming({
      finalWeekDate: SEP_27,
      today: SEP_27,
      finalWeekLabel: LABEL,
      cycleNameForReason: "Cycle 1 2026",
    });
    expect(t.state).toBe("too-soon");
    if (t.state !== "too-soon") return;
    expect(t.availableOn).toEqual(new Date(Date.UTC(2026, 9, 2)));
    expect(t.reason).toContain("Cycle 1 2026");
    expect(t.reason).toContain(LABEL);
    // The REASON, not just the rule — this is what stops it reading as a bug.
    expect(t.reason).toContain("late payments land on the week");
    expect(t.reason).toContain("5 days to go");
  });

  it("measures from the FINAL WEEK's own stored date, not the cycle start", () => {
    // 2.14 / 2.7: a cycle that ran long finishes when its last week actually
    // happened, so a later stored date pushes the wait later.
    const ranLong = new Date(Date.UTC(2026, 9, 11)); // two weeks later
    const today = new Date(Date.UTC(2026, 9, 3));
    expect(closeTiming({ finalWeekDate: SEP_27, today, finalWeekLabel: LABEL }).state).toBe("ready");
    expect(closeTiming({ finalWeekDate: ranLong, today, finalWeekLabel: LABEL }).state).toBe(
      "too-soon",
    );
  });
});

describe("what a CLOSED cycle allows", () => {
  it("reading and exporting the archive always work (2.9)", () => {
    expect(closedCycleAllows("read")).toBe(true);
    expect(closedCycleAllows("archive-export")).toBe(true);
  });

  it("deleting is still allowed — a closed cycle can be removed wholesale", () => {
    expect(closedCycleAllows("delete")).toBe(true);
  });

  it("writing never is", () => {
    expect(closedCycleAllows("write")).toBe(false);
  });

  it("frozenCycleRefusal explains itself and points somewhere useful", () => {
    const refusal = frozenCycleRefusal({ name: "Cycle 1 2026", status: "CLOSED" });
    expect(refusal).toContain("Cycle 1 2026");
    expect(refusal).toContain("carried ledgers");
    // It must tell the organizer where the money DOES go, not just refuse.
    expect(refusal).toContain("member's page");
    expect(frozenCycleRefusal({ name: "Cycle 1 2026", status: "ACTIVE" })).toBeNull();
    expect(frozenCycleRefusal({ name: "Cycle 1 2026", status: "DRAFT" })).toBeNull();
  });
});

// ————————————————————————————————————————————————————————————————
// THE GUARD.
//
// The read-only rule was applied by hand and had drifted badly: of 19
// mutations in app/actions/edits.ts only 9 carried frozenCycleRefusal,
// app/actions/participations.ts carried none, and app/actions/wheel.ts carried
// 3 of 10. A guard that must be REMEMBERED is a guard that will be forgotten.
//
// This scans the source for actions that mutate CYCLE-SCOPED data and fails
// when one ships without the check. Its limits, stated: it matches on the
// Prisma models written, so an action that mutates through a helper this list
// does not name would slip past. It is a tripwire for the likely omission.
// ————————————————————————————————————————————————————————————————

const ROOT = join(import.meta.dirname, "..");
const ACTIONS_DIR = join(ROOT, "app/actions");

/** Models whose rows belong to a cycle and are frozen once it closes. */
const CYCLE_SCOPED = [
  "payment",
  "paymentEvent",
  "paymentAllocation",
  "payout",
  "draw",
  "slot",
  "slotMember",
  "luckyNumber",
  "winnerPlan",
  "participation",
  "week",
];

/**
 * Actions that legitimately mutate cycle data WITHOUT the frozen check, each
 * with the reason it is exempt. Anything not on this list must carry it.
 */
const EXEMPT: Record<string, string> = {
  closeCycle: "it is the action that DOES the closing",
  deleteCycle: "2.9 — a closed cycle may be deleted wholesale",
  reopenCycle: "it is the action that lifts the freeze",
  createCycle: "a brand-new cycle cannot be closed",
  addToCycle: "guarded by loadOpenCycle, which refuses a non-open cycle",
  addNewPersonToCycle: "guarded by loadOpenCycle",
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Split a file into its exported server actions. */
function actionsIn(source: string): { name: string; body: string }[] {
  const parts = source.split(/export async function /).slice(1);
  return parts.map((p) => ({ name: p.slice(0, p.indexOf("(")).trim(), body: p }));
}

describe("GUARD — every cycle-mutating action refuses a CLOSED cycle", () => {
  const files = tsFiles(ACTIONS_DIR);

  it("scans a realistic number of action files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("the resolver accepted above really applies the refusal", () => {
    // Accepting `refuseIfCycleClosed` as equivalent to the pure check is only
    // safe while it actually calls it and THROWS. If cycle-guard.ts is ever
    // gutted, this test — not a production surprise — is what notices.
    const guard = readFileSync(join(ROOT, "lib/cycle-guard.ts"), "utf8");
    expect(guard).toContain("frozenCycleRefusal");
    expect(guard).toMatch(/throw new Error\(refusal\)/);
  });

  it("no action writes cycle data without checking frozenCycleRefusal", () => {
    const offenders: string[] = [];
    const writeCall = new RegExp(
      `tx\\.(?:${CYCLE_SCOPED.join("|")})\\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)`,
    );

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const action of actionsIn(source)) {
        if (EXEMPT[action.name]) continue;
        if (!writeCall.test(action.body)) continue;
        // Either the pure check by hand, or the one-line resolver that wraps
        // it (lib/cycle-guard.ts). The resolver exists because the by-hand
        // version needed three lines of plumbing per action — which is why 14
        // of them skipped it.
        if (
          action.body.includes("frozenCycleRefusal") ||
          action.body.includes("refuseIfCycleClosed")
        ) {
          continue;
        }
        offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")} :: ${action.name}`);
      }
    }

    expect(
      offenders,
      "These actions mutate cycle-scoped data but never call frozenCycleRefusal. " +
        "A CLOSED cycle's books are final (2.9/2.14) — add the check, or add the " +
        "action to EXEMPT above with the reason it is safe.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
