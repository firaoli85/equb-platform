// Security response headers (audit H6) — pure and unit-tested, so the policy
// is a regression-checked artifact rather than a string buried in config.
//
// CSP SCOPE, stated honestly: script-src uses 'unsafe-inline' rather than
// per-request nonces. Nonces are stronger, but this Next version applies them
// only to pages rendered dynamically, AND a nonce never covers inline style
// ATTRIBUTES — which this UI uses heavily (style={{…}} for motion, tap
// targets, and theme variables). The nonce upgrade is its own verifiable
// change (proxy-generated nonce + every page forced dynamic), not something
// to slip in beside six security fixes.
//
// What this policy DOES stop today: script/style/frame/object resources from
// any attacker-controlled origin, form posts to another site, <base> tag
// injection, framing (clickjacking), and plugin content. What it does NOT
// stop: an injected inline <script>.
//
// CROSS-ORIGIN ALLOWANCES: every one is a single named origin carrying a
// comment that says which browser call needs it. There are no wildcards and no
// scheme-only sources. Before adding one, read the URL out of the dependency's
// own source — a guessed origin is either a hole or a broken feature, and the
// broken-feature case is silent until someone cannot sign in.
//
// Note for whoever tightens this: dropping 'unsafe-inline' is NOT a one-line
// change. Next itself emits inline bootstrap/flight scripts on every page, so
// removing it without supplying a nonce breaks the whole app — which is
// exactly why the nonce work is its own task.

export type HeaderPair = { key: string; value: string };

export type PolicyInput = {
  isDev: boolean;
  supabaseUrl: string | undefined;
  /**
   * NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN. Its presence is what says "this
   * deployment offers SMS login": lib/firebase-verify.ts requires the same
   * variable before the SMS door is ever shown (2.28), and NEXT_PUBLIC_ values
   * are inlined at build time — the same build that evaluates this config. So
   * a deployment without Firebase gets none of the Google origins below.
   */
  firebaseAuthDomain: string | undefined;
};

// ————————————————————————————————————————————————————————————————
// WHAT FIREBASE PHONE AUTH ACTUALLY LOADS, and why each origin is here.
//
// Verified against node_modules/@firebase/auth (DefaultConfig.API_HOST,
// DefaultConfig.TOKEN_API_HOST, and the recaptcha loader URL) — not guessed.
// Every entry is a single named origin; no wildcards, no scheme-only sources.
//
// Server-side callers are deliberately ABSENT: Twilio, Prisma, and the Admin
// token check in lib/firebase-verify.ts all run on the server, where CSP does
// not apply. An origin the browser never contacts must not be opened to it.
// ————————————————————————————————————————————————————————————————

/**
 * `https://www.google.com/recaptcha/api.js` — the loader that
 * RecaptchaVerifier injects into the page. Nothing is sent until it runs.
 *
 * Listed as an ORIGIN rather than the tighter `.../recaptcha/` path because
 * the widget also pulls a bot-detection script from `/js/bg/<hash>.js` on the
 * same host; a path-scoped source would block it and break the challenge.
 */
const RECAPTCHA_SCRIPT_ORIGIN = "https://www.google.com";

/**
 * `https://www.gstatic.com/recaptcha/releases/<build>/recaptcha__<lang>.js` —
 * the widget code that api.js above loads second.
 */
const RECAPTCHA_ASSET_ORIGIN = "https://www.gstatic.com";

/**
 * Firebase Auth's REST API (@firebase/auth DefaultConfig.API_HOST):
 * `accounts:sendVerificationCode` sends the SMS, `accounts:signInWithPhoneNumber`
 * confirms the code. This is the call in the reported console error.
 */
const IDENTITY_TOOLKIT_ORIGIN = "https://identitytoolkit.googleapis.com";

/**
 * ID-token mint/refresh (@firebase/auth DefaultConfig.TOKEN_API_HOST). Called
 * by `credential.user.getIdToken()` in components/member/login-flow.tsx before
 * the token is posted to signInWithFirebaseSms.
 */
