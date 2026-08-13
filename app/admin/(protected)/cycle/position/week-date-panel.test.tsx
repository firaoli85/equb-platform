import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WeekDateEditor, WeekDatePanel } from "./week-date-panel";
import type { WeekDateRow } from "./week-dates";

// `useRouter` throws outside an app-router context, which renderToStaticMarkup
// has no way to provide. The refresh it gives is load-bearing rather than
// decorative — rule 6 beat 3: the screen must show the new truth after a save,
// and here that is the corrected date in the row above the editor — so the
// component keeps it and the test supplies what the app supplies.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// THE DATES REACH THE SCREEN, AND ONE OF THEM CAN BE CHANGED THERE.
//
// `week-dates.test.ts` pins the arithmetic and the wiring. This pins that both
// arrive in the markup — which is the actual gap ADMIN_IA §3 describes: the
// page reported "the position they produce" and never printed the stored dates
// it produced them from. Every assertion here would have failed on the page as
// it stood, because the panel did not exist and `formatDateUTC` was imported by
// `page.tsx` and never called.
//
// There is no jsdom and no testing-library here, so nothing can be clicked.
// `WeekDateEditor` is exported for exactly that reason: a control that only
// appears after a click is a control no test in this repo can see.

const row = (weekNumber: number, date: string, over: Partial<WeekDateRow> = {}): WeekDateRow => ({
  id: `w${weekNumber}`,
  weekNumber,
  date,
  notes: null,
  membersExpected: 27,
  membersShort: 0,
  // Defaults to whatever `membersShort` is unless a test says otherwise: the
  // two coincide only when nobody is marked late and nobody is deferred, which
  // is the ordinary case and the right default for a fixture.
  membersAffectedByDate: 0,
  ...over,
});

// The live cycle's shape: 20 weeks from Sunday 17 May 2026.
const cycle = Array.from({ length: 20 }, (_, i) =>
  row(i + 1, new Date(Date.UTC(2026, 4, 17) + i * 7 * 86_400_000).toISOString().slice(0, 10)),
);

const panel = (over: Partial<Parameters<typeof WeekDatePanel>[0]> = {}) =>
  renderToStaticMarkup(<WeekDatePanel weeks={cycle} todayIso="2026-08-12" {...over} />);

const editor = (over: Partial<Parameters<typeof WeekDateEditor>[0]> = {}) =>
  renderToStaticMarkup(
    <WeekDateEditor
      row={cycle[11]}
      weeks={cycle}
      todayIso="2026-08-12"
      // The draft opens on the stored date, exactly as the panel opens it.
      date={cycle[11].date}
      notes=""
      onDate={() => {}}
      onNotes={() => {}}
      onClose={() => {}}
      {...over}
    />,
  );

describe("the stored dates are ON THE SCREEN (ADMIN_IA §3, rule 7)", () => {
  it("prints every week's own stored date", () => {
    const out = panel();
    // First, middle and last — the whole ladder, not a sample the eye picks.
    expect(out).toContain("May 17, 2026"); // week 1
    expect(out).toContain("Aug 2, 2026"); // week 12
    expect(out).toContain("Sep 27, 2026"); // week 20
  });

  it("draws one row per week, labelled by week number", () => {
    const out = panel();
    for (const n of [1, 12, 20]) expect(out).toContain(`data-week="${n}"`);
    expect(out).not.toContain('data-week="21"');
    expect(out).toContain("Week 12");
  });

  it("says when each week's payment window shuts — the boundary that decides late", () => {
    // Week 12 is Aug 2; its window shuts five days later (rule 7).
    expect(panel()).toContain("Aug 7, 2026");
  });

  it("marks a week whose window is still open, so nobody reads it as overdue", () => {
    // Today is Aug 12. Week 13 is Aug 9 — arrived, window open until Aug 14.
    const out = panel();
    expect(out).toContain("window open");
    expect(out).toContain("window closed");
    expect(out).toContain("not yet");
  });

  it("shows how many members are short for each week, out of how many owe it", () => {
    const out = panel({ weeks: cycle.map((w) => (w.weekNumber === 12 ? row(12, w.date, { membersShort: 3 }) : w)) });
    expect(out).toContain("of 27");
    expect(out).toContain(">3<");
  });

  it("says that short is not the same as overdue (UI_STANDARDS rule 8)", () => {
    expect(panel()).toContain("only becomes <strong>overdue</strong> once");
  });

  it("names who is left OUT of both figures, because it is not everyone in window", () => {
    // THE FOOTNOTE WAS WRONG ABOUT THE COLUMN IT EXPLAINS. It read "'Members
    // short' is money not yet in for that week, out of everyone whose own
    // window covers it" — but `lib/dashboard.ts` `weekReceipts` runs
    // `if (payment?.isDeferred) continue;` BEFORE `membersExpected++`, so a
    // deferred member is in neither the 3 nor the 27. It could not have passed
    // before: the word "deferred" appeared nowhere in this panel, and the
    // sentence claimed the opposite of the code.
    const out = panel();
    expect(out).toContain("except anyone whose week you have deferred");
    expect(out).toContain("counted in neither");
  });

  it("calls the column a count of people, not an amount of money", () => {
    // It said "is money not yet in", beside a cell that renders `3 of 27`.
    const out = panel();
    expect(out).toContain("counts the members who have not paid their full weekly amount");
    expect(out).not.toContain("is money not yet in");
  });

  it("invites rather than showing a bare empty table (UI_STANDARDS rule 4)", () => {
    const out = panel({ weeks: [] });
    expect(out).toContain("no week rows yet");
    expect(out).not.toContain("data-week=");
  });
});

