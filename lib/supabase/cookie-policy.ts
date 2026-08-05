// Session cookie policy (audit H2), enforced at EVERY place a session cookie
// is written. Both sign-in paths — member (PIN / WhatsApp code) and organizer
// (signInAdmin) — run in server actions, so every write goes through the
// server client or the proxy and no library default can widen it. Signing in
// from the BROWSER is what this fix removed: a cookie written by JavaScript
// can never be httpOnly (see lib/supabase/client.ts).
//
// 30 days replaces @supabase/ssr's 400-day default. Two honest caveats:
//   - It is a SLIDING window, not an absolute cap: every proxy refresh writes
//     a fresh 30 days, so an actively used session does not expire on a
//     schedule. Bounding total session age needs Supabase-side refresh-token
//     expiry, not a cookie attribute.
//   - It bounds only how long the BROWSER keeps the cookie. The refresh
//     token's real validity is set in the Supabase project, not here.

import type { CookieOptions } from "@supabase/ssr";

export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Clamp any cookie the auth layer writes: httpOnly (nothing client-side
 * reads the session — sign-in flows mint it server-side), secure in
 * production, sameSite lax, and never longer-lived than the chosen expiry.
 * Deletions (maxAge 0) pass through untouched.
 */
export function hardenSessionCookie(options?: CookieOptions): CookieOptions {
  // Carry any option the library sets that we do not have an opinion on
  // (domain, priority, partitioned…), then clamp the ones that matter.
  const hardened: CookieOptions = { ...options };
  // maxAge alone decides the lifetime — an absolute `expires` from the
  // library would otherwise override the clamp below.
  delete hardened.expires;
  hardened.httpOnly = true;
  hardened.secure = process.env.NODE_ENV === "production";
  hardened.sameSite = "lax";
  hardened.path = hardened.path ?? "/";
  hardened.maxAge = Math.min(
    hardened.maxAge ?? SESSION_COOKIE_MAX_AGE_SECONDS,
    SESSION_COOKIE_MAX_AGE_SECONDS,
  );
  return hardened;
}