const SECURE_TOKEN_ORIGIN = "https://securetoken.googleapis.com";

/**
 * reCAPTCHA renders its challenge in iframes served from
 * `https://www.google.com/recaptcha/api2/{anchor,bframe}` — invisible mode
 * still mounts the anchor frame, so frame-src 'none' blocks it outright.
 */
const RECAPTCHA_FRAME_ORIGIN = "https://www.google.com";

/**
 * The Supabase project origin — where the BROWSER talks to Supabase.
 *
 * BOTH forms are required and neither implies the other: `https://<host>`
 * covers the REST/auth calls, and `wss://<host>` covers the realtime socket.
 * A CSP source with an https scheme does NOT authorise a wss connection to the
 * same host, which is exactly how a websocket ends up blocked by a policy that
 * looks like it already allows the origin.
 *
 * Returns "" when unset so the directive stays valid.
 */
export function supabaseConnectSources(supabaseUrl: string | undefined): string {
  const raw = supabaseUrl?.trim();
  if (!raw) return "";
  try {
    const { origin, host } = new URL(raw);
    return ` ${origin} wss://${host}`;
  } catch {
    return "";
  }
}

/**
 * The Firebase auth domain as a CSP source, e.g.
 * "equb-app-90bbc.firebaseapp.com" → " https://equb-app-90bbc.firebaseapp.com".
 *
 * The env var is a bare HOST, and a bare host in CSP also matches http://,
 * so the scheme is forced to https here. Returns "" when unset or unparseable
 * — the caller then emits no Firebase sources at all.
 */
export function firebaseAuthDomainSource(authDomain: string | undefined): string {
  const raw = authDomain?.trim();
  if (!raw) return "";
  try {
    const { host } = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return host ? ` https://${host}` : "";
  } catch {
    return "";
  }
}

export function contentSecurityPolicy(input: PolicyInput): string {
  const { isDev } = input;

  // One switch for the whole Firebase Phone Auth surface (see PolicyInput).
  const firebaseFrame = firebaseAuthDomainSource(input.firebaseAuthDomain);
  const smsLogin = firebaseFrame !== "";

  const recaptchaScript = smsLogin
    ? ` ${RECAPTCHA_SCRIPT_ORIGIN} ${RECAPTCHA_ASSET_ORIGIN}`
    : "";
  const firebaseConnect = smsLogin
    ? ` ${IDENTITY_TOOLKIT_ORIGIN} ${SECURE_TOKEN_ORIGIN}`
    : "";
  // reCAPTCHA's own iframes, plus the Firebase auth helper iframe served from
  // the project's authDomain.
  const frameSrc = smsLogin ? `${RECAPTCHA_FRAME_ORIGIN}${firebaseFrame}` : "'none'";

  return [
    `default-src 'self'`,
    // 'unsafe-eval' is required by React in DEVELOPMENT only (error stacks).
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${recaptchaScript}`,
    // Inline style attributes are used throughout the UI; nonces do not cover
    // attributes, so 'unsafe-inline' is required here regardless of nonces.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'${supabaseConnectSources(input.supabaseUrl)}${firebaseConnect}${isDev ? " ws: http://localhost:*" : ""}`,
    `worker-src 'self' blob:`,
    `frame-src ${frameSrc}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Every security header the app sends, in one place. */
export function securityHeaders(input: PolicyInput): HeaderPair[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(input) },
    // Clickjacking: frame-ancestors above is the modern rule; this is the
    // legacy header for older browsers.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Member and admin URLs carry person ids — never leak a path to another
    // origin. Next's Server Action CSRF check uses Origin, not Referer, so
    // nothing in the app depends on referrers being sent.
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    // HSTS is meaningless (and unwanted) over plain-http local development.
    ...(input.isDev
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]),
  ];
}
