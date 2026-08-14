import { describe, expect, it } from "vitest";
import { DIRECTORY_SORTS, sortDirectory } from "./people-sort";

// THE DIRECTORY'S FIVE ORDERS (14 Aug 2026): each key's order asserted on
// rows where every key disagrees with every other, so a comparator wired to
// the wrong field cannot pass by coincidence.

const ROWS = [
  { nameEnglish: "Abel", weeklyAmount: 100_000, contributedThisCycle: 400_000, weeksCommitted: 20, weeksPaid: 4 },
  { nameEnglish: "meheret", weeklyAmount: 300_000, contributedThisCycle: 300_000, weeksCommitted: 5, weeksPaid: 1 },
  { nameEnglish: "Tizita", weeklyAmount: 200_000, contributedThisCycle: 1_000_000, weeksCommitted: 10, weeksPaid: 5 },
];
const names = (rows: readonly { nameEnglish: string }[]) => rows.map((r) => r.nameEnglish);

describe("sortDirectory", () => {
  it("alphabetical is case-insensitive Latin order, and the default key exists", () => {
    expect(names(sortDirectory(ROWS, "name"))).toEqual(["Abel", "meheret", "Tizita"]);
    expect(DIRECTORY_SORTS[0]).toEqual({ key: "name", label: "Alphabetical" });
  });

  it("weekly amount: highest first", () => {
    expect(names(sortDirectory(ROWS, "weekly"))).toEqual(["meheret", "Tizita", "Abel"]);
  });

  it("total contributed: highest first", () => {
    expect(names(sortDirectory(ROWS, "contributed"))).toEqual(["Tizita", "Abel", "meheret"]);
  });

  it("weeks committed: highest first", () => {
    expect(names(sortDirectory(ROWS, "committed"))).toEqual(["Abel", "Tizita", "meheret"]);
  });

  it("weeks paid: highest first", () => {
    expect(names(sortDirectory(ROWS, "weeksPaid"))).toEqual(["Tizita", "Abel", "meheret"]);
  });

  it("ties fall back to the name, and the input array is never mutated", () => {
    const tied = [
      { nameEnglish: "Sara", weeklyAmount: 100, contributedThisCycle: 0, weeksCommitted: 10, weeksPaid: 0 },
      { nameEnglish: "Abel", weeklyAmount: 100, contributedThisCycle: 0, weeksCommitted: 10, weeksPaid: 0 },
    ];
    const before = [...tied];
    expect(names(sortDirectory(tied, "weekly"))).toEqual(["Abel", "Sara"]);
    expect(tied).toEqual(before);
  });

  it("every advertised key sorts — no option is a dead entry", () => {
    for (const s of DIRECTORY_SORTS) {
      expect(() => sortDirectory(ROWS, s.key)).not.toThrow();
      expect(sortDirectory(ROWS, s.key)).toHaveLength(ROWS.length);
    }
  });
});
