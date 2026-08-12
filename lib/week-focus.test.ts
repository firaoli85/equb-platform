import { describe, expect, it } from "vitest";
import { focusedWeek, focusNotice } from "./week-focus";

// ARRIVING AT A WEEK (ADMIN_IA §8).
//
// Eleven links wrote `/admin/payments?week=N`; the destination read nothing.
// These pin the parse, and the second block pins the thing the original guard
// could not see — that the route CONSUMES what the links carry.

describe("the week a link asked for", () => {
  it("takes a plain week number", () => {
    expect(focusedWeek("7", 20)).toBe(7);
  });

  it("is null when no week was asked for", () => {
    expect(focusedWeek(undefined, 20)).toBeNull();
  });

  // A request the screen cannot honour is answered by the ordinary view, never
  // by a highlight pointing at nothing.
  it("refuses a week outside the cycle", () => {
    expect(focusedWeek("0", 20)).toBeNull();
    expect(focusedWeek("21", 20)).toBeNull();
    expect(focusedWeek("999", 20)).toBeNull();
  });

  it("takes the last week of the cycle", () => {
    expect(focusedWeek("20", 20)).toBe(20);
  });

  // `Number("")` is 0 and `Number(" 7 ")` is 7 — neither came from a click.
  it("refuses anything that is not digits", () => {
    for (const junk of ["", " ", "abc", "7.5", "-3", " 7 ", "7e0", "0x7"]) {
      expect(focusedWeek(junk, 20), `${JSON.stringify(junk)} should not focus a week`).toBeNull();
    }
  });

  // The URL spec allows a repeated key and a double-click can produce one.
  it("takes the first of a repeated parameter rather than NaN", () => {
    expect(focusedWeek(["7", "8"], 20)).toBe(7);
    expect(focusedWeek([], 20)).toBeNull();
  });

  it("says which week it is showing, and that the rest is still there", () => {
    expect(focusNotice(7)).toBe("Showing week 7. Every other week is still below.");
  });
});
