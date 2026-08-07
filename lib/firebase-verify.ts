// SERVER-side proof that a Firebase SMS code was actually passed.
//
// WHY THIS FILE EXISTS AT ALL. The previous build's SMS route
// (equb-app/src/app/api/auth/firebase-otp/route.ts) took ONLY a phone number
// from the request body and minted a session from it — no proof of any kind
// that Firebase had verified anything. Anyone who knew a member's number
// could POST it and be signed in as them. That endpoint is not being ported.
//
// Here the client sends the Firebase ID TOKEN it receives after
// confirmationResult.confirm(code). The token is checked against Google —
// which validates its signature, audience, and expiry — and the phone_number
// claim on the verified account is what we trust. A caller who has not
// passed the SMS code cannot produce such a token.
//
// Google's identitytoolkit `accounts:lookup` is used rather than pulling in
// firebase-admin: it is one authenticated call, it needs no service-account
// private key on the server, and the API key is project-scoped so a token
// minted for a different Firebase project cannot pass.

const LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

/** The public Firebase config, read from env. NEXT_PUBLIC_ by necessity —
 *  the browser SDK needs the same values. None of them are secrets. */
export const FIREBASE_ENV_VARS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

/** Which Firebase variables are missing — [] means SMS login is available. */
export function firebaseMissingConfig(): string[] {
  return FIREBASE_ENV_VARS.filter((name) => !process.env[name]?.trim());
}

/** 2.28: never offer a door that dead-ends. */
export function firebaseConfigured(): boolean {
  return firebaseMissingConfig().length === 0;
}

export type FirebaseVerification =
  | { ok: true; phoneNumber: string; uid: string }
  | { ok: false; error: string };

/**
 * Verify a Firebase ID token and return the phone number Firebase itself
 * confirmed. Never throws.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseVerification> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "SMS sign-in is not configured on this server." };
  const token = idToken?.trim();
  if (!token) return { ok: false, error: "Missing verification token." };

  try {
    const res = await fetch(`${LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const text = await res.text();
    if (!res.ok) {
      // Google reports INVALID_ID_TOKEN / TOKEN_EXPIRED / USER_NOT_FOUND here.
      // The reason is logged; the caller shows something neutral.
      console.error("verifyFirebaseIdToken rejected:", res.status, text.slice(0, 300));
      return { ok: false, error: "That sign-in could not be verified. Request a new code." };
    }
    const parsed = JSON.parse(text) as {
      users?: { localId?: string; phoneNumber?: string }[];
    };
    const user = parsed.users?.[0];
    if (!user?.localId) {
      return { ok: false, error: "That sign-in could not be verified. Request a new code." };
    }
    if (!user.phoneNumber) {
      // An account with no phone claim did not come from the SMS flow.
      return { ok: false, error: "That sign-in did not verify a phone number." };
    }
    return { ok: true, phoneNumber: user.phoneNumber, uid: user.localId };
  } catch (e) {
    console.error("verifyFirebaseIdToken failed:", e);
    return { ok: false, error: "Could not reach the verification service. Try again." };
  }
}
