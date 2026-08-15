import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { computeStanding } from "./standing";

/**
 * Read a source file with line endings NORMALISED.
 *
 * THIS REPO CHECKS OUT CRLF AND STORES LF. A multi-line anchor written with a
 * bare newline silently fails to match a CRLF working copy: indexOf returns -1,
 * a slice from -1 comes back nearly empty, and every "must not contain"
 * assertion then passes while proving nothing — or every "must contain" fails
 * for a reason the message never mentions. It cost a run here before this
 * helper existed, which is why the source scans below all go through it.
 */
const read = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

// PHASE 5 — THE LAST SURFACE JOINS THE ENGINE.
//
// /me/group read a Postgres view, `member_progress`, which re-implemented the
// behind-count in SQL. It had drifted: its own comment recorded the pre-D-42
// law — "ONLY a cycle-wide skip is excused. A personal deferral is still owed"
// — so a deferred member read "2 weeks behind" there and "up to date" on /me.
// Two answers to one question, ten seconds apart, both from this platform.
//
// The view is dropped. This file holds the two things that must survive it:
// the ARITHMETIC now agreeing, and the 2.8 DISCLOSURE guarantee that used to be
// enforced by the database and is now enforced by a projection.

const WEEKLY = 200_000;
const START_WEEK = 1;
const WEEKS_COMMITTED = 20;
const weekDate = (n: number) => new Date(Date.UTC(2026, 4, 3 + (n - 1) * 7));
// FIFTEEN WEEKS HAVE CLOSED by this date, and the count matters: week n falls
// on 3 May + 7(n-1), its window shuts five days later, and 7(n-1)+5 <= 104 holds
// up to n = 15. The fixtures below pay fourteen of them so the FIFTEENTH is the
// only week in question — the deferred or part-paid one the two disagree about.
const TODAY = new Date(Date.UTC(2026, 7, 15));
const ELAPSED = 15;
const PAID_THROUGH = 14;

type WeekOverride = { paid?: number; deferred?: boolean; skipped?: boolean };

function standingFor(overrides: Record<number, WeekOverride>, weeks: number) {
  const windowWeeks = Array.from({ length: WEEKS_COMMITTED }, (_, i) => {
    const n = i + 1;
    const o = overrides[n] ?? {};
    return {
      weekNumber: n,
      date: weekDate(n),
      amountDue: WEEKLY,
      // Weeks past `weeks` are future and unpaid; up to it, paid unless said.
      storedPaid: o.paid !== undefined ? o.paid : n <= weeks ? WEEKLY : 0,
      isDeferred: o.deferred ?? false,
      markedLate: false,
      isSkipped: o.skipped ?? false,
    };
  });
  return computeStanding({
    weeklyAmount: WEEKLY,
    startWeek: START_WEEK,
    weeksCommitted: WEEKS_COMMITTED,
    cycleWeek: 15,
    today: TODAY,
    windowWeeks,
    totalPaid: windowWeeks.reduce((s, w) => s + w.storedPaid, 0),
  });
}

/**
 * The view's `weeks_behind`, in TypeScript, exactly as the SQL computed it:
 *
 *   greatest(0, closed.elapsed - closed.excused - floor(total / weekly))
 *
 * where `excused` counted ONLY `w."isSkipped"`. Reproduced so the disagreement
 * is a measured difference rather than a claim about deleted SQL.
 */
function viewWeeksBehind(overrides: Record<number, WeekOverride>, weeks: number): number {
  let elapsed = 0;
  let excused = 0;
  let total = 0;
  for (let n = 1; n <= WEEKS_COMMITTED; n += 1) {
    const o = overrides[n] ?? {};
    const paid = o.paid !== undefined ? o.paid : n <= weeks ? WEEKLY : 0;
    total += paid;
    // current_date >= week date + 5
    if (TODAY.getTime() >= weekDate(n).getTime() + 5 * 86_400_000) {
      elapsed += 1;
      if (o.skipped) excused += 1;
    }
  }
  return Math.max(0, elapsed - excused - Math.floor(total / WEEKLY));
}

