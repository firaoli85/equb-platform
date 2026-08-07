// The handle cookie's name, alone in its own module on purpose.
//
// The proxy needs it, and the proxy must not pull in lib/session-record.ts —
// that file is `server-only` and reaches for next/headers `cookies()`, which
// does not exist in a proxy request. One shared constant, no shared imports.
//
// This is NOT the Supabase session cookie. Supabase's says who you are; this
// says which sign-in you are on, which is what lets "sign out everywhere
// else" spare the device in your hand.
export const SESSION_COOKIE_NAME = "equb_session";
