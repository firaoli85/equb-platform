import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isChasedStatus, paymentStatus } from "./derived";
import { hasChaseableWeeks } from "./messages";
import { computeStanding } from "./standing";
import { STATUS_LABELS, STATUS_LEGEND } from "./status-labels";

// THE SIXTH STATE, ON EVERY SURFACE AT ONCE (R2 / ONE_TRUTH_ENGINE §3.3).
//
// A part-paid week whose window has closed is its own state: money arrived,
// the rest is still owed, and it is STILL CHASED. Before 15 Aug 2026 the
// ladder collapsed it into LATE — so a member who had paid $200 of a $2,000
// week was told nothing arrived, and the remainder was invisible.
//
// The migration rule is per-NUMBER: all six `status === "LATE"` consumers had
// to move in one commit, or week 14 would read one way on the grid and another
// on the portal. This file is what keeps them moved.

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Firaoli's week 14: $200 of $2,000, window closed. */
const WEEK_14 = {
  amountPaid: 20_000,
  amountDue: 200_000,
  isDeferred: false,
  weekDate: new Date("2026-08-02T00:00:00Z"),
  today: new Date("2026-08-15T00:00:00Z"),
};

describe("the live case — week 14, $200 of $2,000, window closed", () => {
  it("reads PARTIAL_LATE, not LATE", () => {
    expect(paymentStatus(WEEK_14)).toBe("PARTIAL_LATE");
  });

  it("STAYS CHASED — the $1,800 never drops off the chase (R2)", () => {
    // The money-visibility trap §3.3 warned about: softening the colour must
    // not quietly remove the debt from every chasing path.
    expect(isChasedStatus("PARTIAL_LATE")).toBe(true);
    expect(hasChaseableWeeks([{ status: "PARTIAL_LATE" }])).toBe(true);
  });

  it("carries its remainder on the member's own standing", () => {
    const standing = computeStanding({
      weeklyAmount: 200_000,
      startWeek: 1,
      weeksCommitted: 20,
      cycleWeek: 14,
      today: WEEK_14.today,
      totalPaid: 13 * 200_000 + 20_000,
      windowWeeks: Array.from({ length: 14 }, (_, i) => ({
        weekNumber: i + 1,
        date: new Date(Date.UTC(2026, 4, 3 + i * 7)),
        amountDue: 200_000,
        storedPaid: i < 13 ? 200_000 : 20_000,
        isDeferred: false,
        isSkipped: false,
        markedLate: false,
      })),
    });
    const w14 = standing.weeks.find((w) => w.weekNumber === 14)!;
    expect(w14.status).toBe("PARTIAL_LATE");
    // $2,000 − $200 = $1,800, and it is genuinely owed right now.
    expect(w14.amountDue - w14.coveredAtCurrentRate).toBe(180_000);
    expect(standing.amountOutstanding).toBe(180_000);
  });

  it("a week with NOTHING on it is still plain LATE — the money is the difference", () => {
    expect(paymentStatus({ ...WEEK_14, amountPaid: 0 })).toBe("LATE");
    expect(isChasedStatus("LATE")).toBe(true);
  });
});

describe("GUARD — all six LATE consumers moved together", () => {
  // Each of these asked `status === "LATE"` before R2. Any one of them left
  // behind means week 14 reads differently on that surface than on the others,
  // which is precisely the disagreement this build exists to end.
  const MIGRATED: [string, RegExp][] = [
    ["lib/messages.ts (hasChaseableWeeks)", /some\(\(w\) => isChasedStatus\(w\.status\)\)/],
    ["lib/messages.ts (lateWeeks)", /filter\(\(w\) => isChasedStatus\(w\.status\)\)/],
    ["app/actions/member.ts (portal late count)", /filter\(\(w\) => isChasedStatus\(w\.status\)\)/],
    ["app/actions/messages.ts (chasing gate)", /filter\(\(w\) => isChasedStatus\(w\.status\)\)/],
    ["components/member/equb-calendar.tsx", /status === "PARTIAL_LATE"/],
    ["components/member/week-stamp-list.tsx", /w\.status === "PARTIAL_LATE"/],
  ];

  for (const [label, pattern] of MIGRATED) {
    it(`${label} reads the new state`, () => {
      const file = label.split(" ")[0];
      expect(read(file)).toMatch(pattern);
    });
  }

  it("no surface still asks the bare LATE question for chaseability", () => {
    // The exact shape that was wrong in all six. A new one appearing means a
    // seventh consumer was written against the old ladder.
    for (const f of [
      "lib/messages.ts",
      "app/actions/member.ts",
      "app/actions/messages.ts",
    ]) {
      expect(read(f), f).not.toMatch(/=> w\.status === "LATE"/);
    }
  });
});

describe("the vocabulary is shared, so one week cannot look like two things", () => {
  it("PARTIAL_LATE has a label, and it says money arrived", () => {
    const label = STATUS_LABELS.PARTIAL_LATE;
    expect(label.text).toBe("Part paid");
    expect(label.meaning).toMatch(/still owed/);
    // BLUE, NOT RED (R2's ruled treatment): red asserts nothing came in.
    expect(label.cls).toMatch(/blue/);
    expect(label.cls).not.toMatch(/red/);
  });

  it("it is in the legend, so the grid explains its own colour", () => {
    expect(STATUS_LEGEND).toContain("PARTIAL_LATE");
  });

  it("but it is toned as a PROBLEM — softer colour, same chase", () => {
    // The colour is honest about the money; the tone is honest about the debt.
    expect(STATUS_LABELS.PARTIAL_LATE.tone).toBe("problem");
    expect(STATUS_LABELS.LATE.tone).toBe("problem");
  });
});

describe("THE BOUNDARY — screens and the chase, not the WhatsApp wording", () => {
  it("LATE_NOTICE still carries its Meta-frozen sentence, unchanged by this group", () => {
    // Phase 4 replaces it. Recorded here so the gap is deliberate and visible:
    // a part payer named in this notice is still told "we did not receive your
    // payment", which the trust law forbids. That was ALREADY true before this
    // group — such a week was LATE and already named — so nothing regressed;
    // it simply is not fixed yet.
    const templates = read("lib/whatsapp-templates.ts");
    expect(templates).toContain("we did not receive your payment");
  });
});
