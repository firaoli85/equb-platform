import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./primitives";

// EMPTINESS SHOULD COST ABOUT AS MUCH ROOM AS IT CONTAINS (14 Aug 2026).
//
// One `px-6 py-12` bordered panel used to answer every "there is nothing
// here", including the ordinary ones — no pending payouts is what a settled
// week looks like, and /admin/cash nested that panel inside a Card to say so,
// producing a bordered box inside a bordered box for a single sentence.
//
// These tests hold the three variants apart. They are deliberately about SIZE
// and SURFACE, because that is the whole distinction: the words are the same
// in every case and only the room they take changes.

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("the three sizes of nothing", () => {
  it("the standing panel brings its own surface, because it stands alone", () => {
    const out = html(<EmptyState title="Nobody carries a balance." />);
    expect(out).toContain("border-gray-200");
    expect(out).toContain("py-12");
    expect(out).toContain("shadow-sm");
  });

  it("inside a card it brings NO second border, ground or shadow", () => {
    const out = html(<EmptyState variant="inside" title="No weeks yet." />);
    expect(out).not.toContain("shadow-sm");
    expect(out).not.toContain("border");
    expect(out).not.toContain("py-12");
  });

  it("the dashed line is a remark: no ground, no shadow, small type", () => {
    const out = html(<EmptyState variant="dashed" title="Everyone has been drawn." />);
    expect(out).toContain("border-dashed");
    expect(out).not.toContain("shadow-sm");
    expect(out).toContain("text-xs");
  });

  it("every variant still says the words — none of them is decoration", () => {
    for (const variant of ["panel", "inside", "dashed"] as const) {
      const out = html(<EmptyState variant={variant} title="Nothing here." hint="A reason." />);
      expect(out).toContain("Nothing here.");
      expect(out).toContain("A reason.");
    }
  });

  it("defaults to the panel, so an unconverted call site is unchanged", () => {
    expect(html(<EmptyState title="x" />)).toBe(html(<EmptyState variant="panel" title="x" />));
  });

  // Both grounds are painted. A variant whose colour is defined only for one
  // mode reads as the other mode's text on this mode's surface.
  it("every variant paints dark mode as well as light", () => {
    for (const variant of ["panel", "inside", "dashed"] as const) {
      const out = html(<EmptyState variant={variant} title="x" hint="y" />);
      expect(out).toContain("dark:text-gray-400");
    }
  });
});

// The call sites that motivated the variants, pinned where they were wrong.
describe("the screens that were announcing an ordinary state", () => {
  const read = (rel: string) => readFileSync(join(import.meta.dirname, "..", "..", rel), "utf8");

  it("/admin/cash no longer nests a bordered panel inside a Card", () => {
    const src = read("app/admin/(protected)/cash/page.tsx");
    expect(src).not.toContain('<div className="px-5 pb-5">');
    expect(src.match(/variant="inside"/g) ?? []).toHaveLength(4);
  });

  it("/admin/waiting states its two empty sections in a line, not a panel", () => {
    const src = read("app/admin/(protected)/waiting/waiting-view.tsx");
    // Both are ORDINARY: payouts current, and every number drawn at the end
    // of a cycle. The default filter is awaiting-payment, so the first was
    // the first thing on the page whenever the organizer was up to date.
    expect(src).toContain("Nobody is waiting to be paid.");
    expect(src).toContain("Everyone has been drawn.");
    expect(src.match(/variant="dashed"/g) ?? []).toHaveLength(2);
  });

  it("/admin/balances shows no figures and no pager when there are no rows", () => {
    const src = read("app/admin/(protected)/balances/page.tsx");
    // Three $0 cards and a rows-per-page dropdown around "Nobody carries a
    // balance." said nothing four times over.
    expect(src.match(/\{rows\.length > 0 && \(/g) ?? []).toHaveLength(2);
  });
});
