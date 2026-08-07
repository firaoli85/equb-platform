// VERBATIM PORT of equb-app/src/lib/firebase.ts — the build that successfully
// sends SMS on localhost against this same Firebase project.
//
// Three real causes were found and fixed before this port (Referrer-Policy
// stripping reCAPTCHA's Referer, connect-src blocking api2/clr, frame-src
// missing recaptcha.google.com) and auth/invalid-app-credential survived all
// three. So this file no longer tries to be a better version of the one that
// works: the initialisation expression, its position in the module, and the
// export shape are now character-for-character what the working app does.
//
// WHAT WAS DELIBERATELY UNDONE HERE, and why each could plausibly matter:
//
//   * "use client" — REMOVED. The working file does not carry it. A "use
//     client" module is a client-graph ENTRY POINT, which is a different thing
//     from a module that merely ends up in the client graph because a client
//     component imported it. That distinction can change when the module is
//     evaluated, and evaluation timing is precisely what decides whether
//     Firebase is ready before RecaptchaVerifier is constructed. It is only
//     imported by components/member/login-flow.tsx, which is itself
//     "use client", so the module still lands in the browser bundle.
//
//   * CONDITIONAL initialisation — REMOVED. This file used to call
//     initializeApp only when firebaseClientConfigured() was true, and export
//     a firebaseAuth() accessor returning Auth | null. That made app creation
//     depend on a predicate the working app does not have. Now initializeApp
//     runs unconditionally at module load, exactly as it does there.
//
// SCOPE (2.28) is unchanged: Firebase is used for LOGIN CODES ONLY. It cannot
// send our own messages — reminders, statements and winner announcements all
// stay on WhatsApp/Twilio. A login code is Google's message, not ours.

import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

// NEXT_PUBLIC_ values are inlined at BUILD time. Writing them into .env.local
// while the dev server is running does NOT put them in the browser bundle —
// the server must be restarted. Each is read as a whole literal for that
// reason: Next can only substitute the full `process.env.NEXT_PUBLIC_X`
// expression, never a computed key.
const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);

// ————————————————————————————————————————————————————————————————
// Everything below is DIAGNOSTIC ONLY. None of it participates in creating
// the app or the Auth instance above, and none of it runs before them.
// ————————————————————————————————————————————————————————————————

/** The single DOM node the reCAPTCHA widget mounts into. */
export const RECAPTCHA_CONTAINER_ID = "recaptcha-container";

/**
 * Which public Firebase values did NOT reach the browser bundle. Named so a
 * failure can say WHICH one is missing instead of "not available" — the
 * original silent failure this whole area exists to prevent.
 */
export function firebaseMissingClientConfig(): string[] {
  return (
    [
      ["NEXT_PUBLIC_FIREBASE_API_KEY", firebaseConfig.apiKey],
      ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", firebaseConfig.authDomain],
      ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
      ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", firebaseConfig.messagingSenderId],
      ["NEXT_PUBLIC_FIREBASE_APP_ID", firebaseConfig.appId],
    ] as const
  )
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
}

/** True when every public Firebase value reached the browser bundle. */
export function firebaseClientConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}
