// PROVING A WEBHOOK REALLY CAME FROM TWILIO.
//
// The status callback is a PUBLIC endpoint. Anyone who learns the URL can POST
// to it, and what it does is rewrite MessageLog — the organizer's record of
// what was said to whom. Unsigned, it would let a stranger mark a failed
// message as delivered, or a delivered one as failed, for any member.
//
// Twilio's scheme (X-Twilio-Signature): concatenate the full request URL with
// every POST parameter, sorted by key, as key+value with no separators; sign
// that with the account auth token using HMAC-SHA1; base64 the result.
//
//   signature = base64(hmac_sha1(authToken, url + k1 + v1 + k2 + v2 + ...))
//
// The token is the shared secret, which is why this can only run on the
// server. Kept in its own leaf module so it is unit-testable without standing
// up a route.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The exact string Twilio signs: the URL, then each parameter's key and value
 * concatenated in key order.
 *
 * Sorting is on the KEY only, and Twilio sorts the raw parameter names — this
 * must not be "clever" about it, because any difference produces a signature
 * that will not match and a webhook that rejects every genuine call.
 */
export function signatureBase(url: string, params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
}

/** The signature Twilio would have sent for this request. */
export function expectedSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  return createHmac("sha1", authToken).update(signatureBase(url, params), "utf8").digest("base64");
}

/**
 * Does this request carry a valid Twilio signature?
 *
 * MISSING IS NOT VALID. An absent or empty header returns false rather than
 * being waved through — "no signature" is the shape an attacker's request
 * takes, and a webhook that only checks signatures when one is present checks
 * nothing at all.
 *
 * Compared with `timingSafeEqual` so the check cannot be probed byte by byte.
 * Lengths are compared first because timingSafeEqual throws on a mismatch,
 * and a throw here would be an unhandled 500 on a public endpoint.
 */
export function verifyTwilioSignature(input: {
  authToken: string;
  /** The FULL public URL Twilio posted to, including query string. */
  url: string;
  params: Record<string, string>;
  /** The X-Twilio-Signature header, or null when absent. */
  signature: string | null | undefined;
}): boolean {
  const provided = input.signature?.trim();
  if (!provided) return false;
  if (!input.authToken.trim()) return false;

  const expected = expectedSignature(input.authToken, input.url, input.params);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
