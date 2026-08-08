import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsistencyStrip, type MemberStrip } from "./consistency-strip";
import type { ConsistencyState } from "@/lib/chart";

// What this strip exists to answer is "who is slipping", so the tests are
// about ORDER and SHAPE — the two things that make the answer visible — and
// about the late joiner, whose short strip must not read as absence.

function strip(id: string, name: string, states: ConsistencyState[]): MemberStrip {
  return {
    participationId: id,
    name,
    weeks: states.map((state, i) => ({ weekNumber: i + 1, state })),
  };
}

const STEADY = strip("p1", "አለም — Alem", Array(6).fill("paid"));
const SCATTERED = strip("p2", "ብርሃኑ — Birhanu", [
  "paid",
  "overdue",
  "paid",
  "overdue",
  "paid",
  "overdue",
]);
const SLIPPING = strip("p3", "ቻልቱ — Chaltu", [
  "paid",
  "paid",
  "overdue",
  "overdue",
  "overdue",
  "partial",
]);

const render = (members: MemberStrip[]) =>
  renderToStaticMarkup(<ConsistencyStrip members={members} />);

describe("the consistency strip", () => {
  const html = render([STEADY, SCATTERED, SLIPPING]);

  it("puts the longest RUN first, not the highest count", () => {
    // Both Birhanu and Chaltu have three overdue weeks. Only one of them is
    // falling apart, and a count cannot tell them apart — which is exactly
    // why §5.4 refuses a percentage.
    const order = ["Chaltu", "Birhanu", "Alem"].map((n) => html.indexOf(n));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("names the worst run in the headline", () => {
    expect(html).toContain("3 weeks");
    expect(html).toContain("longest run");
    expect(html).toContain("Chaltu");
  });

  it("does not shout when nobody has a run", () => {
    const calm = render([STEADY]);
    expect(calm).not.toContain("longest run");
    expect(calm).not.toContain("in a row");
  });

  it("badges a run of two or more, and leaves a lone miss alone", () => {
    // Scattered misses are noise; a run is a person who has stopped.
    expect(html).toContain("3 in a row");
    const one = render([strip("p9", "One — One", ["paid", "overdue", "paid"])]);
    expect(one).not.toContain("in a row");
  });

  it("gives a late joiner a SHORT strip, not a strip full of holes", () => {
    const late = strip("p4", "ደረጀ — Dereje", ["paid", "paid"]);
    const out = render([STEADY, late]);
    const dots = [...out.matchAll(/aria-label="ደረጀ — Dereje, week (\d+)/g)].map((m) => m[1]);
    expect(dots).toEqual(["1", "2"]);
  });

  it("gives every dot a shape as well as a colour", () => {
    const all = render([
      strip("p5", "All — All", ["paid", "partial", "deferred", "overdue", "not-due"]),
    ]);
    // Overdue is the one that must be findable in greyscale: it is square.
    expect(all).toContain("rounded-[2px]");
    // Deferred is hollow with a ring; partial is half-filled.
    expect(all).toContain("border-2");
    expect(all).toContain("from-50%");
  });

  it("says what each dot means to a screen reader, per member and week", () => {
    expect(html).toContain('aria-label="ቻልቱ — Chaltu, week 3: overdue"');
    expect(html).toContain('aria-label="አለም — Alem, week 1: paid in full"');
  });

  it("gives every dot a real hit area, not just 8 pixels", () => {
    // A 20-dot row of bare 8px targets at 390px is a minefield. Each dot sits
    // inside its own reach.
    expect(html).toContain("h-4 w-[11px]");
  });

  it("links a row to the member and a dot to the week", () => {
    expect(html).toContain('href="/admin/participations/p3"');
    expect(html).toContain('href="/admin/payments?week=4"');
  });

  it("carries the counts as a table", () => {
    const table = html.slice(html.indexOf("<table"));
    expect(table).toContain("Longest overdue run");
    expect(table).toContain("<th scope=\"row\">ቻልቱ — Chaltu</th><td>2</td><td>3</td><td>3</td>");
  });

  it("says nothing rather than drawing an empty frame", () => {
    expect(render([])).toContain("Nobody is in the cycle yet");
  });
});
