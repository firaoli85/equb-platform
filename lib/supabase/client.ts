"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client — carries only the publishable key.
 *
 * DO NOT USE THIS TO SIGN ANYONE IN (audit H2). createBrowserClient persists
 * the session with `document.cookie`, and a cookie written by JavaScript can
 * never be httpOnly — so any script on the page could read the session. Both
 * sign-in paths now run in server actions (app/actions/auth.ts: signInAdmin,
 * signInWithPin, signInWithWhatsAppCode), where the cookie goes through
 * lib/supabase/cookie-policy.ts instead.
 *
 * Nothing imports this today. It is kept only for a future browser-side READ
 * that needs the anon key; if you reach for it for auth, you are re-opening a
 * fixed vulnerability.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
