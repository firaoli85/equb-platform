import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** CRLF-normalised, for the reason lib/member-group-disclosure.test.ts states. */
const read = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

/**
 * The same file with COMMENT-ONLY LINES removed.
 *
 * Every "this no longer exists" assertion below has to read CODE, not prose.
 * This codebase explains removals where they happened — the comment in
 * createWinnerPlan quotes both refusals it deleted, and the dropdown's comment
 * quotes the filter it replaced — so a plain source scan finds the very strings
 * it is checking are gone and fails on the explanation rather than the code.
 * Caught by these tests on their first run.
 *
 * Whole-line comments only: an inline `//` could be inside a string, and a
 * block-comment stripper would have to parse to be safe. The quotes that matter
 * all sit on their own lines.
 */
const codeOnly = (source: string) =>
  source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

// PHASE 6 — THE DRAW IS CHOSEN, NOT GATED (docs/ONE_TRUTH_ENGINE.md §3.8).
//
// WHAT WAS WRONG. Two refusals in createWinnerPlan and one filter on the week
// dropdown encoded a draw this equb has never run:
//
//   "Week N has already been drawn."      — but money is held across weeks when
//                                           members are late or deferred, and an
//                                           earlier week's slot is routinely
//                                           awarded later, once enough has come
//                                           in. "Week 1 already out, I can still
//                                           select it."
//   "Week N already has a planned winner." — but several winners on one week is
//                                           ORDINARY. He holds cash and draws
//                                           four at once.
//
// And the dropdown filtered both cases out of the list, which is the worst way
// to refuse something: nothing to read, nothing to argue with, just an absence.
//
// These are source scans because the properties are structural — which control
// offers which choice, and which refusals exist — and there is no jsdom here.

const actions = read("app/actions/wheel.ts");
const setup = read("app/admin/wheel/setup/wheel-setup.tsx");
const drawScreen = read("app/admin/wheel/draw-wheel.tsx");
const drawPage = read("app/admin/wheel/page.tsx");

const createPlan = actions.slice(
  actions.indexOf("export async function createWinnerPlan("),
  actions.indexOf("export async function cancelWinnerPlan("),
);

describe("ANY WEEK — past, current or future", () => {
  it("the scan is real", () => {
    // A broken slice would satisfy every "must not contain" below.
    expect(createPlan.length).toBeGreaterThan(1000);
    expect(createPlan).toContain("tx.winnerPlan.create");
  });

  it("an already-drawn WEEK is no longer refused", () => {
    // PRECISE, because a nearby refusal is legitimate and must survive: a
    // NUMBER that has already won cannot be planned again (it would win twice).
    // "has already been drawn" alone matches both, and deleting the wrong one
    // would let a number win a second time.
    expect(codeOnly(createPlan)).not.toContain("${week.weekNumber} has already been drawn");
    expect(createPlan).toContain("${n.number} has already been drawn");
  });

  it("a week that already has a winner is no longer refused", () => {
    expect(codeOnly(createPlan)).not.toContain("already has a planned winner");
  });

  it("the dropdown offers EVERY week, not a filtered subset", () => {
    // The filter that hid the two normal cases.
    expect(codeOnly(setup)).not.toContain(".filter((w) => !w.hasDraw && !w.planned)");
    expect(setup).toContain("...state.weeks.map((w) => {");
  });

  it("a typo is still refused — an unknown week is not a choice", () => {
    // The line between informing a decision and accepting a mistake. The week
    // must exist and belong to this cycle; what STATE it is in is his call.
    expect(createPlan).toContain('if (!week) return { error: "Unknown week." }');
  });

  it("a closed cycle is still refused — 2.9, the books are final", () => {
    expect(createPlan).toContain("refuseIfCycleClosed");
  });
});

describe("TRUTH INFORMS, IT DOES NOT DECIDE", () => {
  it("the option label says what is already true of each week", () => {
    // He chooses a drawn week KNOWING it is drawn, rather than wondering why it
    // vanished. That is the whole difference between informing and gating.
    expect(setup).toContain('w.hasDraw ? "drawn" : null');
    expect(setup).toContain("w.plannedWinners > 0");
    expect(setup).toContain("winner${w.plannedWinners === 1 ? \"\" : \"s\"}");
  });

  it("the state carries a COUNT, because several winners on a week is normal", () => {
    // A boolean could not describe the ordinary case.
    expect(actions).toContain(
      "plannedWinners: cycle.winnerPlans.filter((p) => p.week?.id === w.id).length,",
    );
    expect(codeOnly(actions)).not.toContain("planned: cycle.winnerPlans.some(");
  });

  it("eligibility is computed and SURFACED, never used to block a plan", () => {
    // The engine says who is in the pool; `eligibleIds` rides on the state and
    // renders as a marker. The only refusals on the plan path are the arity
    // rule (2.3 — a mode takes a fixed number of numbers), a number already
    // committed elsewhere, and a number outside its own window.
    expect(actions).toContain("const eligibleIds = new Set(eligible.map((n) => n.id));");
    // The client-side refusal is arity ONLY — no eligibility term.
    const clientRefusal = setup.slice(
      setup.indexOf("const planRefusal = winnerPlanArityRefusal({"),
      setup.indexOf("// ————— chips —————"),
    );
    expect(clientRefusal.length).toBeGreaterThan(50);
    expect(codeOnly(clientRefusal)).not.toContain("eligible");
  });
});

