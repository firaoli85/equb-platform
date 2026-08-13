import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  backspaceAt,
  CODE_LENGTH,
  isComplete,
  moveFocus,
  normalise,
  shouldAutoSubmit,
  typeAt,
} from "./code-entry";
import {
  formatCountdown,
  RESEND_COOLDOWN_SECONDS,
  resendBypassesCooldown,
  resendIsTheRemedy,
  resendState,
} from "./resend-countdown";
import { CodeInput } from "@/components/member/code-input";

// THE CODE-ENTRY SCREEN, WHICH A MEMBER TOUCHES BEFORE ANYTHING ELSE.
//
// It was a single bare text field with a Sign in button and no way to ask for
// the code again. Every behaviour below is one a member actually performs —
// pasting the code they just copied, backspacing a wrong digit, waiting for a
// message that has not arrived — and each was missing.
//
// The transitions are pure so they can be proven without a DOM: this repo has
// no jsdom and no testing-library, and a browser environment for six input
// boxes is a large dependency for a small surface.

describe("pasting the code you just copied", () => {
  it("a 6-digit paste into BOX 3 fills all six", () => {
    // The exact case: a member copies "756366" out of WhatsApp and pastes it
    // wherever the cursor happens to be. A naive maxLength=1 input keeps one
    // character and drops five.
    const result = typeAt("", 2, "756366");
    expect(result.value).toBe("756366");
    expect(isComplete(result.value)).toBe(true);
  });

  it("a paste into box 0 fills all six", () => {
    expect(typeAt("", 0, "756366").value).toBe("756366");
  });

  it("a paste with spaces or dashes still fills correctly", () => {
    expect(typeAt("", 0, "756 366").value).toBe("756366");
    expect(typeAt("", 0, "756-366").value).toBe("756366");
  });

  it("a paste longer than six is truncated, never overflowed", () => {
    expect(typeAt("", 0, "7563661234").value).toBe("756366");
    expect(typeAt("", 0, "7563661234").value.length).toBe(CODE_LENGTH);
  });

  it("leaves the cursor on the last filled box", () => {
    expect(typeAt("", 0, "756366").focus).toBe(CODE_LENGTH - 1);
    expect(typeAt("", 0, "756").focus).toBe(3);
  });
});

describe("typing digit by digit", () => {
  it("each digit advances the cursor", () => {
    let value = "";
    let focus = 0;
    for (const d of "756366") {
      const step = typeAt(value, focus, d);
      value = step.value;
      focus = step.focus;
    }
    expect(value).toBe("756366");
  });

  it("REJECTS a non-digit on input, and does not move the cursor", () => {
    // Rejected as it is typed, not reported after submit.
    const result = typeAt("75", 2, "a");
    expect(result.value).toBe("75");
    expect(result.focus).toBe(2);
  });

  it("rejects letters, punctuation and whitespace alike", () => {
    for (const bad of ["a", "Z", "!", " ", "-", "+"]) {
      expect(typeAt("75", 2, bad).value, bad).toBe("75");
    }
  });

  it("never grows past six digits", () => {
    expect(typeAt("756366", 5, "9").value.length).toBeLessThanOrEqual(CODE_LENGTH);
  });
});

describe("backspace navigation", () => {
  it("on a FILLED box, clears it and stays put", () => {
    const result = backspaceAt("756366", 5);
    expect(result.value).toBe("75636");
    expect(result.focus).toBe(5);
  });

  it("on an EMPTY box, steps BACK and deletes the previous digit", () => {
    // Without this a member correcting a digit presses backspace at an empty
    // box and nothing happens — the field looks broken.
    const result = backspaceAt("756", 3);
    expect(result.value).toBe("75");
    expect(result.focus).toBe(2);
  });

  it("at box 0 with nothing to delete, does nothing", () => {
    const result = backspaceAt("", 0);
    expect(result.value).toBe("");
    expect(result.focus).toBe(0);
  });
});

describe("arrow keys", () => {
  it("move within the boxes and clamp at both ends", () => {
    expect(moveFocus(2, "left")).toBe(1);
    expect(moveFocus(2, "right")).toBe(3);
    expect(moveFocus(0, "left")).toBe(0);
    expect(moveFocus(CODE_LENGTH - 1, "right")).toBe(CODE_LENGTH - 1);
  });
});

describe("auto-submit fires EXACTLY once", () => {
  // A second submit is a second VerificationCheck against Twilio, which spends
  // one of the verification's limited attempts and can kill a good code.
  it("fires when the sixth digit lands", () => {
    expect(shouldAutoSubmit("756366", null)).toBe(true);
  });

  it("does NOT fire again for the same code", () => {
    expect(shouldAutoSubmit("756366", "756366")).toBe(false);
  });

  it("does not fire on five digits", () => {
    expect(shouldAutoSubmit("75636", null)).toBe(false);
  });

  it("RE-ARMS for a corrected code", () => {
    // Wrong code submitted, member retypes a different one — that must submit.
    expect(shouldAutoSubmit("111111", "756366")).toBe(true);
  });
});

