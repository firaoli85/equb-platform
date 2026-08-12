import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveButton, SaveFeedback, type SaveState } from "./save-button";

// §2.10 / UI_STANDARDS rule 6 — SAVE FEEDBACK, ASSERTED ON RENDERED HTML.
//
// THE REPORTED DEFECT: the organizer changed a participation from 10 weeks to
// 12, pressed Save, and saw nothing. The save worked; the confirmation was
// rendered 100 lines of JSX ABOVE the button, at the top of a long form. He
// was looking at the button.
//
// These assert the MARKUP, not the state, because "we set a variable" was true
// in the broken version too. What matters is whether the confirmation is in
// the document, next to the control, and announced.

const html = (state: SaveState, extra: Partial<Parameters<typeof SaveButton>[0]> = {}) =>
  renderToStaticMarkup(
    <SaveButton state={state} onSave={() => {}} label="Save participation" {...extra} />,
  );

/**
 * Is the BUTTON disabled?
 *
 * Asserting `toContain("disabled")` is a trap here and these tests fell into
 * it: the class list carries `disabled:opacity-40` and
 * `disabled:pointer-events-none` on every render, so that check passes whether
 * or not the attribute is present. React renders the real attribute as
 * `disabled=""`.
 */
const isDisabled = (markup: string) => markup.includes('disabled=""');

describe("SaveButton — beat 3: success is unmistakable, AT the control", () => {
  it("renders the button", () => {
    expect(html({ kind: "idle" })).toContain("Save participation");
  });

  // THE FIX, ON THE RENDERED OUTPUT. The confirmation and the button are in
  // the SAME element — there is nowhere else for a caller to put it.
  it("renders the confirmation inside the same control group as the button", () => {
    const out = html({ kind: "ok", message: "Saved — $500/week, weeks 1 to 12." });
    expect(out).toContain("Saved — $500/week, weeks 1 to 12.");
    // Both inside the one wrapper: the message cannot be 100 lines away.
    const wrapper = out.slice(out.indexOf("<div"), out.lastIndexOf("</div>"));
    expect(wrapper).toContain("Save participation");
    expect(wrapper).toContain("Saved — $500/week");
  });

  it("marks the confirmation as a status, and announces it politely", () => {
    const out = html({ kind: "ok", message: "Saved." });
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    // It must NOT steal focus — he has not navigated anywhere.
    expect(out).not.toContain("autofocus");
  });

  it("prefixes success with a tick, so it reads as done at a glance", () => {
    expect(html({ kind: "ok", message: "Saved." })).toContain("✓ Saved.");
  });

  it("renders NOTHING when idle — no empty box waiting to be filled", () => {
    const out = html({ kind: "idle" });
    expect(out).not.toContain('data-testid="save-ok"');
    expect(out).not.toContain('data-testid="save-error"');
  });
});

describe("SaveButton — beat 2: the control shows it is working", () => {
  it("changes its own label while saving", () => {
    const out = html({ kind: "saving" }, { savingLabel: "Saving…" });
    expect(out).toContain("Saving…");
    expect(out).not.toContain("Save participation");
  });

  it("cannot be pressed twice", () => {
    expect(isDisabled(html({ kind: "saving" }))).toBe(true);
  });

  it("says so to a screen reader", () => {
    expect(html({ kind: "saving" })).toContain('aria-busy="true"');
    expect(html({ kind: "idle" })).toContain('aria-busy="false"');
  });

  it("clears a stale confirmation the moment a new save starts", () => {
    // Not the previous "✓ Saved" sitting there while the next one runs.
    expect(html({ kind: "saving" })).not.toContain("✓");
  });
});

describe("SaveButton — beat 1: dead until something has changed", () => {
  it("is disabled when nothing is dirty", () => {
    expect(isDisabled(html({ kind: "idle" }, { dirty: false }))).toBe(true);
  });

  // A disabled control with no explanation reads as a broken app
  // (UI_STANDARDS rule 11's reasoning, applied to a button).
  it("says WHY it is disabled rather than being silently dead", () => {
    const out = html({ kind: "idle" }, { dirty: false, notDirtyHint: "Nothing has changed yet." });
    expect(out).toContain('title="Nothing has changed yet."');
  });

  it("is live once something is dirty", () => {
    expect(isDisabled(html({ kind: "idle" }, { dirty: true }))).toBe(false);
  });

  it("does not claim a reason when it is disabled for being BUSY, not clean", () => {
    expect(html({ kind: "saving" }, { dirty: true })).not.toContain("title=");
  });
});

describe("SaveButton — beat 4: the reason, at the control", () => {
  it("renders a refusal beside the button, as an alert", () => {
    const out = html({ kind: "err", message: "Not saved: only 8 weeks remain in the cycle." });
    expect(out).toContain("Not saved: only 8 weeks remain in the cycle.");
    expect(out).toContain('role="alert"');
  });

  it("does not dress a refusal up with a tick", () => {
    expect(html({ kind: "err", message: "Not saved." })).not.toContain("✓");
  });

  it("leaves the button pressable so the fix can be retried", () => {
    expect(isDisabled(html({ kind: "err", message: "Not saved." }))).toBe(false);
  });
});

describe("SaveFeedback — the same confirmation without a button", () => {
  const feedback = (state: SaveState) => renderToStaticMarkup(<SaveFeedback state={state} />);

  it("renders success as a status and failure as an alert", () => {
    expect(feedback({ kind: "ok", message: "Recorded." })).toContain('role="status"');
    expect(feedback({ kind: "err", message: "Refused." })).toContain('role="alert"');
  });

  it("renders nothing at all when idle or saving", () => {
    expect(feedback({ kind: "idle" })).toBe("");
    expect(feedback({ kind: "saving" })).toBe("");
  });

  it("carries the same testids, so one QA check covers both", () => {
    expect(feedback({ kind: "ok", message: "x" })).toContain('data-testid="save-ok"');
    expect(feedback({ kind: "err", message: "x" })).toContain('data-testid="save-error"');
  });
});

// The confirmation must SAY WHAT CHANGED. "Saved" leaves the organizer
// checking the figures himself, which is the thing the confirmation exists to
// spare him.
describe("the message is the point, not the tick", () => {
  it("carries the new shape through to the markup verbatim", () => {
    const out = html({
      kind: "ok",
      message: "Saved — $500/week, weeks 1 to 12. Receipts re-allocated.",
    });
    expect(out).toContain("$500/week");
    expect(out).toContain("weeks 1 to 12");
    expect(out).toContain("Receipts re-allocated");
  });
});
