// Phone handling for member sign-in. The directory stores numbers in
// whatever form the organizer typed; members type (or autofill) formatted
// numbers. ONE canonical normalisation (audit H1): matching and OTP sending
// both go through canonicalPhone, so the number a code is SENT to can never
// differ from the number that MATCHED. (The old split let "+2405550187"
// match a member stored as "+1 240 555 0187" while the code went to country
// code +240 — an attacker's phone abroad.)

/** Just the digits — "(240) 555-0000" and "+1 240-555-0000" both compare equal. */
export function phoneDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * THE canonical E.164 form this platform uses everywhere. Digits are the
 * only thing trusted — a "+" prefix is ignored, because trusting it is what
 * let matching and sending disagree:
 *   - 10 digits            → US: +1XXXXXXXXXX (even if written "+XXXXXXXXXX")
 *   - 11 digits starting 1 → +1XXXXXXXXXX
 *   - anything else        → "+" + digits (true international numbers)
 * Returns null when there are no digits at all.
 */
export function canonicalPhone(input: string): string | null {
  const digits = phoneDigits(input);
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Two phones refer to the same line when their CANONICAL forms are equal —
 * the same function the sender uses, so lookup, sign-in, and delivery can
 * never disagree about whose number this is.
 */
export function samePhone(a: string, b: string): boolean {
  const ca = canonicalPhone(a);
  const cb = canonicalPhone(b);
  return ca !== null && cb !== null && ca === cb;
}

/**
 * E.164 for the OTP/WhatsApp senders — the canonical form, nothing else.
 * Empty input falls back to "+" so provider calls fail loudly rather than
 * silently targeting a wrong number.
 */
export function toE164(input: string): string {
  return canonicalPhone(input) ?? "+";
}
