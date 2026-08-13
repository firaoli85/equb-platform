import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION, parsePositionSection, positionSections } from "./sections";

// The nav is worth reading BEFORE clicking, or it is just four buttons. The
// counts and the attention dots come from real state, so a dot means something
// every time it appears — a dot that is always on teaches the reader to skip it.

describe("parsePositionSection — never trusts the URL", () => {
  it("accepts the real sections", () => {
    expect(parsePositionSection("collection")).toBe("collection");
    expect(parsePositionSection("ahead")).toBe("ahead");
    expect(parsePositionSection("holding")).toBe("holding");
    expect(parsePositionSection("cash")).toBe("cash");
    expect(parsePositionSection("weeks")).toBe("weeks");
  });

  it("falls back to the default for anything else", () => {
    expect(parsePositionSection(undefined)).toBe(DEFAULT_SECTION);
    expect(parsePositionSection("")).toBe(DEFAULT_SECTION);
    expect(parsePositionSection("../../etc/passwd")).toBe(DEFAULT_SECTION);
    expect(parsePositionSection("Cash")).toBe(DEFAULT_SECTION);
  });

  it("takes the first value when the parameter repeats", () => {
    expect(parsePositionSection(["cash", "holding"])).toBe("cash");
  });

  it("opens on Collection — the week he is living in", () => {
    expect(DEFAULT_SECTION).toBe("collection");
  });
});

describe("positionSections — the dots mean something", () => {
  const clean = {
    owedByCount: 0,
    shortfall: 0,
    aheadByCount: 0,
    paidAhead: 0,
    toCover: 0,
    holdingLessThanOwed: false,
    verdictKind: "surplus" as const,
    outOfSequenceCount: 0,
  };

  it("a cycle in good order shows no dots at all", () => {
    const s = positionSections(clean);
    expect(s.filter((x) => x.attention)).toEqual([]);
  });

  it("marks Collection when money is genuinely outstanding", () => {
    const s = positionSections({ ...clean, shortfall: 40_000, owedByCount: 2 });
    const collection = s.find((x) => x.key === "collection")!;
    expect(collection.attention).toBe(true);
    expect(collection.count).toBe(2);
  });

  // Money he has to cover himself sits in NO total on the page — those weeks
  // stopped being expected — so it has to earn the dot by itself.
  it("marks Collection when money is his to cover, even with nobody behind", () => {
    const s = positionSections({ ...clean, toCover: 800_000 });
    expect(s.find((x) => x.key === "collection")!.attention).toBe(true);
  });

  it("marks Paid ahead only when there IS money paid ahead", () => {
    expect(positionSections(clean).find((x) => x.key === "ahead")!.attention).toBe(false);
    const s = positionSections({ ...clean, paidAhead: 75_000, aheadByCount: 3 });
    expect(s.find((x) => x.key === "ahead")!.attention).toBe(true);
    expect(s.find((x) => x.key === "ahead")!.count).toBe(3);
  });

  // The whole point of the screen: holding LESS than the money that belongs to
  // other people IS "I am using other people's money".
  it("marks What you should hold when he holds less than belongs to others", () => {
    const s = positionSections({ ...clean, holdingLessThanOwed: true });
    expect(s.find((x) => x.key === "holding")!.attention).toBe(true);
  });

  it("leaves it clear when what he holds covers what belongs to other people", () => {
    const s = positionSections({ ...clean, holdingLessThanOwed: false });
    expect(s.find((x) => x.key === "holding")!.attention).toBe(false);
  });

  it("marks What you hold when no reading has been taken — the comparison cannot run", () => {
    const s = positionSections({ ...clean, verdictKind: null });
    expect(s.find((x) => x.key === "cash")!.attention).toBe(true);
  });

  it("marks it when he is short", () => {
    const s = positionSections({ ...clean, verdictKind: "short" });
    expect(s.find((x) => x.key === "cash")!.attention).toBe(true);
  });

  it("leaves it clear when the cash is reconciled", () => {
    for (const kind of ["covered", "surplus", "exact"] as const) {
      const s = positionSections({ ...clean, verdictKind: kind });
      expect(s.find((x) => x.key === "cash")!.attention).toBe(false);
    }
  });

  // WEEK DATES ARE THE ONE STORED FACT ON THIS PAGE (rule 7), so their dot
  // means something different from every other dot here: not "money needs
  // you", but "a date cannot be true". A cycle running in order must show
  // nothing at all, or the section that exists to catch a rare fault becomes a
  // permanent decoration.
  it("leaves Week dates clear while the cycle runs in order", () => {
    const weeks = positionSections(clean).find((x) => x.key === "weeks")!;
    expect(weeks.attention).toBe(false);
    expect(weeks.count).toBeUndefined();
  });

  it("marks Week dates when a week is dated out of sequence (audit finding 29)", () => {
    const weeks = positionSections({ ...clean, outOfSequenceCount: 1 }).find(
      (x) => x.key === "weeks",
    )!;
    expect(weeks.attention).toBe(true);
    // The count is FAULTS, not weeks: "20" beside a tab is a size, and a
    // number that is normally absent is a finding.
    expect(weeks.count).toBe(1);
  });

  it("omits a zero count rather than rendering an empty bubble", () => {
    const s = positionSections(clean);
    expect(s.find((x) => x.key === "collection")!.count).toBeUndefined();
    expect(s.find((x) => x.key === "ahead")!.count).toBeUndefined();
    expect(s.find((x) => x.key === "weeks")!.count).toBeUndefined();
  });

  it("keeps the organizer's own order, with the stored dates last", () => {
    expect(positionSections(clean).map((s) => s.key)).toEqual([
      "collection",
      "ahead",
      "holding",
      "cash",
      "weeks",
    ]);
  });
});
