import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  firebaseAuthDomainSource,
  securityHeaders,
  supabaseConnectSources,
  type PolicyInput,
} from "./security-headers";

const SUPABASE = "https://abcdefgh.supabase.co";
const AUTH_DOMAIN = "equb-test.firebaseapp.com";
const prod: PolicyInput = {
  isDev: false,
  supabaseUrl: SUPABASE,
  firebaseAuthDomain: AUTH_DOMAIN,
};
const dev: PolicyInput = { ...prod, isDev: true };
/** A deployment with no SMS login configured. */
const noFirebase: PolicyInput = { ...prod, firebaseAuthDomain: undefined };

/** The headers as a lookup, the way a browser would see them. */
function asMap(input: PolicyInput) {
  return Object.fromEntries(securityHeaders(input).map((h) => [h.key, h.value]));
}

/** One directive, the way the browser parses it. */
function directive(csp: string, name: string): string {
  return csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
}

describe("audit H6 — the four required headers are present", () => {
  it("sends CSP, HSTS, X-Frame-Options and Referrer-Policy in production", () => {
    const headers = asMap(prod);
    expect(headers["Content-Security-Policy"]).toBeTruthy();
    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("adds the standard companions: nosniff, Permissions-Policy, no DNS prefetch", () => {
    const headers = asMap(prod);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
    expect(headers["X-DNS-Prefetch-Control"]).toBe("off");
  });

  it("never sends HSTS in development (plain-http localhost)", () => {
    expect(asMap(dev)["Strict-Transport-Security"]).toBeUndefined();
  });

  it("every header has a non-empty value and appears exactly once", () => {
    const pairs = securityHeaders(prod);
    const keys = pairs.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { key, value } of pairs) {
      expect(value.trim().length, `${key} must not be empty`).toBeGreaterThan(0);
    }
  });
});

describe("the Content-Security-Policy itself", () => {
  it("locks down the dangerous sinks", () => {
    const csp = contentSecurityPolicy(prod);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows the browser to reach Supabase over BOTH https and wss", () => {
    // These are two separate grants. An https source does not authorise a
    // websocket to the same host, so a missing wss:// entry blocks realtime
    // while the policy still looks like it allows the origin.
    const connect = directive(contentSecurityPolicy(prod), "connect-src");
    expect(connect).toContain(` ${SUPABASE} `);
    expect(connect).toContain(" wss://abcdefgh.supabase.co");
  });

  it("opens nothing cross-origin that only the SERVER talks to", () => {
    const csp = contentSecurityPolicy(prod);
    // Twilio (WhatsApp) and the Admin token lookup are server-side calls.
    expect(csp).not.toContain("twilio");
    expect(csp).not.toContain("apis.google.com");
    // Never a wildcard, and never a bare scheme, on any cross-origin grant.
    expect(csp).not.toMatch(/\bhttps:(?![/])/);
    expect(csp).not.toContain("*.");
  });

  it("'unsafe-eval' is development-only; production never carries it", () => {
    expect(contentSecurityPolicy(dev)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(prod)).not.toContain("'unsafe-eval'");
  });

  it("upgrade-insecure-requests is production-only (it breaks http localhost)", () => {
    expect(contentSecurityPolicy(dev)).not.toContain("upgrade-insecure-requests");
  });

  it("stays a VALID policy when either URL is missing or malformed", () => {
    for (const value of [undefined, "", "   ", "not a url"]) {
      const csp = contentSecurityPolicy({
        isDev: false,
        supabaseUrl: value,
        firebaseAuthDomain: value,
      });
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("frame-src 'none'");
      expect(csp).not.toContain("undefined");
      expect(csp).not.toMatch(/;\s*;/);
    }
  });

  it("supabaseConnectSources yields the origin plus its websocket host", () => {
    expect(supabaseConnectSources("https://x.supabase.co/")).toBe(
      " https://x.supabase.co wss://x.supabase.co",
    );
    expect(supabaseConnectSources(undefined)).toBe("");
  });
});

// The CSP added in the security-headers work blocked Firebase Phone Auth
// outright: reCAPTCHA could not load, identitytoolkit could not be reached,
// and the challenge iframe was refused. Nobody without a PIN could sign in.
// These tests hold each grant in place, and hold the blast radius down.
describe("Firebase Phone Auth — the login code can actually be sent", () => {
  it("script-src allows reCAPTCHA's loader and its widget assets", () => {
    const script = directive(contentSecurityPolicy(prod), "script-src");
    // www.google.com/recaptcha/api.js — injected by RecaptchaVerifier.
    expect(script).toContain(" https://www.google.com");
    // www.gstatic.com/recaptcha/releases/… — pulled in by api.js.
    expect(script).toContain(" https://www.gstatic.com");
  });

  it("connect-src allows sending the code and refreshing the ID token", () => {
    const connect = directive(contentSecurityPolicy(prod), "connect-src");
    // accounts:sendVerificationCode / accounts:signInWithPhoneNumber.
    expect(connect).toContain(" https://identitytoolkit.googleapis.com");
    // getIdToken() before the token is posted to the server.
    expect(connect).toContain(" https://securetoken.googleapis.com");
  });

  it("frame-src allows the reCAPTCHA challenge and the Firebase auth iframe", () => {
    const frame = directive(contentSecurityPolicy(prod), "frame-src");
    expect(frame).toBe(`frame-src https://www.google.com https://${AUTH_DOMAIN}`);
    expect(frame).not.toContain("'none'");
  });

  it("every Firebase grant is present in DEVELOPMENT too", () => {
    // The bug was found on localhost; the fix must hold there.
    const csp = contentSecurityPolicy(dev);
    for (const origin of [
      "https://www.google.com",
      "https://www.gstatic.com",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      `https://${AUTH_DOMAIN}`,
    ]) {
      expect(csp, `${origin} must be allowed in dev`).toContain(origin);
    }
  });

  it("a deployment WITHOUT Firebase opens none of it", () => {
    // 2.28: no SMS door configured means no reason to trust Google's origins.
    const csp = contentSecurityPolicy(noFirebase);
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain("google");
    expect(csp).not.toContain("gstatic");
    // …and Supabase is untouched by that switch.
    expect(csp).toContain(SUPABASE);
  });

  it("the auth domain is forced to https, whatever form the env var takes", () => {
    // The env var is a bare HOST; a bare host in CSP also matches http://.
    expect(firebaseAuthDomainSource("equb.firebaseapp.com")).toBe(
      " https://equb.firebaseapp.com",
    );
    expect(firebaseAuthDomainSource("  equb.firebaseapp.com  ")).toBe(
      " https://equb.firebaseapp.com",
    );
    expect(firebaseAuthDomainSource("https://equb.firebaseapp.com/")).toBe(
      " https://equb.firebaseapp.com",
    );
    expect(firebaseAuthDomainSource("http://equb.firebaseapp.com")).toBe(
      " https://equb.firebaseapp.com",
    );
    expect(firebaseAuthDomainSource(undefined)).toBe("");
    expect(firebaseAuthDomainSource("   ")).toBe("");
  });

  it("the Google grants are exactly four origins — not a wildcard opening", () => {
    const csp = contentSecurityPolicy(prod);
    const googleSources = csp.match(/https:\/\/[a-z0-9.-]*google[a-z0-9.-]*/g) ?? [];
    expect(new Set(googleSources)).toEqual(
      new Set([
        "https://www.google.com",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
      ]),
    );
  });
});