describe("NO SKIP CONTROL, anywhere on this screen", () => {
  // docs/CYCLE_POSITION_SPEC.md PART 2 removed the concept from the UI on
  // purpose — "there are no skipped weeks in an Equb, every week is a
  // commitment" — and docs/MANUAL_QA_CHECKLIST.md makes "no control anywhere
  // on this screen offers to skip a week" a PASS condition.
  //
  // Asserted on RENDERED OUTPUT rather than on the source, so a comment
  // explaining why there is no skip control cannot trip it (§5.3: a guard that
  // flags its own documentation gets switched off by whoever meets it next).
  it("renders no skip control in the table", () => {
    expect(panel()).not.toMatch(/skip/i);
  });

  it("renders no skip control in the editor", () => {
    expect(editor()).not.toMatch(/skip/i);
  });
});

describe("the correction control exists, at the week it corrects (2.23)", () => {
  it("offers to correct each week by name", () => {
    const out = panel();
    expect(out).toContain("Correct week 12…");
    expect(out).toContain("Correct week 1…");
  });

  it("opens a date field bounded by the week's own neighbours", () => {
    const out = editor();
    // The bound sentence names both neighbouring weeks and both dates, so a
    // greyed-out day is never unexplained (rule 11).
    expect(out).toContain(
      "Weeks run in order, so this one must fall after week 11 (2026-07-26) and before week 13 (2026-08-09).",
    );
    expect(out).toContain('aria-label="Week 12&#x27;s date"');
  });

  it("offers the note alongside it — the other editable fact on a week row", () => {
    expect(editor()).toContain('aria-label="Week 12&#x27;s note"');
  });

  it("carries the save through SaveButton, disabled until something changes", () => {
    const out = editor();
    expect(out).toContain("Save week 12");
    // Beat 1 of rule 6: a Save that is live on an unchanged form invites a
    // pointless write.
    expect(out).toContain('disabled=""');
    expect(out).toContain("The date and the note are unchanged.");
  });

  it("opens on the STORED date, never blank", () => {
    // A blank bounded date field makes the organizer guess, and invites him to
    // guess wrong (lib/date-bounds.ts, defaultWithinBounds).
    expect(editor()).toContain('value="08/02/2026"');
  });
});

