import { describe, expect, it } from "vitest";
import {
  bySigningOutstanding,
  countSigning,
  filterBySigning,
  SIGNING_FILTERS,
  signingBucket,
} from "./signing-monitor";
import { sortDirectory } from "./people-sort";
import type { SigningState } from "./agreement-view";

// THE SIGNING MONITOR. Its whole reason for existing is that the organizer
// could see 27 chips and never a total — and the one thing a total can get
// WRONG is treating "not asked" as a problem.

const row = (signing: SigningState) => ({ signing });

/** Every state the chip can render, so a new one cannot be silently dropped. */
const ALL: SigningState[] = ["signed", "waiting", "waiting-again", "waiting-unpaid", "not-asked"];

describe("the three buckets", () => {
  it("collapses every waiting shape into one job", () => {
    expect(signingBucket("waiting")).toBe("waiting");
    expect(signingBucket("waiting-again")).toBe("waiting");
    expect(signingBucket("waiting-unpaid")).toBe("waiting");
  });

  it("keeps signed and not-asked apart from it, and from each other", () => {
    expect(signingBucket("signed")).toBe("signed");
    expect(signingBucket("not-asked")).toBe("not-asked");
  });

  it("has a bucket for every state the chip can show", () => {
    for (const state of ALL) {
      expect(["signed", "waiting", "not-asked"]).toContain(signingBucket(state));
    }
  });
});

describe("the count", () => {
  const rows = [
    row("signed"),
    row("signed"),
    row("waiting"),
    row("waiting-again"),
    row("waiting-unpaid"),
    row("not-asked"),
    row("not-asked"),
  ];

  it("counts the three buckets and the total", () => {
    expect(countSigning(rows)).toEqual({ signed: 2, waiting: 3, notAsked: 2, total: 7 });
  });

  // THE RULING THIS PROTECTS: "not asked" is the ordinary state for everyone
  // already mid-cycle. Folding it into waiting would report five problems on
  // a group that has three.
  it("NEVER folds not-asked into waiting", () => {
    const counts = countSigning(rows);
    expect(counts.waiting).toBe(3);
    expect(counts.waiting).not.toBe(counts.waiting + counts.notAsked);
    // A roster where nobody was ever welcomed reports ZERO waiting.
    const nobodyAsked = countSigning([row("not-asked"), row("not-asked")]);
    expect(nobodyAsked.waiting).toBe(0);
    expect(nobodyAsked.notAsked).toBe(2);
  });

  it("the buckets add up to the total, so nothing is uncounted", () => {
    const c = countSigning(rows);
    expect(c.signed + c.waiting + c.notAsked).toBe(c.total);
  });

  it("an empty directory counts zero, not NaN", () => {
    expect(countSigning([])).toEqual({ signed: 0, waiting: 0, notAsked: 0, total: 0 });
  });
});

describe("the filter", () => {
  const rows = [row("signed"), row("waiting-again"), row("not-asked"), row("waiting-unpaid")];

  it("all is no filter", () => {
    expect(filterBySigning(rows, "all")).toHaveLength(4);
  });

  it("waiting gathers every waiting shape", () => {
    expect(filterBySigning(rows, "waiting")).toHaveLength(2);
  });

  it("signed and not-asked select only themselves", () => {
    expect(filterBySigning(rows, "signed")).toHaveLength(1);
    expect(filterBySigning(rows, "not-asked")).toHaveLength(1);
  });

  it("never mutates the caller's rows", () => {
    const before = [...rows];
    filterBySigning(rows, "signed");
    expect(rows).toEqual(before);
  });

  it("offers exactly the buckets it can filter by", () => {
    expect(SIGNING_FILTERS.map((f) => f.key)).toEqual(["all", "signed", "waiting", "not-asked"]);
  });
});

describe("the outstanding sort", () => {
  it("puts what needs doing first: waiting, then not asked, then signed", () => {
    const order = [row("signed"), row("not-asked"), row("waiting")].sort(bySigningOutstanding);
    expect(order.map((r) => signingBucket(r.signing))).toEqual(["waiting", "not-asked", "signed"]);
  });

  it("sorts alphabetically WITHIN a bucket, through the directory sort", () => {
    const people = [
      { nameEnglish: "Zed", signing: "waiting" as const, weeklyAmount: 0, contributedThisCycle: 0, weeksCommitted: 0, weeksPaid: 0 },
      { nameEnglish: "Abel", signing: "signed" as const, weeklyAmount: 0, contributedThisCycle: 0, weeksCommitted: 0, weeksPaid: 0 },
      { nameEnglish: "Ada", signing: "waiting" as const, weeklyAmount: 0, contributedThisCycle: 0, weeksCommitted: 0, weeksPaid: 0 },
    ];
    // Both waiting members come first, in name order — not one pile.
    expect(sortDirectory(people, "signing").map((p) => p.nameEnglish)).toEqual([
      "Ada",
      "Zed",
      "Abel",
    ]);
  });
});
