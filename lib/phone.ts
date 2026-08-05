// Phone handling for member sign-in. The directory stores numbers in
// whatever form the organizer typed; members type (or autofill) formatted
// numbers. Matching happens on DIGITS, and Supabase OTP needs E.164 — both
// live here so lookup and PIN sign-in can never disagree.

/** Just the digits — "(240) 555-0000" and "+1 240-555-0000" both compare equal. */
export function phoneDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Two phones refer to the same line when their digits match, ignoring a
 * leading US country code on either side ("12405550000" ≡ "2405550000").
 */
export function samePhone(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (da.length === 0 || db.length === 0) return false;
  const strip = (d: string) => (d.length === 11 && d.startsWith("1") ? d.slice(1) : d);
  return strip(da) === strip(db);
}

/**
 * Best-effort E.164 for Supabase OTP: keep an explicit +CC, assume US for
 * bare 10-digit numbers, pass anything else through with a plus.
 */
export function toE164(input: string): string {
  const digits = phoneDigits(input);
  if (input.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}
