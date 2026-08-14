import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveFeedback } from "@/components/ui/save-button";

// THE CONFIRMATION'S LIFETIME (reported defect, Aug 2026).
//
// "✓ Recorded $500 for Tsion — covers week 3 in full." rendered through
// SaveFeedback and STAYED UNTIL NAVIGATION — so it sat beside a NEW week
// selection describing an OLD save. The doctrine (commit 5950258) stands:
// the confirmation renders AT the control. The defect was lifetime — the
// button's own confirmation faded after six seconds; the button-less
// SaveFeedback never faded at all.
//
// The rule now: a confirmation clears the moment its truth can go stale —
// any new selection, any other action on the page, or the shared six-second
// clock, whichever comes first. Failures still never auto-clear (6b).

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, ...p.split("/")), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("SaveFeedback — present after save, on the shared clock", () => {
  it("a success renders in the first-paint markup, with the tick", () => {
    const out = renderToStaticMarkup(
      <SaveFeedback state={{ kind: "ok", message: "Recorded $500 for Tsion — covers week 3 in full." }} />,
    );
    expect(out).toContain("covers week 3 in full");
    expect(out).toContain("✓");
    expect(out).toContain('data-testid="save-ok"');
  });

  it("a failure renders as an alert — and the source gives it NO timer (6b)", () => {
    const out = renderToStaticMarkup(
      <SaveFeedback state={{ kind: "err", message: "Not recorded: the window is closed." }} />,
    );
    expect(out).toContain('role="alert"');
    // The dismissal timer arms for ok ALONE. Read as source because a timer
    // cannot fire in a static render: the guard is the early return.
    const src = strip(read("components/ui/save-button.tsx"));
    const feedback = src.slice(src.indexOf("export function SaveFeedback"));
    expect(feedback).toContain('if (shown?.kind !== "ok") return;');
    // …on the same clock the button's own confirmation uses — one lifetime
    // rule, not two.
    expect(feedback).toContain("OK_VISIBLE_MS");
  });

  it("the exit collapses height so nothing below jumps", () => {
    const src = strip(read("components/ui/save-button.tsx"));
    const feedback = src.slice(src.indexOf("export function SaveFeedback"));
    expect(feedback).toContain("height: reduce ? \"auto\" : 0");
    expect(feedback).toContain('overflow: "hidden"');
    // The settle callback fires AFTER the fade completes — resetting the
    // caller when the timer starts would unmount the wrapper and cut the
    // fade to a blink.
    expect(feedback).toContain("onExitComplete");
  });
});

// The defect's own surface: /admin/people/[id] payments. A timer cannot run
// in a static render (no jsdom here — the limit every *-view test in this
// repo documents), so the staleness wiring is pinned at the source, each
// assertion naming the defect it would catch.
describe("member-payments — the confirmation never describes an OLD save beside a NEW selection", () => {
  const src = strip(read("app/admin/(protected)/people/[id]/member-payments.tsx"));

  // FALSIFIABLE: delete clearStaleConfirmation() from select() and this
  // fails — a new selection is exactly the moment the reported defect showed.
  it("any new selection clears the ok confirmation", () => {
    const selectFn = src.slice(src.indexOf("function select("), src.indexOf("function toggle("));
    expect(selectFn).toContain("clearStaleConfirmation()");
  });

  it("every other action on the page clears it too — ledger, hand-off, opening a panel", () => {
    expect(src.split("clearStaleConfirmation()").length - 1).toBeGreaterThanOrEqual(4);
    // The three action sites, by their neighbours:
    expect(src).toMatch(/clearStaleConfirmation\(\);\s*setLedgerSave\(\{ kind: "saving" \}\)/);
    expect(src).toMatch(/clearStaleConfirmation\(\);\s*setPreselect\(/);
    expect(src).toMatch(/clearStaleConfirmation\(\);\s*setExpandedWeek\(/);
  });

  // FALSIFIABLE: clear unconditionally and this fails — an unresolved
  // REFUSAL outlives a selection change (6b); only success goes stale.
  it("a failure survives the clear — only success goes stale", () => {
    expect(src).toContain('current.state.kind === "ok" ? null : current');
  });

  it("both ok-capable feedbacks reset through the fade, not before it", () => {
    expect(src).toContain("onStateSettled={() => setWeekSave(null)}");
    expect(src).toContain('onStateSettled={() => setLedgerSave({ kind: "idle" })}');
  });

  // The row-keying that makes "beside a DIFFERENT selection" structurally
  // impossible: the confirmation renders only on the row whose weekNumber it
  // recorded, and clearing on selection covers the rest.
  it("the confirmation is keyed to the row it describes", () => {
    expect(src).toContain("weekSave !== null && weekSave.weekNumber === w.weekNumber");
  });
});