describe("THE DISAGREEMENT THE VIEW CARRIED — measured, then closed", () => {
  it("a DEFERRED member: the view said behind, the engine says paused", () => {
    // Fourteen weeks paid. Week 15 closed unpaid and DEFERRED by the organizer.
    // It is the LAST elapsed week deliberately: coverage runs oldest first, so
    // a deferred week earlier in the window would simply be paid by the money
    // already in, and the disagreement would never surface.
    const overrides = { [ELAPSED]: { paid: 0, deferred: true } };

    // THE VIEW: excused only cycle-wide skips, so a personal deferral counted
    // as behind. 15 elapsed − 0 excused − 14 paid = 1.
    expect(viewWeeksBehind(overrides, PAID_THROUGH)).toBe(1);

    // THE ENGINE (D-42, §2.29a): a deferred week leaves the CURRENT
    // expectation. Not forgiven — it resolves at close — but not behind today.
    const engine = standingFor(overrides, PAID_THROUGH);
    expect(engine.weeksBehind).toBe(0);
    // And the money is held where "paused" cannot be read as "paid".
    expect(engine.amountDeferred).toBe(WEEKLY);
    expect(engine.amountOutstanding).toBe(0);
  });

  it("a PART-PAID closed week: the two never agreed on it either", () => {
    // Week 15 closed with $800 of its $2,000 on it.
    const overrides = { [ELAPSED]: { paid: 80_000 } };
    const engine = standingFor(overrides, PAID_THROUGH);

    // THE INTEGERS HAPPEN TO MATCH HERE, and that is the point worth making:
    // the view floors total/weekly, so 14.4 weeks of money reads as 14 and both
    // say "1 behind". Agreement by luck, not by construction.
    expect(viewWeeksBehind(overrides, PAID_THROUGH)).toBe(1);
    expect(engine.weeksBehind).toBe(1);

    // WHAT THE VIEW COULD NEVER SAY is the figure the member is actually
    // chased for. "1 week behind" is true of someone who paid nothing and of
    // someone who paid $800, and only one of them owes $1,200.
    expect(engine.amountOutstanding).toBe(WEEKLY - 80_000);
  });

  it("weeks_paid is unchanged — the one figure that always agreed", () => {
    // The view: least(floor(total / weekly), weeksCommitted).
    // The engine: min(weeksCredited, weeksCommitted). Same number.
    for (const paidWeeks of [0, 1, 7, 12, 20]) {
      const engine = standingFor({}, paidWeeks);
      const viewWeeksPaid = Math.min(
        Math.floor((paidWeeks * WEEKLY) / WEEKLY),
        WEEKS_COMMITTED,
      );
      expect(Math.min(engine.weeksCredited, WEEKS_COMMITTED), `${paidWeeks} weeks paid`).toBe(
        viewWeeksPaid,
      );
    }
  });

  it("a fully paid-up member agreed before and still agrees", () => {
    // The no-op: nobody whose record is ordinary sees any change.
    expect(viewWeeksBehind({}, ELAPSED)).toBe(0);
    expect(standingFor({}, ELAPSED).weeksBehind).toBe(0);
  });
});

describe("2.8 — THE DISCLOSURE GUARANTEE THAT MOVED OUT OF THE DATABASE", () => {
  const source = read("app/actions/member.ts");
  const fn = source.slice(
    source.indexOf("export async function getGroupProgress()"),
    source.indexOf("// ————————————————— Collections"),
  );

  it("the group action exists and no longer reads the view", () => {
    expect(fn.length).toBeGreaterThan(500);
    expect(source).not.toContain('from("member_progress")');
  });

  it("a peer discloses NAME, WEEKS PAID and BEHIND COUNT — and nothing else", () => {
    // The view granted SELECT on exactly six columns, so the database refused
    // to disclose more even if the application asked. That is now this
    // projection, and this is the test that holds it.
    // ANCHORED ON SINGLE LINES, and asserted non-empty before anything is read
    // off it: a slice that silently came back empty would satisfy every
    // "must not contain" below while proving nothing at all (§5.7).
    const start = fn.indexOf("participationId: p.id,");
    const end = fn.indexOf("const viewer =");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const row = fn.slice(start, end);
    expect(row.length).toBeGreaterThan(100);
    const allowed = [
      "participationId",
      "nameAmharic",
      "nameEnglishFirst",
      "weeksPaid",
      "weeksBehind",
    ];
    for (const field of allowed) expect(row, `${field} must be disclosed`).toContain(field);

    // NOTHING ABOUT ANYBODY ELSE'S MONEY. These are all real fields on the
    // standing the action now computes per member, which is exactly why the
    // projection has to be checked: they are one keystroke away.
    for (const forbidden of [
      "amountOutstanding",
      "amountDeferred",
      "totalPaid",
      "payoutNet",
      "phone",
      "weeklyAmount",
      "surplus",
      "paidUpToWeek",
    ]) {
      expect(row, `${forbidden} must never appear in a peer row`).not.toContain(forbidden);
    }
  });

  it("only the ACTIVE cycle's members, and only for a caller inside it", () => {
    // The view scoped rows through auth.uid() in SQL. With it gone the scope is
    // the query itself plus the membership check, and a caller who is not in
    // the cycle is refused rather than shown the group.
    expect(fn).toContain('where: { status: "ACTIVE" }');
    expect(fn).toContain("cycle.participations.find((p) => p.personId === person.id)");
    expect(fn).toContain('if (!mine) return { ok: false as const, error: "No active cycle." }');
  });
});

describe("GUARD — the view is gone, and nothing may read it again", () => {
  it("no application source references member_progress", () => {
    // Migrations keep the history — that is the record of what was dropped and
    // is how it would be restored. Application code must not reach for it.
    const files = [
      "app/actions/member.ts",
      "app/me/group/page.tsx",
      "lib/standing.ts",
      "lib/engine.ts",
    ];
    for (const file of files) {
      const text = read(file);
      const mentions = text.split("member_progress").length - 1;
      // A comment explaining the retirement is allowed; a QUERY is not.
      expect(text, `${file} must not query the view`).not.toContain('from("member_progress")');
      expect(text, `${file} must not select from the view`).not.toContain("member_progress AS");
      if (mentions > 0) expect(text).toContain("//");
    }
  });

  it("the drop migration exists and explains what was lost", () => {
    const sql = read("prisma/migrations/20260815234500_retire_member_progress_view/migration.sql");
    expect(sql).toContain("DROP VIEW IF EXISTS public.member_progress");
    // A migration that drops a security boundary must say where the boundary
    // went, or the next reader will assume it simply stopped mattering.
    expect(sql).toContain("2.8");
    expect(sql).toContain("member-group-disclosure.test.ts");
  });
});