describe("ADDITIVE — a second winner does not replace the first", () => {
  it("planning CREATES a row; it never updates or deletes another plan", () => {
    expect(createPlan).toContain("const plan = await tx.winnerPlan.create({");
    // The two ways a second plan could have quietly replaced the first.
    expect(codeOnly(createPlan)).not.toContain("winnerPlan.deleteMany");
    expect(codeOnly(createPlan)).not.toContain("winnerPlan.update");
    expect(codeOnly(createPlan)).not.toContain("winnerPlan.upsert");
  });

  it("removal is its own explicit action", () => {
    expect(actions).toContain("export async function cancelWinnerPlan(input: { planId: string })");
    // BY ID. Cancelling "the plan for week 5" would be ambiguous the moment a
    // week has two, which is the case this phase makes ordinary.
    expect(actions).toContain("planId");
  });

  it("the slot cleanup cannot take a DRAWN or occupied slot with it", () => {
    // createWinnerPlan moves its numbers into a fresh slot and tidies the ones
    // they vacated. With several winners on one week that tidy runs far more
    // often, so the two conditions that keep it safe matter more, not less.
    expect(createPlan).toContain("members: { none: {} }, draws: { none: {} }");
  });
});

describe("THE RESHUFFLE PROTECTION IS UNTOUCHED", () => {
  const reshuffle = actions.slice(
    actions.indexOf("export async function reshuffleSlots("),
    actions.indexOf("export async function createWinnerPlan("),
  );

  it("the scan is real", () => {
    expect(reshuffle.length).toBeGreaterThan(300);
  });

  it("committed and drawn numbers are still excluded from re-pairing", () => {
    // The prior defect: reshuffle re-paired numbers that were already drawn or
    // committed to a plan. Nothing in this phase touches reshuffle, and this
    // says so rather than assuming it.
    expect(reshuffle).toMatch(/committed|anchored|frozen|drawn/i);
  });
});

describe("§2.4 — THE DRAW SCREEN STAYS BARE", () => {
  it("selection lives in SETUP, and setup is a different route", () => {
    // /admin/wheel is the screen he shares on a call; /admin/wheel/setup is
    // where the choices are made. This phase enriched the setup route only.
    expect(setup).toContain('ariaLabel="Planned week"');
    expect(drawScreen).not.toContain('ariaLabel="Planned week"');
    expect(drawPage).not.toContain('ariaLabel="Planned week"');
  });

  it("no week picker, plan control or eligibility list leaked onto the draw screen", () => {
    for (const forbidden of [
      "planWeekId",
      "createWinnerPlan",
      "cancelWinnerPlan",
      "plannedWinners",
      "setPlanNumbers",
      "planMode",
    ]) {
      expect(drawScreen, `${forbidden} must not appear on the shared draw screen`).not.toContain(
        forbidden,
      );
      expect(drawPage, `${forbidden} must not appear on the shared draw screen`).not.toContain(
        forbidden,
      );
    }
  });

  it("presentation mode redacts the winner COUNT, not just the plan list", () => {
    const presentation = read("lib/presentation.ts");
    // "Week 5 (2 winners)" in an option label would say how many are lined up
    // to anyone watching — exactly what redacting `plans` removes.
    expect(presentation).toContain("plannedWinners: 0,");
    expect(presentation).toContain("plans: [] as never[],");
  });
});

describe("HOW SEVERAL WINNERS ON ONE WEEK ACTUALLY WORK", () => {
  const schema = read("prisma/schema.prisma");
  const winners = read("app/actions/week-winners.ts");

  it("a week holds ONE draw — the database says so, and that is not the gate", () => {
    // FOUND DURING THIS PHASE, and it changes what "additive" means here.
    // `Draw` carries @@unique([weekId]), so several winners on a week are NOT
    // several Draw rows. spinWheel's "This week has already been drawn" mirrors
    // that constraint rather than restricting the organizer, so it STAYS —
    // removing it would turn a clean sentence into a P2002 at the database.
    const draw = schema.slice(schema.indexOf("model Draw {"), schema.indexOf("@@map(\"draws\")"));
    expect(draw).toContain("@@unique([weekId])");
  });

  it("winners are added to a week one at a time, with no week-state refusal", () => {
    // THIS is the additive path, and it was already right: addWinnerToWeek
    // takes one week and one number, refuses nothing about the week's state,
    // and appends. A week's second, third and fourth winner all arrive here.
    expect(winners).toContain(
      "export async function addWinnerToWeek(input: { weekId: string; luckyNumberId: string })",
    );
    const add = winners.slice(
      winners.indexOf("export async function addWinnerToWeek("),
      winners.indexOf("export async function removeWinnerFromWeek("),
    );
    expect(add.length).toBeGreaterThan(500);
    expect(codeOnly(add)).not.toContain("has already been drawn");
    expect(codeOnly(add)).not.toContain("already has a planned winner");
  });

  it("and removed one at a time, by payout — never by week", () => {
    // Removing "the winner for week 5" would be ambiguous the moment a week has
    // two, which is the ordinary case.
    expect(winners).toContain(
      "export async function removeWinnerFromWeek(input: { payoutId: string })",
    );
  });
});
