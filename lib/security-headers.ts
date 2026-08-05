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
// Note for whoever tightens this: dropping 'unsafe-inline' is NOT a one-line
// change. Next itself emits inline bootstrap/flight scripts on every page, so
// removing it without supplying a nonce breaks the whole app — which is
// exactly why the nonce work is its own task.

export type HeaderPair = { key: string; value: string };

/**
 * The Supabase project origin — the ONE cross-origin the BROWSER talks to
 * (admin sign-in). Twilio and Prisma are server-side only, so they need no
 * connect-src entry. Returns "" when unset so the policy stays valid.
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

export function contentSecurityPolicy(input: {
  isDev: boolean;
  supabaseUrl: string | undefined;
}): string {
  const { isDev } = input;
  return [
    `default-src 'self'`,
    // 'unsafe-eval' is required by React in DEVELOPMENT only (error stacks).
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used throughout the UI; nonces do not cover
    // attributes, so 'unsafe-inline' is required here regardless of nonces.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'${supabaseConnectSources(input.supabaseUrl)}${isDev ? " ws: http://localhost:*" : ""}`,
    `worker-src 'self' blob:`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Every security header the app sends, in one place. */
export function securityHeaders(input: {
  isDev: boolean;
  supabaseUrl: string | undefined;
}): HeaderPair[] {
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
