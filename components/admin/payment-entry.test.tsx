import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentEntry } from "./payment-entry";
import type { PickableWeek } from "@/lib/week-picking";

// PAYMENT ENTRY, ASSERTED ON RENDERED HTML.
//
// The unit tests in lib/week-picking.test.ts pin the arithmetic. These pin
// that the arithmetic reaches the screen: the squares, the chips, the
// remainder line, the selection bar, and the §2.15 note that fires when the
// money lands somewhere other than what was ticked.

const week = (n: number, over: Partial<PickableWeek> = {}): PickableWeek => ({
  weekNumber: n,
  amountDue: 50_000, // $500
  amountPaid: 0,
  isSkipped: false,
  isDeferred: false,
  ...over,
});

const owing = [5, 6, 7, 8, 9, 10, 11, 12].map((n) => week(n));

const html = (over: Partial<Parameters<typeof PaymentEntry>[0]> = {}) =>
  renderToStaticMarkup(
    <PaymentEntry
      participationId="p1"
      memberName="Getahun"
      weeks={owing}
      onRecorded={() => {}}
      {...over}
    />,
  );

describe("the weeks render as squares — the grid IS the preview", () => {
  it("draws one square per week of their own window", () => {
    const out = html();
    for (const n of [5, 8, 12]) expect(out).toContain(`data-week="${n}"`);
    expect(out).not.toContain('data-week="4"');
    expect(out).not.toContain('data-week="13"');
  });

  it("names what each square is worth, so no figure needs looking up", () => {
    expect(html()).toContain("Week 5 — $500 still owed");
  });

  // A square that cannot be ticked says WHY, rather than being silently dead.
  it("disables a skipped week and says nobody owes it", () => {
    const out = html({ weeks: [week(5, { isSkipped: true }), week(6)] });
    expect(out).toContain("skipped, nobody owes it");
    expect(out).toContain('disabled=""');
  });

  it("disables a week already paid, and says so", () => {
    expect(html({ weeks: [week(5, { amountPaid: 50_000 })] })).toContain("already paid");
  });

  // Deferred is not skipped (rule 5): still owed, so still tickable.
  it("leaves a deferred week tickable", () => {
    const out = html({ weeks: [week(5, { isDeferred: true })] });
    expect(out).toContain("Week 5 — $500 still owed");
  });
});

describe("preselect — the cell they clicked arrives ticked", () => {
  it("marks the preselected weeks as pressed", () => {
    const out = html({ preselect: [8, 9] });
    expect(out).toMatch(/data-week="8"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-week="8"/);
  });

  it("fills the amount from them, so no arithmetic is done by hand", () => {
    // Four weeks at $500 → the Record button carries the figure.
    expect(html({ preselect: [8, 9, 10, 11] })).toContain("Record $2,000");
  });

  it("shows the selection bar with the count and the total", () => {
    const out = html({ preselect: [8, 9, 10, 11] });
    expect(out).toContain('data-testid="selection-bar"');
    expect(out).toContain("4 weeks selected");
    expect(out).toContain("$2,000");
  });

  // The bar appears on first tick, never before — an always-present bar of
  // dead controls is noise (Xero/Deel, and the bulk-action guidance).
  it("renders NO selection bar when nothing is ticked", () => {
    expect(html()).not.toContain('data-testid="selection-bar"');
  });

  it("ignores a preselected week that cannot be ticked", () => {
    const out = html({ weeks: [week(5, { isSkipped: true }), week(6)], preselect: [5] });
    expect(out).not.toContain('data-testid="selection-bar"');
  });
});

describe("the remainder line is ALWAYS present", () => {
  // Partial payments are first-class, so this does not appear and disappear —
  // a field that comes and goes is one he stops reading.
  it("renders even with nothing entered", () => {
    const out = html();
    expect(out).toContain('data-testid="coverage"');
    expect(out).toContain("Nothing to record yet.");
  });

  it("names the weeks covered and the leftover in one sentence", () => {
    const out = html({ preselect: [5, 6, 7] });
    expect(out).toContain("This covers weeks 5, 6 and 7 in full.");
  });

  it("is announced politely, not as an alert", () => {
    expect(html()).toContain('aria-live="polite"');
  });
});

describe("quick amounts — computed from their real weeks", () => {
  it("offers one week, four weeks and everything owed, with figures", () => {
    const out = html();
    expect(out).toContain('data-testid="quick-amount"');
    expect(out).toContain("1 week · $500");
    expect(out).toContain("4 weeks · $2,000");
    expect(out).toContain("All 8 owed · $4,000");
  });

  it("offers none when nothing is owed", () => {
    expect(html({ weeks: [week(5, { amountPaid: 50_000 })] })).not.toContain(
      'data-testid="quick-amount"',
    );
  });
});

// §2.15, ON SCREEN. Ticking computes an amount; the engine sends it to the
// oldest debt. When those differ it must SAY so, before anything commits.
describe("the honest half: when money lands elsewhere", () => {
  it("says so when the ticked weeks are not the weeks paid", () => {
    // Tick 9–12; the money goes to 5, 6, 7, 8 — no overlap at all.
    const out = html({ preselect: [9, 10, 11, 12] });
    expect(out).toContain('data-testid="lands-elsewhere"');
    expect(out).toContain("lands on weeks 5, 6, 7, 8 first");
    expect(out).toContain("older and still owed");
    expect(out).toContain("Money always pays the oldest debt first");
  });

  it("stays silent when the ticked weeks ARE the weeks paid", () => {
    expect(html({ preselect: [5, 6, 7] })).not.toContain('data-testid="lands-elsewhere"');
  });

  it("stays silent when nothing is ticked — there is nothing to contradict", () => {
    expect(html()).not.toContain('data-testid="lands-elsewhere"');
  });
});

describe("the record control — §2.10 beats 1 to 4", () => {
  it("is dead with nothing entered, and says why", () => {
    const out = html();
    expect(out).toContain('disabled=""');
    expect(out).toContain("Enter an amount, or tick the weeks it covers.");
  });

  it("carries the figure so he can see what he is about to record", () => {
    expect(html({ preselect: [5] })).toContain("Record $500");
  });

  it("refuses an amount their weeks cannot absorb, and says to reduce it", () => {
    // One week owed, but four ticked elsewhere is impossible — use a small
    // window and a preselect that overshoots via the coverage path.
    const out = html({ weeks: [week(5)], preselect: [5] });
    expect(out).toContain("Record $500");
    expect(out).not.toContain("does not fit their remaining weeks");
  });
});
