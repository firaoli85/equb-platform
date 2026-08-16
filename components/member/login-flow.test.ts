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

/** Source with comments stripped — a guard must not trip on its own prose. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Source with whitespace flattened — for text JSX wraps across lines. */
const flat = source.replace(/\s+/g, " ");

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

// RECOVERY IS WHATSAPP, FULL STOP (organizer ruling, Aug 2026 — found from a
// live screenshot: "Forgot your PIN? Get a WhatsApp code" landed on the
// Firebase SMS screen, which fails with auth/invalid-app-credential, §6.1).
describe("forgot-PIN routes to WhatsApp directly — never the parked SMS channel", () => {
  const recovery = source.slice(
    source.indexOf("function startPinRecovery"),
    source.indexOf("function submitPin"),
  );

  // FALSIFIABLE: restore the SMS-preferring helper and both halves fail.
  it("the recovery handler sends the WhatsApp code itself, with no SMS branch", () => {
    expect(recovery).toContain('setChoice("otp")');
    expect(recovery).toContain("sendOtp(lookup)");
    expect(recovery).not.toContain("sendSms");
    expect(recovery).not.toContain("smsAvailable");
    // The SMS-preferring helper is DELETED, not bypassed — a dead function
    // that prefers a broken channel is one refactor from being called again.
    expect(source).not.toContain("function startCodeChannel");
  });

  // The screen the member lands on is the one the button promised: the
  // WhatsApp step's wording, not the text-message step's.
  it("the button's promise and the destination agree", () => {
    expect(source).toContain("Forgot your PIN? Get a WhatsApp code");
    // choice "otp" renders the WhatsApp step (its heading text), and the SMS
    // step's wording belongs to choice "sms" alone.
    expect(source).toContain('"WhatsApp code"');
    const smsStep = source.slice(source.indexOf('step === "sms"'));
    expect(smsStep).toContain("Text-message code");
    expect(recovery).not.toContain('setChoice("sms")');
  });

  // SUPERSEDED 16 Aug 2026. This test used to read "SMS stays on the general
  // picker, honestly labelled as maybe unavailable" and asserted the label
  // "may not be available yet". §2.28 does not permit a hedged label in place
  // of a working channel: production returns "The reCAPTCHA check failed", so
  // the door is closed at the lookup instead.
  //
  // The two halves are asserted apart on purpose — the door and the code are
  // now separate facts, and the whole point of the change is that closing one
  // did not delete the other.
  it("the SMS door is closed at the lookup, so the picker cannot offer it", () => {
    const lookup = readFileSync(
      join(import.meta.dirname, "..", "..", "app/actions/member.ts"),
      "utf8",
    );
    expect(lookup).toContain("const SMS_LOGIN_OFFERED: boolean = false;");
    expect(lookup).toContain("smsAvailable: SMS_LOGIN_OFFERED && firebaseConfigured()");
    // The button and the no-methods fallback both key off this one value, so
    // a closed door cannot leave the picker empty AND silent.
    expect(source).toContain("lookup.smsAvailable && (");
    expect(source).toContain(
      "!lookup.pinAvailable && !lookup.smsAvailable && !lookup.whatsAppAvailable",
    );
  });

  it("the SMS implementation is PARKED, not deleted — §6.1 retests it after deploy", () => {
    // If any of these vanish, the channel can no longer be retested by
    // flipping one flag, which is the entire basis for closing the door
    // rather than removing the feature.
    expect(source).toContain('step === "sms"');
    expect(source).toContain("Text me a code");
    expect(source).toContain("signInWithFirebaseSms");
    expect(source).toContain("RecaptchaVerifier");
  });
});

// THE FORCED FIRST-LOGIN PIN CHANGE (organizer ruling, 16 August 2026).
//
// The default PIN is the last 4 digits of the number the caller just typed, so
// it authenticates nobody. Before this ruling the "set your own PIN" step was
// skippable on every path, and every member in the group was still on the
// default. These guards hold the two halves apart: a wall after the default, an
// ask after a code.
describe("forced PIN change after a default sign-in", () => {
  it("hides the skip when the member arrived on the phone-digit default", () => {
    expect(source).toContain("{!usedDefault && (");
    // The skip must be INSIDE that guard, not merely near it.
    const guarded = source.slice(source.indexOf("{!usedDefault && ("));
    const closes = guarded.indexOf("Skip for now");
    expect(closes).toBeGreaterThan(-1);
    // Nothing else may re-open the door before the button.
    expect(guarded.slice(0, closes)).not.toContain("goToPortal()");
  });

  it("KEEPS the skip for a member who proved identity with a code", () => {
    // `recovering` reaches setpin without `usedDefault`, so the guard above
    // leaves the button rendered. A wall here would strand the member who came
    // BECAUSE they could not get in.
    expect(source).toContain("Skip for now");
    expect(source).toMatch(/recovering \|\| usedDefault/);
  });

  it("states the default PIN on the sign-in screen, for every first-timer", () => {
    expect(source).toContain(
      "First time signing in? Your PIN is the last 4 digits of your phone number.",
    );
    expect(flat).toContain("You will choose your own PIN after you sign in.");
  });

  // AUDIT C2: the hint that once lived here was driven by `hasOwnPin` and so
  // told an unauthenticated caller who was still on the default. The new
  // sentence is identical for every caller and must never become conditional.
  it("the new instruction is unconditional — it cannot leak who is on the default", () => {
    // Comments stripped first: this file's own comment DISCUSSES the C2 hint
    // by name, and a guard that trips on its own explanation is worthless.
    const i = code.indexOf("First time signing in?");
    expect(i).toBeGreaterThan(-1);
    const before = code.slice(Math.max(0, i - 400), i);
    expect(before).not.toContain("hasOwnPin");
    expect(before).not.toContain("pinState");
    // Nor is it wrapped in any conditional of its own.
    expect(before).not.toContain("&&");
  });

  it("no comment still claims the step is never forced", () => {
    expect(source).not.toContain("ALWAYS skippable");
    expect(source).not.toContain("never forced");
    expect(source).not.toContain("takes no for an\n                  answer");
    expect(source).not.toContain("INVITATION to set their own PIN");
  });
});
