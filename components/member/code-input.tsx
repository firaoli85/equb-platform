"use client";

import { useEffect, useRef } from "react";
import {
  backspaceAt,
  CODE_LENGTH,
  moveFocus,
  normalise,
  shouldAutoSubmit,
  typeAt,
} from "@/lib/code-entry";

// SIX BOXES, ONE CODE.
//
// This replaced a single bare text field on the WhatsApp code screen — the
// first surface a member touches and the least finished one in the product.
// A member reading a six-digit code off WhatsApp and typing it into one long
// box has to check their own place; six boxes hold the place for them.
//
// WHY A COMPONENT AND NOT MARKUP IN THE SCREEN. The behaviours below are the
// whole point and every one of them is a real failure if it is missing —
// paste, backspace, arrows, auto-submit, digits-only. They are testable here
// and they are not testable inlined in a 1,000-line login flow.
//
// ACCESSIBILITY. The six inputs sit in one `role="group"` with a single label,
// so a screen reader announces "Verification code" once rather than six
// unlabelled boxes. Each box carries its own position label for when a user
// lands on one directly.

const LENGTH = CODE_LENGTH;

export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  label = "Verification code",
  /** Bumped by the caller to pull focus back to the first box after an error. */
  focusToken = 0,
}: {
  /** The digits entered so far, "" to "123456". The caller owns this. */
  value: string;
  onChange: (next: string) => void;
  /** Fired once when the sixth digit lands — the auto-submit. */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  label?: string;
  focusToken?: number;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  // Guards the auto-submit against firing twice for one completion — React
  // re-renders freely, and a double submit here is a double check against
  // Twilio, which consumes one of the verification's limited attempts.
  const firedFor = useRef<string | null>(null);

  const digits = normalise(value);

  useEffect(() => {
    if (shouldAutoSubmit(digits, firedFor.current)) {
      firedFor.current = digits;
      onComplete?.(digits);
      return;
    }
    // Re-arm once the code is no longer complete, so a corrected code
    // submits again.
    if (digits.length < LENGTH) firedFor.current = null;
  }, [digits, onComplete]);

  // An error clears the boxes and puts the cursor back in the first one, so a
  // member can retype immediately instead of hunting for where to click.
  useEffect(() => {
    if (focusToken > 0) boxes.current[0]?.focus();
  }, [focusToken]);

  function apply(next: { value: string; focus: number }) {
    onChange(next.value);
    boxes.current[next.focus]?.focus();
  }

  function handleChange(index: number, raw: string) {
    apply(typeAt(digits, index, raw));
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      apply(backspaceAt(digits, index));
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      boxes.current[moveFocus(index, e.key === "ArrowLeft" ? "left" : "right")]?.focus();
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    // A paste with no digits in it at all is left to the browser — there is
    // nothing to fill, and swallowing it would make the field feel dead.
    if (!normalise(pasted)) return;
    e.preventDefault();
    apply(typeAt(digits, index, pasted));
  }

  return (
    <div
      role="group"
      aria-label={label}
      data-testid="code-input"
      className="flex justify-center gap-2"
    >
      {Array.from({ length: LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // Only the first box carries this: the browser fills the whole value
          // into it, and `handleChange` spreads it across all six.
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={digits[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          style={{ touchAction: "manipulation" }}
          // The portal's own vocabulary: rounded-xl, the same indigo focus
          // ring and border treatment as every other member input.
          className="h-14 w-11 rounded-xl border border-gray-200 bg-white text-center font-mono text-2xl font-bold tabular-nums text-gray-900 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50 dark:border-gray-700 dark:bg-[#1a1a1a] dark:text-white dark:focus:border-indigo-600"
        />
      ))}
    </div>
  );
}
