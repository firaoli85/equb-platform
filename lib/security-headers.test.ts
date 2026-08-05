import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  securityHeaders,
  supabaseConnectSources,
} from "./security-headers";

const SUPABASE = "https://abcdefgh.supabase.co";
const prod = { isDev: false, supabaseUrl: SUPABASE };
const dev = { isDev: true, supabaseUrl: SUPABASE };

/** The headers as a lookup, the way a browser would see them. */
function asMap(input: { isDev: boolean; supabaseUrl: string | undefined }) {
  return Object.fromEntries(securityHeaders(input).map((h) => [h.key, h.value]));
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
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows the browser to reach Supabase — and nothing else cross-origin", () => {
    const csp = contentSecurityPolicy(prod);
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(connect).toBe(
      `connect-src 'self' ${SUPABASE} wss://abcdefgh.supabase.co`,
    );
    // Twilio is called SERVER-side only — it must not be opened to the browser.
    expect(csp).not.toContain("twilio");
  });

  it("'unsafe-eval' is development-only; production never carries it", () => {
    expect(contentSecurityPolicy(dev)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(prod)).not.toContain("'unsafe-eval'");
  });

  it("upgrade-insecure-requests is production-only (it breaks http localhost)", () => {
    expect(contentSecurityPolicy(dev)).not.toContain("upgrade-insecure-requests");
  });

  it("stays a VALID policy when the Supabase URL is missing or malformed", () => {
    for (const url of [undefined, "", "   ", "not a url"]) {
      const csp = contentSecurityPolicy({ isDev: false, supabaseUrl: url });
      expect(csp).toContain("connect-src 'self'");
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