describe("the resend control", () => {
  it("is disabled during the cooldown, showing the time left", () => {
    const state = resendState({ secondsLeft: 32, sending: false });
    expect(state.enabled).toBe(false);
    expect(state.label).toBe("Send it again in 0:32");
  });

  it("becomes enabled at zero", () => {
    const state = resendState({ secondsLeft: 0, sending: false });
    expect(state.enabled).toBe(true);
    expect(state.label).toBe("Send it again");
  });

  it("shows a pending state while sending — not a dead button", () => {
    const state = resendState({ secondsLeft: 0, sending: true });
    expect(state.enabled).toBe(false);
    expect(state.label).toBe("Sending…");
  });

  it("counts down through the whole cooldown without a malformed label", () => {
    for (let s = RESEND_COOLDOWN_SECONDS; s > 0; s--) {
      const state = resendState({ secondsLeft: s, sending: false });
      expect(state.label, `at ${s}s`).toMatch(/^Send it again in \d:\d\d$/);
    }
  });

  it("formats the clock correctly at the boundaries", () => {
    expect(formatCountdown(45)).toBe("0:45");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  // THE WORDING, WHICH AN EARLIER FINDING SETTLED. Inside Twilio's 10-minute
  // window a re-request RE-SENDS THE SAME CODE — two requests six minutes
  // apart shared one verification SID in Twilio's own attempt log. A member
  // promised a "new code" who receives the digits they already have concludes
  // the system is broken.
  it("NEVER promises a new code", () => {
    const labels = [
      resendState({ secondsLeft: 0, sending: false }).label,
      resendState({ secondsLeft: 30, sending: false }).label,
      resendState({ secondsLeft: 0, sending: true }).label,
    ];
    for (const label of labels) {
      expect(label.toLowerCase(), label).not.toContain("new code");
      expect(label.toLowerCase(), label).not.toContain("new one");
    }
    expect(labels[0]).toBe("Send it again");
  });
});

describe("the error must offer what it names", () => {
  it("no-verification: resend IS the remedy, and it bypasses the countdown", () => {
    // The previous code is definitively gone, so making them wait 45 seconds
    // for a code that cannot work is pointless.
    expect(resendIsTheRemedy("no-verification")).toBe(true);
    expect(resendBypassesCooldown("no-verification")).toBe(true);
    expect(
      resendState({ secondsLeft: 40, sending: false, bypassCooldown: true }).enabled,
    ).toBe(true);
  });

  it("rate-limited: resend is the remedy, but the countdown STANDS", () => {
    // Twilio is telling us to slow down; ignoring that is how it gets worse.
    expect(resendIsTheRemedy("rate-limited")).toBe(true);
    expect(resendBypassesCooldown("rate-limited")).toBe(false);
  });

  it("unavailable: resend is NOT offered as the remedy", () => {
    // Our outage, our credentials, our config. Resending cannot fix any of
    // them, and offering it sends a member round a loop that cannot work.
    expect(resendIsTheRemedy("unavailable")).toBe(false);
    expect(resendBypassesCooldown("unavailable")).toBe(false);
  });

  it("wrong-code: no resend needed — the code they hold is still live", () => {
    expect(resendIsTheRemedy("wrong-code")).toBe(false);
  });

  it("an outcome-less refusal offers no remedy rather than the wrong one", () => {
    expect(resendIsTheRemedy(null)).toBe(false);
    expect(resendBypassesCooldown(null)).toBe(false);
  });
});

describe("the rendered input", () => {
  const html = renderToStaticMarkup(<CodeInput value="75" onChange={() => {}} />);

  it("renders six boxes", () => {
    expect(html.match(/<input/g) ?? []).toHaveLength(CODE_LENGTH);
  });

  it("carries ONE group label, not six unlabelled fields", () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Verification code"');
    // Each box still names its position for anyone landing on it directly.
    expect(html).toContain('aria-label="Digit 1 of 6"');
    expect(html).toContain('aria-label="Digit 6 of 6"');
  });

  it("is numeric-only to the browser and the keyboard", () => {
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('pattern="[0-9]*"');
    // one-time-code on the FIRST box only: the browser fills the whole value
    // there and typeAt spreads it across all six.
    expect((html.match(/autoComplete="one-time-code"/g) ?? []).length).toBe(1);
  });

  it("shows the digits it was given and leaves the rest empty", () => {
    expect(html).toContain('value="7"');
    expect(html).toContain('value="5"');
  });

  it("normalises a dirty value rather than rendering it", () => {
    const dirty = renderToStaticMarkup(<CodeInput value="7a5!" onChange={() => {}} />);
    expect(dirty).not.toContain('value="a"');
    expect(dirty).not.toContain('value="!"');
  });
});

describe("GUARD — the screen cannot double-submit a check", () => {
  const source = readFileSync("components/member/login-flow.tsx", "utf8");

  it("verifyOtp refuses to run while a check is in flight", () => {
    const fn = source.slice(source.indexOf("async function verifyOtp("));
    // Auto-submit fires from the sixth digit AND the Sign in button stays
    // pressable, so both routes land in verifyOtp. This is the one guard
    // between them and two VerificationChecks for one code.
    expect(fn).toContain('otpStep === "verifying"');
    expect(fn.indexOf('otpStep === "verifying"')).toBeLessThan(fn.indexOf("signInWithWhatsAppCode"));
  });

  it("the boxes are locked while the check runs", () => {
    expect(source).toContain('disabled={otpStep === "verifying"}');
  });

  it("an error clears the boxes and pulls focus back to the first", () => {
    expect(source).toContain('setOtpCode("")');
    expect(source).toContain("setOtpFocusToken((n) => n + 1)");
  });
});