describe("the consequence is stated BEFORE the save, not after it", () => {
  // The whole reason a week date is dangerous: it is the fact that decides who
  // is late, and moving it is silent everywhere else in the platform. The
  // sentence is rendered AT the control as well as in the confirmation, so he
  // can see what a date does before committing to a dialog about it.
  const short3 = cycle.map((w) => (w.weekNumber === 12 ? row(12, w.date, { membersShort: 3 }) : w));

  it("says nothing while the date is untouched — there is no consequence yet", () => {
    expect(editor()).not.toContain('data-testid="week-date-consequence"');
  });

  it("names the members who stop being overdue when a closed week reopens", () => {
    // Today is Aug 12; week 12 is Aug 2, so its window shut on Aug 7 and three
    // members are overdue for it. Moving it to Aug 9 reopens the window.
    const out = editor({ row: short3[11], weeks: short3, date: "2026-08-09" });
    expect(out).toContain('data-testid="week-date-consequence"');
    expect(out).toContain("3 members count as overdue for week 12 today");
    expect(out).toContain("Friday, August 14, 2026");
  });

  it("names the members who become overdue when a week is moved back", () => {
    // Week 13 (Aug 9) is still open today. Moved to Aug 2 it is already shut.
    const week13 = cycle.map((w) => (w.weekNumber === 13 ? row(13, w.date, { membersShort: 2 }) : w));
    const out = editor({ row: week13[12], weeks: week13, date: "2026-08-03" });
    expect(out).toContain("2 members count as overdue for week 13 the moment you save");
  });

  it("does not invent a standing change for a move that changes nobody", () => {
    // Week 6 is long shut and stays shut when slid by a day. Four members are
    // short for it before and after, so the sentence must say the money did
    // not move rather than implying four people just became overdue.
    const week6 = cycle.map((w) => (w.weekNumber === 6 ? row(6, w.date, { membersShort: 4 }) : w));
    const out = editor({ row: week6[5], weeks: week6, date: "2026-06-22" });
    expect(out).toContain("nobody&#x27;s overdue standing changes today");
    expect(out).toContain("4 members are short for it either way");
  });
});

describe("the confirmation carries what MOVES, not a promise it cannot keep", () => {
  // THE DIALOG ONLY EXISTS AFTER A CLICK, and there is no jsdom here, so this
  // is the mechanical property asserted on the source instead — the same shape
  // as the `updateWeek` wiring guard in `week-dates.test.ts`.
  //
  // What it protects: the confirmation body used to print `change.reassurance`,
  // "No money moves. Every payment stays on week N — only the day the week
  // happened changes." That is true of the receipt rows and false of the
  // late/behind/overdue figures the very same date decides (rule 7). Both
  // assertions fail on the panel as it stood — the first because `whatMoves`
  // did not exist, the second because `change.reassurance` was right there.
  const source = readFileSync(
    join("app", "admin", "(protected)", "cycle", "position", "week-date-panel.tsx"),
    "utf8",
  );

  it("finds the panel (guards against a silently empty read)", () => {
    expect(source).toContain("export function WeekDatePanel");
    expect(source).toContain("ConfirmDialog");
  });

  it("renders the sentence that states both halves", () => {
    expect(source).toContain("{change.whatMoves}");
  });

  // VACUOUS AS FIRST WRITTEN, and worth recording. It asserted
  // `not.toContain("No money moves")` against THIS file — and that string
  // never lived here, it lived in week-dates.ts. The assertion passed on the
  // unfixed panel for the same reason it passes on the fixed one: it was
  // looking in the wrong file. `week-dates.test.ts` owns the string; this file
  // owns the WIRING, so that is what it checks now.
  it("renders the consequence the builder produces, not a hand-written one", () => {
    expect(source).toContain("{change.whatMoves}");
    // The old field is gone from the type, so a stale reader would not compile
    // — but the rename is the point, and a reader reintroducing a soothing
    // constant here would not.
    expect(source).not.toContain("change.reassurance");
    // Nothing in the panel may hand-write a consequence beside it: two
    // sentences about one change is how they come to disagree.
    expect(source).not.toMatch(/No (?:money|receipt) moves/);
  });
});

describe("a week dated out of sequence is named at the row", () => {
  // Audit finding 29 let the server accept one, so live rows may carry it. A
  // count on the nav tab says something is wrong; this says WHICH week.
  it("flags the offending week and no other", () => {
    const broken = cycle.map((w) => (w.weekNumber === 18 ? row(18, "2026-05-24") : w));
    const out = panel({ weeks: broken });
    expect(out).toContain("out of order");
    expect(out.match(/out of order/g)).toHaveLength(1);
  });

  it("says nothing at all when the cycle runs in order", () => {
    expect(panel()).not.toContain("out of order");
  });
});
