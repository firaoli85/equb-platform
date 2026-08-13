// THE SIX-BOX CODE ENTRY, AS PURE TRANSITIONS.
//
// Every behaviour that matters here is a state transition — a digit typed, a
// paste landing, a backspace at an empty box — and each one is a real defect
// if it is wrong. They live outside the component so they can be proven
// without a DOM: this repo has no jsdom and no testing-library, and adding a
// browser environment to test six input boxes is a large dependency for a
// small surface.
//
// components/member/code-input.tsx is a thin shell over these.

export const CODE_LENGTH = 6;

/** Only digits, never longer than the code. The single normalisation. */
export function normalise(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export type Entry = {
  /** The digits held so far. */
  value: string;
  /** Where the cursor should be, 0-indexed. */
  focus: number;
};

/**
 * A digit (or a multi-character paste) typed into `index`.
 *
 * A PASTE INTO ANY BOX FILLS ALL SIX. A member reads the code off WhatsApp and
 * copies it; a paste that drops one digit into box 3 and discards the rest is
 * the most irritating possible outcome, and it is what a naive maxLength=1
 * input does.
 *
 * NON-DIGITS ARE REJECTED HERE — on input, not at submit. Being told after
 * pressing the button that a character was not allowed is a wasted round trip.
 */
export function typeAt(current: string, index: number, raw: string): Entry {
  const cleaned = raw.replace(/\D/g, "");
  const value = normalise(current);
  if (cleaned === "") {
    // Rejected, and the cursor does not move — nothing happened.
    return { value, focus: index };
  }
  if (cleaned.length > 1) {
    const filled = normalise(value.slice(0, index) + cleaned);
    return { value: filled, focus: Math.min(filled.length, CODE_LENGTH - 1) };
  }
  const next = value.padEnd(CODE_LENGTH, " ").split("");
  next[index] = cleaned;
  return {
    value: normalise(next.join("").replace(/\s/g, "")),
    focus: Math.min(index + 1, CODE_LENGTH - 1),
  };
}

/**
 * Backspace at `index`.
 *
 * ON AN EMPTY BOX IT GOES BACK AND DELETES. Without that, a member correcting
 * a wrong digit presses backspace at an already-empty box and nothing happens
 * — the code appears stuck, and the only way out is to click.
 */
export function backspaceAt(current: string, index: number): Entry {
  const value = normalise(current);
  const chars = value.split("");
  if (chars[index] !== undefined) {
    chars.splice(index, 1);
    return { value: chars.join(""), focus: index };
  }
  if (index > 0) {
    chars.splice(index - 1, 1);
    return { value: chars.join(""), focus: index - 1 };
  }
  return { value, focus: 0 };
}

/** Arrow-key movement, clamped to the boxes that exist. */
export function moveFocus(index: number, direction: "left" | "right"): number {
  const next = direction === "left" ? index - 1 : index + 1;
  return Math.max(0, Math.min(CODE_LENGTH - 1, next));
}

/**
 * Should the code submit itself now?
 *
 * AUTO-SUBMIT MUST FIRE EXACTLY ONCE per completed code. React re-renders
 * freely, and a second submit is a second VerificationCheck against Twilio —
 * which spends one of the verification's limited attempts and can expire a
 * perfectly good code. `lastFired` is what the caller last submitted.
 */
export function shouldAutoSubmit(value: string, lastFired: string | null): boolean {
  const digits = normalise(value);
  return digits.length === CODE_LENGTH && digits !== lastFired;
}

/** Is the code complete enough to submit by hand? */
export function isComplete(value: string): boolean {
  return normalise(value).length === CODE_LENGTH;
}
