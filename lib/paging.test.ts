import { describe, expect, it } from "vitest";
import { CAPS, pageInfo, pageSummary, parsePage, truncationNotice } from "./paging";

// The failure this module exists to prevent is not slowness. It is a list
// that shows part of itself while LOOKING whole — an organizer scrolls to the
// bottom of the message log, does not find last cycle's notice, and concludes
// it was never sent.

describe("where a page sits in the whole", () => {
  it("gives the first page the right slice", () => {
    const info = pageInfo(189, 1, 25);
    expect(info).toMatchObject({ page: 1, pages: 8, skip: 0, take: 25, firstShown: 1, lastShown: 25 });
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(true);
  });

  it("gives the last page only what is left", () => {
    const info = pageInfo(189, 8, 25);
    expect(info.skip).toBe(175);
    expect(info.lastShown).toBe(189);
    expect(info.hasNext).toBe(false);
  });

  it("CLAMPS a page past the end rather than showing an empty screen", () => {
    // Filters narrow while a page number stays put. An empty page reads as
    // "there is nothing here", which is a different and wrong claim.
    const info = pageInfo(10, 99, 25);
    expect(info.page).toBe(1);
    expect(info.firstShown).toBe(1);
    expect(info.lastShown).toBe(10);
  });

  it("clamps a page below one", () => {
    expect(pageInfo(100, 0, 25).page).toBe(1);
    expect(pageInfo(100, -5, 25).page).toBe(1);
  });

  it("an empty list is one page, showing nothing", () => {
    const info = pageInfo(0, 1, 25);
    expect(info.pages).toBe(1);
    expect(info.firstShown).toBe(0);
    expect(info.lastShown).toBe(0);
    expect(info.hasNext).toBe(false);
  });

  it("never divides by a zero page size", () => {
    const info = pageInfo(100, 1, 0);
    expect(Number.isFinite(info.pages)).toBe(true);
    expect(info.take).toBeGreaterThan(0);
  });
});

describe("the page number out of a URL", () => {
  it("reads a normal value", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["4"])).toBe(4);
  });

  it("falls back to one for anything unusable", () => {
    // ?page=abc must not produce NaN and skip a NaN number of rows.
    for (const raw of [undefined, "", "abc", "-2", "0", "1e999"]) {
      expect(parsePage(raw)).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(parsePage(raw))).toBe(true);
    }
  });
});

describe("the sentence a paged list always shows", () => {
  it("says it is showing everything when it is", () => {
    expect(pageSummary(pageInfo(12, 1, 25), { one: "receipt", many: "receipts" })).toBe(
      "All 12 receipts.",
    );
  });

  it("counts one properly", () => {
    expect(pageSummary(pageInfo(1, 1, 25), { one: "receipt", many: "receipts" })).toBe("1 receipt.");
  });

  it("names the range when there is more than one page", () => {
    expect(pageSummary(pageInfo(189, 2, 25), { one: "receipt", many: "receipts" })).toBe(
      "26–50 of 189 receipts.",
    );
  });

  it("says nothing is there rather than showing an unexplained blank", () => {
    expect(pageSummary(pageInfo(0, 1, 25), { one: "receipt", many: "receipts" })).toBe(
      "No receipts.",
    );
  });
});

describe("a capped list admits when it has been cut", () => {
  it("says nothing when everything fits", () => {
    // A permanent "showing the first 500" on a list of 27 is noise, and noise
    // trains the reader to skip it the one time it matters.
    expect(truncationNotice({ shown: 27, cap: CAPS.people, noun: "people" })).toBeNull();
  });

  it("says so plainly when the cap was actually reached", () => {
    const notice = truncationNotice({ shown: 500, cap: 500, noun: "people" });
    expect(notice).toContain("first 500");
    expect(notice).toContain("more than this");
  });

  it("points at the full list when there is one", () => {
    const notice = truncationNotice({
      shown: 25,
      cap: 25,
      noun: "sign-ins",
      fullListAt: "the audit log",
    });
    expect(notice).toContain("the audit log");
  });
});
