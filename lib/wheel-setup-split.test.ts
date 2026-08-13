import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// THE WHEEL SETUP SPLIT — and the hidden coupling it made visible.
//
// /admin/wheel/setup asked ONE question — "is the wheel ready to spin this
// week?" — and stacked six blocks before answering it. It is also the screen
// the organizer drives LIVE, on a shared call, every week.
//
// THE DEFECT THAT MATTERED WAS NOT THE STACKING. It was a coupling nothing
// said out loud: "Create plan" was `disabled={busy || dirty}` with its reason
// in a `title`, roughly 370 lines below the drag surface that set `dirty`. The
// organizer arranged slots, scrolled down, ticked two numbers, and met a dead
// button with no visible explanation. Splitting the screen made that WORSE on
// its own — the cause moved to a section he could no longer see — so the
// coupling had to be stated at the same time.
//
// These are source scans because the property is structural: it is about which
// control carries which sentence, and there is no jsdom here to click with.

const ROOT = join(import.meta.dirname, "..");
const setup = readFileSync(join(ROOT, "app/admin/wheel/setup/wheel-setup.tsx"), "utf8");

describe("two jobs, one at a time", () => {
  it("declares the two sections and remembers the choice", () => {
    expect(setup).toMatch(/const SECTIONS = \["arrange", "plan"\] as const/);
    expect(setup).toContain("usePersistedChoice<Section>");
    expect(setup).toContain("admin-wheel-setup-section");
  });

  it("renders a toggle between them", () => {
    expect(setup).toContain("SegmentedToggle");
    expect(setup).toMatch(/value: "arrange", label: "Arrange"/);
    expect(setup).toMatch(/value: "plan", label: "Plan winners"/);
  });

  // CLIENT STATE, NOT A LINK. The draft, its dirty flag and the drag state all
  // live in this component, so a `?section=` round trip would throw away
  // unsaved work every time he changed section — on the screen whose whole
  // point is unsaved work.
  it("switches sections without a navigation", () => {
    expect(setup, "a link would discard the draft").not.toMatch(
      /href=\{`\/admin\/wheel\/setup\?section=/,
    );
    expect(setup).toMatch(/onChange=\{setSection\}/);
  });

  it("hides each section rather than unmounting it", () => {
    // Unmounting the slot grid would destroy the draft it holds.
    expect(setup).toMatch(/section === "arrange" \? "" : "hidden"/);
    expect(setup).toMatch(/section === "plan" \? "" : "hidden"/);
  });

  // The empty wheel and a window closing undrawn are claims about the WHOLE
  // wheel. Hiding either behind a section means he could be looking straight
  // at the screen that owns the problem and not see it.
  it("keeps the whole-wheel warnings above the split", () => {
    const toggle = setup.indexOf("<SegmentedToggle");
    const empty = setup.indexOf("The wheel is EMPTY");
    const undrawn = setup.indexOf("Windows ending undrawn");
    expect(empty).toBeGreaterThan(-1);
    expect(undrawn).toBeGreaterThan(-1);
    expect(empty, "the empty-wheel notice must sit above the toggle").toBeLessThan(toggle);
    expect(undrawn, "the undrawn warnings must sit above the toggle").toBeLessThan(toggle);
  });
});

describe("the hidden coupling says why, in two places", () => {
  // THE CENTRAL ASSERTION. The reason must be a rendered string, not a `title`.
  it("states the unsaved-arrangement reason in text, not in a hover", () => {
    expect(setup).toContain("const arrangementRefusal =");
    expect(setup).toMatch(/The arrangement has unsaved changes/);
    expect(setup).toMatch(/save or discard them on Arrange first/);
    // The `title` that used to be the ONLY explanation is gone from the
    // Create-plan control.
    expect(setup, "the reason must not be a hover any more").not.toContain(
      'title={dirty ? "Save or discard the arrangement first" : undefined}',
    );
  });

  it("shows it on the Plan section AND at the button", () => {
    expect(setup).toMatch(/data-testid="arrangement-dirty-notice"/);
    expect(setup).toMatch(/data-testid="plan-blocked-by-arrangement"/);
  });

  // A refusal that names a place he cannot get to is half a refusal.
  it("carries the way back to the section that resolves it", () => {
    const goes = [...setup.matchAll(/onClick=\{\(\) => setSection\("arrange"\)\}/g)];
    expect(goes.length, "both notices need a way back").toBeGreaterThanOrEqual(2);
    expect(setup).toContain("Go to Arrange");
  });

  // `disabled` is a hint the DOM can lose — a stale render, a scripted click.
  // The handler is what actually runs.
  it("re-checks the coupling at the press, not only in `disabled`", () => {
    expect(setup).toMatch(/disabled=\{busy \|\| arrangementRefusal !== null \|\| planRefusal !== null\}/);
    expect(setup).toMatch(/if \(arrangementRefusal !== null\) \{\s*\n\s*setPlanError\(arrangementRefusal\);/);
  });

  // The live "what will happen" sentence must not claim a plan is committable
  // while the arrangement blocks it.
  it("suppresses the effect sentence while the arrangement blocks the commit", () => {
    expect(setup).toMatch(
      /planNumbers\.size > 0 && arrangementRefusal === null && planRefusal === null/,
    );
  });
});

describe("every action reports at itself", () => {
  it("holds one slot-keyed state, not a page banner", () => {
    expect(setup, "the page banner must be gone").not.toContain("setBanner");
    expect(setup).toMatch(/const \[save, setSave\] = useState<\{ slot: string; state: SaveState \}>/);
    expect(setup).toMatch(/const feedbackFor = \(slot: string\): SaveState =>/);
  });

  it("derives busy from that one state — never a second flag", () => {
    expect(setup).toMatch(/const busy = save\.state\.kind === "saving";/);
    expect(setup, "a second boolean would drift").not.toMatch(/setBusy\(/);
  });

  it("renders a slot for each cluster of controls", () => {
    for (const slot of ["arrangement", "auto-arrange", "plan"]) {
      expect(setup, `${slot} has no rendered feedback`).toContain(`feedbackFor("${slot}")`);
    }
    // …and per-plan, so cancelling one plan reports on that plan's row.
    expect(setup).toMatch(/feedbackFor\(`plan:\$\{p\.id\}`\)/);
  });

  it("saves the arrangement through the shared control", () => {
    expect(setup).toContain("<SaveButton");
    expect(setup).toMatch(/label="Save arrangement"/);
    expect(setup).toMatch(/dirty=\{dirty\}/);
  });
});

// The dialog closed on BOTH paths — synchronously, before the async action it
// had just started could resolve — so `setDialogError` was only ever reachable
// with `null` and every refusal was discarded with the dialog.
describe("a confirmation keeps its refusal", () => {
  it("closes only on success", () => {
    expect(setup).toMatch(/function ask\(spec: ConfirmSpec, fn: \(\) => Promise<string \| null \| void> \| void\)/);
    expect(setup).toMatch(/if \(typeof refused === "string" && refused\.length > 0\) \{\s*\n\s*setDialogError\(refused\);/);
  });

  it("the plan commit returns its refusal rather than swallowing it", () => {
    // Returned, so `ask` keeps the dialog open carrying the reason.
    expect(setup).toMatch(/\/\/ Returned, so the dialog STAYS OPEN carrying it\.\s*\n\s*return reason;/);
  });

  // NON-VACUITY. The old shape must be absent, and it is a shape a scan can
  // see: `fn()` followed immediately by an unconditional close.
  it("the old synchronous close is gone", () => {
    expect(setup).not.toMatch(/fn\(\);\s*\n\s*setConfirm\(null\);/);
  });
});
