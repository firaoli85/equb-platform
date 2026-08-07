import { describe, expect, it } from "vitest";
import { emptyDrawCleanup, freedWeekClause } from "./draw-cascade";

// THE BUG THIS PINS. Week 6's only winner was moved to week 7. The payout and
// the slot membership moved; the Draw stayed. Week 6 was then counted as
// drawn, held nothing, showed no amount in any picker, and could never be
// drawn again (Draw.@@unique([weekId])). A live audit found the same shape on
// week 1, left behind by deleting the last payout.
//
// The rule these tests hold in place: a draw records that a slot WON a week.
// With no payout left there is no win, so the draw goes and the week is
// genuinely undrawn — its slot numbers back in the pool.

describe("emptyDrawCleanup — a draw never survives its last payout", () => {
  it("leaves a draw alone while it still holds a payout", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 8,
      payoutsRemaining: 1,
      slotNumbers: [19],
    });
    expect(cleanup.deleteDraw).toBe(false);
    expect(cleanup.deleteSlot).toBe(false);
    expect(cleanup.numbersReturning).toEqual([]);
    expect(cleanup.sentence).toBe("");
  });

  it("leaves a draw alone when several payouts remain", () => {
    expect(
      emptyDrawCleanup({ weekNumber: 9, payoutsRemaining: 2, slotNumbers: [3, 44] }).deleteDraw,
    ).toBe(false);
  });

  // THE WEEK 1 SHAPE: the last payout was deleted, but #78 stayed in the slot
  // and so stayed out of the wheel pool.
  it("deletes the draw and returns the stranded numbers when the last payout goes", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 1,
      payoutsRemaining: 0,
      slotNumbers: [78],
    });
    expect(cleanup.deleteDraw).toBe(true);
    expect(cleanup.numbersReturning).toEqual([78]);
    expect(cleanup.sentence).toContain("Week 1");
    expect(cleanup.sentence).toContain("UNDRAWN");
    expect(cleanup.sentence).toContain("#78 returns to the wheel pool");
    // The slot still holds #78, so it is NOT released.
    expect(cleanup.deleteSlot).toBe(false);
  });

  // THE WEEK 6 SHAPE: the winner moved out, taking their slot membership with
  // them, so the slot was emptied too and must be released.
  it("releases the slot as well when nobody is left in it", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 6,
      payoutsRemaining: 0,
      slotNumbers: [],
    });
    expect(cleanup.deleteDraw).toBe(true);
    expect(cleanup.deleteSlot).toBe(true);
    expect(cleanup.numbersReturning).toEqual([]);
    expect(cleanup.sentence).toContain("Week 6");
    expect(cleanup.sentence).toContain("UNDRAWN");
    // No number moved, so none is claimed to have moved.
    expect(cleanup.sentence).not.toContain("wheel pool");
  });

  it("names every returning number, in order, and pluralises correctly", () => {
    const cleanup = emptyDrawCleanup({
      weekNumber: 4,
      payoutsRemaining: 0,
      slotNumbers: [55, 7, 22],
    });
    expect(cleanup.numbersReturning).toEqual([7, 22, 55]);
    expect(cleanup.sentence).toContain("#7, #22, #55 return to the wheel pool");
  });
});

describe("freedWeekClause — what the organizer's audit entry gains", () => {
  it("is empty when the week keeps its draw, so no summary is padded", () => {
    const cleanup = emptyDrawCleanup({ weekNumber: 8, payoutsRemaining: 1, slotNumbers: [19] });
    expect(freedWeekClause(cleanup, 8)).toBe("");
  });

  it("states the week is undrawn again and which numbers came back", () => {
    const cleanup = emptyDrawCleanup({ weekNumber: 6, payoutsRemaining: 0, slotNumbers: [19] });
    const clause = freedWeekClause(cleanup, 6);
    expect(clause).toContain("Week 6");
    expect(clause).toContain("UNDRAWN again");
    expect(clause).toContain("#19");
  });

  it("omits the number list when no number was stranded", () => {
    const cleanup = emptyDrawCleanup({ weekNumber: 6, payoutsRemaining: 0, slotNumbers: [] });
    expect(freedWeekClause(cleanup, 6)).toContain("UNDRAWN again");
    expect(freedWeekClause(cleanup, 6)).not.toContain("(");
  });
});
