"use client";

// The browser half of SMS login — Firebase Phone Auth, ported from the
// previous build (equb-app/src/lib/firebase.ts), which worked and needed no
// carrier A2P registration.
//
// SCOPE (2.28): Firebase is used for LOGIN CODES ONLY. It cannot send our own
// messages — reminders, statements, winner announcements all stay on
// WhatsApp/Twilio. The SMS ruling was about sending our own content; a login
// code is Google's message, not ours.
//
// Initialised LAZILY so a missing config never crashes the login page: the
// server tells the client whether SMS is available, and this is only reached
// when it is.

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/** The single DOM node the reCAPTCHA widget mounts into. */
export const RECAPTCHA_CONTAINER_ID = "recaptcha-container";

// NEXT_PUBLIC_ values are inlined at BUILD time. Writing them into .env.local
// while the dev server is running does NOT put them in the browser bundle —
// the server must be restarted. That is why each one is read as a whole
// literal here rather than through a computed key: Next can only substitute
// the full `process.env.NEXT_PUBLIC_X` expression.
function config() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

/**
 * Which public Firebase values did NOT reach the browser bundle. Named so a
 * failure can say WHICH one is missing instead of "not available".
 */
export function firebaseMissingClientConfig(): string[] {
  const c = config();
  return (
    [
      ["NEXT_PUBLIC_FIREBASE_API_KEY", c.apiKey],
      ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", c.authDomain],
      ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", c.projectId],
      ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", c.messagingSenderId],
      ["NEXT_PUBLIC_FIREBASE_APP_ID", c.appId],
    ] as const
  )
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
}

/** True when every public Firebase value reached the browser bundle. */
export function firebaseClientConfigured(): boolean {
  const c = config();
  return Boolean(c.apiKey && c.authDomain && c.projectId && c.appId);
}

let cachedApp: FirebaseApp | null = null;

/** The Firebase Auth instance, or null when SMS login is not configured. */
export function firebaseAuth(): Auth | null {
  if (!firebaseClientConfigured()) return null;
  if (!cachedApp) {
    cachedApp = getApps().length === 0 ? initializeApp(config()) : getApps()[0];
  }
  return getAuth(cachedApp);
}
