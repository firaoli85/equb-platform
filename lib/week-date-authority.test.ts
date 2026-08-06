import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextWeekDates } from "./commitment";

// THE STORED WEEK DATE WINS (2.14, 2.7). Two halves are guarded here:
//
//   READ  — no screen may compute a week's date when a stored row exists. The
//           only sanctioned way to get one is resolveWeekDate, which prefers
//           the row. This is enforced by scanning the source, because a NEW
//           screen reaching for dateOfWeek is exactly how the divergence came
//           back the first time.
//   WRITE — a new week row continues the rhythm from the last day that
//           actually happened, never from a start date that may since have
//           been edited.

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no screen computes a week date behind the resolver's back", () => {
  // Screens render; they do not decide what day a week fell on. Anything under
  // app/ or components/ that reaches for the raw calendar helpers is a
  // regression — it will silently disagree with the weeks page the moment a
  // cycle's start date is corrected.
  const RAW_CALENDAR = ["dateOfWeek", "generateWeekDates"];

  // The ONE sanctioned exception: createCycle generates a brand-new cycle's
  // week rows. That call is what MAKES the stored truth, so it is computed by
  // definition — everything else must read what it wrote.
  const ALLOWED = ["actions/cycles.ts"];

  const files = [...walk("app"), ...walk("components")].filter(
    (f) => !ALLOWED.some((a) => f.replace(/\\/g, "/").endsWith(a)),
  );

  it("finds the source tree (guards against a silently empty scan)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("app/ and components/ never call dateOfWeek or generateWeekDates", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const symbol of RAW_CALENDAR) {
        // Word-boundary match so "dateOfWeekLabel" would not trip it.
        if (new RegExp(`\\b${symbol}\\b`).test(source)) {
          offenders.push(`${file} uses ${symbol}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("nextWeekDates — new rows continue from the last REAL week", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  it("continues the weekly rhythm from the last stored row", () => {
    const made = nextWeekDates({
      existing: [
        { weekNumber: 1, date: d("2026-05-17") },
        { weekNumber: 20, date: d("2026-09-27") },
      ],
      fromWeek: 21,
      toWeek: 23,
      cycleStartDate: d("2026-05-17"),
    });
    expect(made.map((w) => [w.weekNumber, iso(w.date)])).toEqual([
      [21, "2026-10-04"],
      [22, "2026-10-11"],
      [23, "2026-10-18"],
    ]);
  });

  it("does NOT run backwards when the start date was moved EARLIER", () => {
    // The bug this exists to prevent: the organizer corrects the start date
    // back to March 1, the stored rows keep their May/September dates, and
    // projecting week 21 off the new start date would put it BEFORE week 20.
    const movedStart = d("2026-03-01");
    const made = nextWeekDates({
      existing: [
        { weekNumber: 1, date: d("2026-05-17") },
        { weekNumber: 20, date: d("2026-09-27") },
      ],
      fromWeek: 21,
      toWeek: 21,
      cycleStartDate: movedStart,
    });
    expect(iso(made[0].date)).toBe("2026-10-04");
    // What the old projection would have produced — earlier than week 20.
    const projected = new Date(movedStart.getTime() + 20 * 7 * 86_400_000);
    expect(projected.getTime()).toBeLessThan(d("2026-09-27").getTime());
    expect(made[0].date.getTime()).toBeGreaterThan(d("2026-09-27").getTime());
  });

  it("never re-creates a week that already has a row", () => {
    const made = nextWeekDates({
      existing: [
        { weekNumber: 20, date: d("2026-09-27") },
        { weekNumber: 21, date: d("2026-10-04") },
      ],
      fromWeek: 21,
      toWeek: 22,
      cycleStartDate: d("2026-05-17"),
    });
    expect(made.map((w) => w.weekNumber)).toEqual([22]);
    // Week 22 follows week 21's REAL date, not week 20's.
    expect(iso(made[0].date)).toBe("2026-10-11");
  });

  it("falls back to the cycle start only when no week exists at all", () => {
    const made = nextWeekDates({
      existing: [],
      fromWeek: 1,
      toWeek: 3,
      cycleStartDate: d("2026-05-17"),
    });
    expect(made.map((w) => iso(w.date))).toEqual(["2026-05-17", "2026-05-24", "2026-05-31"]);
  });

  it("ignores a corrupt stored date when choosing the anchor", () => {
    const made = nextWeekDates({
      existing: [
        { weekNumber: 1, date: d("2026-05-17") },
        { weekNumber: 2, date: new Date(Number.NaN) },
      ],
      fromWeek: 3,
      toWeek: 3,
      cycleStartDate: d("2026-05-17"),
    });
    expect(Number.isNaN(made[0].date.getTime())).toBe(false);
    expect(iso(made[0].date)).toBe("2026-05-31");
  });

  it("returns nothing when the range is already covered", () => {
    expect(
      nextWeekDates({
        existing: [{ weekNumber: 5, date: d("2026-06-14") }],
        fromWeek: 5,
        toWeek: 5,
        cycleStartDate: d("2026-05-17"),
      }),
    ).toEqual([]);
  });
});

describe("no MONEY path derives its clock from cycle.startDate", () => {
  // currentWeekNumber(cycle.startDate, today) answers "which week are we in on
  // the calendar" — a fine DISPLAY fact. It must never decide what is owed:
  // the start date is editable, and correcting it may not move anyone's
  // arrears. Money uses elapsedThroughWeek / currentWeekFromRows, which read
  // the stored week rows.
  //
  // These files still call currentWeekNumber for display. Each is listed with
  // WHY, so adding a new one is a deliberate act rather than an accident.
  const DISPLAY_ONLY = new Map([
    ["app/actions/cycle-close.ts", "the closing review's 'week N of M' header"],
    ["app/actions/dashboard.ts", "the dashboard's current-week label and week series"],
    ["app/actions/member.ts", "the portal's 'week N of M' and the group page header"],
    ["app/actions/payments-view.ts", "which week the payments grid opens on"],
    ["app/actions/payments.ts", "the member profile's current-week label"],
    ["app/admin/(protected)/collections/page.tsx", "the standing input's display week"],
    ["app/admin/(protected)/cycle/add/page.tsx", "the wizard's default start week"],
    ["app/admin/(protected)/cycle/page.tsx", "the cycle header's 'Week N of M'"],
    ["lib/messaging-engine.ts", "the {week} placeholder in a statement"],
    ["lib/commitment.ts", "currentWeekFromRows' fallback, used only past the last stored row"],
  ]);

  const slash = (f: string) => f.split("\\").join("/");
  const files = [...walk("app"), ...walk("lib"), ...walk("components")].filter(
    (f) => !slash(f).endsWith("lib/money.ts"),
  );

  it("every currentWeekNumber caller is a KNOWN display-only site", () => {
    const callers = files
      .filter((f) => /\bcurrentWeekNumber\b/.test(readFileSync(f, "utf8")))
      .map(slash);
    const unexpected = callers.filter(
      (f) => ![...DISPLAY_ONLY.keys()].some((known) => f.endsWith(known)),
    );
    expect(unexpected).toEqual([]);
  });

  it("the money derivations never mention currentWeekNumber at all", () => {
    // standing.ts owns weeksBehind/amountOutstanding; dashboard.ts owns the
    // attention list. Neither may reach for the projected clock.
    for (const f of ["lib/standing.ts", "lib/dashboard.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\bcurrentWeekNumber\b/);
    }
  });

  it("computeStanding decides elapsed from each week's own date", () => {
    const source = readFileSync("lib/standing.ts", "utf8");
    expect(source).toMatch(/weekHasElapsed\(\{ weekDate: w\.date, today \}\)/);
    // The old projected filter must be gone for good.
    expect(source).not.toMatch(/weekNumber <= cycleWeek/);
  });
});
