import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// UI_STANDARDS RULE 6 ON THE MEMBER SIGN-IN FLOW.
//
// These read the SOURCE rather than rendered markup, and that is a second
// choice made for a stated reason rather than a shortcut. The only save on
// this screen — "Save my PIN" — sits on a step reached only AFTER a successful
// server sign-in, and this suite renders with renderToStaticMarkup on Node
// with no DOM to click through. A static render of LoginFlow can therefore
// only ever produce step one, where that button does not exist.
//
// So every assertion below is written to FAIL if the conversion is reverted or
// the placement drifts back — an anchor, never a description. The four beats
// of the button itself are asserted on real markup in
// components/ui/save-button.test.tsx.

const source = readFileSync(join(import.meta.dirname, "login-flow.tsx"), "utf8");

/** Does `earlier` really come before `later` in the file? */
function precedes(earlier: string, later: string): boolean {
  const a = source.indexOf(earlier);
  const b = source.indexOf(later);
  expect(a, `anchor not found: ${earlier}`).toBeGreaterThan(-1);
  expect(b, `anchor not found: ${later}`).toBeGreaterThan(-1);
  return a < b;
}

describe("setting a new PIN is a save, so SaveButton owns it", () => {
  it("hands it to SaveButton instead of a hand-rolled button", () => {
    expect(source).toMatch(/<SaveButton/);
    // The button that used to carry its own label and its own disabled rule.
    expect(source).not.toContain('{savingPin ? "Saving…" : "Save my PIN"}');
  });

  it("gates the button on a PIN long enough to be one (beat 1)", () => {
    expect(source).toMatch(/dirty=\{newPin\.length >= MIN_PIN\}/);
    // A dead button must say why pressing it would do nothing.
    expect(source).toMatch(/notDirtyHint=/);
  });

  it("keeps ONE record of whether it is saving (beat 2)", () => {
    // Derived, never a second boolean: a `useTransition` pending flag beside a
    // SaveState is the same fact stored twice, and the two drift.
    expect(source).toContain('const savingPin = pinSave.kind === "saving";');
    expect(source).not.toContain("startSavePin");
  });

  it("says WHAT HAPPENED, with the figure, and never the PIN itself (beat 3)", () => {
    expect(source).toContain("-digit PIN is set");
    expect(source).toMatch(/\$\{newPin\.length\}-digit/);
    // The digits they typed must never be echoed back into a message.
    expect(source).not.toMatch(/\$\{newPin\}/);
    // 8c: a member-facing count, not a cycle week number.
    expect(source).not.toMatch(/Saved — week/);
  });

  it("carries the server's own reason on a refusal (beat 4)", () => {
    expect(source).toContain("Not saved: ${result.error}");
    // The hand-rolled error paragraph and its state are gone.
    expect(source).not.toContain("setNewPinError");
  });

  it("does not mirror the message into state through an effect", () => {
    // An effect has not run at first paint, so the confirmation would be
    // absent from the markup exactly when it is needed.
    //
    // NARROWED FROM "no useEffect anywhere". That blanket ban was right while
    // this file had no legitimate effect, and it stopped being right when the
    // resend countdown arrived — a once-per-second interval is exactly what an
    // effect is for, and it has nothing to do with the save message. What the
    // lesson actually forbids is DERIVING the message from state in an effect,
    // so that is what is asserted now.
    const effects = source.split("useEffect(").slice(1);
    for (const body of effects) {
      const head = body.slice(0, body.indexOf("}, ["));
      expect(head, "an effect must not set the save message").not.toContain("setPinSave");
      expect(head, "an effect must not set the save message").not.toContain("setNewPinError");
    }
    // The message is still derived at render, not stored.
    expect(source).not.toContain("useEffect(() => setPinSave");
  });
});

describe("signing in is NOT a save — exempt, but still owed the reason", () => {
  it("uses SaveButton exactly once, on the one thing that is a save", () => {
    expect(source.match(/<SaveButton/g)).toHaveLength(1);
  });

  // Rule 6b. Each of these refusals used to render ABOVE its button, so the
  // button jumped down out from under the thumb at the moment the alert
  // appeared. The reason now sits under the control that was pressed.
  it("puts the phone-lookup refusal under the Continue button", () => {
    expect(precedes('{phonePending ? "Looking up…" : "Continue"}', "{phoneError && <ErrorMsg")).toBe(
      true,
    );
  });

  it("puts the PIN refusal under the Sign in button, not above the pad", () => {
    expect(precedes('{verifying ? "Signing in…" : "Sign in"}', "{pinError && (")).toBe(true);
  });

  it("puts the WhatsApp-code refusal under the button that was pressed", () => {
    expect(
      precedes('{otpStep === "verifying" ? "Checking…" : "Sign in"}', "{otpError && <ErrorMsg"),
    ).toBe(true);
  });

  it("puts the SMS refusal under the button that was pressed", () => {
    expect(
      precedes('{smsStep === "verifying" ? "Checking…" : "Sign in"}', "{smsError && <ErrorMsg"),
    ).toBe(true);
  });

  it("still announces every refusal to a screen reader", () => {
    // ErrorMsg is role="alert"; the PIN pad's own line carries its own.
    expect(source.match(/role="alert"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
