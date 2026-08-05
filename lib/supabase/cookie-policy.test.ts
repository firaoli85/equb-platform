import { afterEach, describe, expect, it, vi } from "vitest";
import { hardenSessionCookie, SESSION_COOKIE_MAX_AGE_SECONDS } from "./cookie-policy";

describe("audit H2 — session cookie policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("clamps the library's 400-day default to the chosen 30-day expiry", () => {
    const hardened = hardenSessionCookie({ maxAge: 400 * 24 * 60 * 60 });
    expect(hardened.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("forces httpOnly and sameSite lax, and drops any expires date", () => {
    const hardened = hardenSessionCookie({
      httpOnly: false,
      sameSite: "none",
      expires: new Date("2030-01-01"),
    });
    expect(hardened.httpOnly).toBe(true);
    expect(hardened.sameSite).toBe("lax");
    expect(hardened).not.toHaveProperty("expires");
  });

  it("is secure in production, not forced in dev (localhost has no TLS)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(hardenSessionCookie({}).secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(hardenSessionCookie({}).secure).toBe(false);
  });

  it("passes cookie DELETIONS through untouched (maxAge 0 stays 0)", () => {
    expect(hardenSessionCookie({ maxAge: 0 }).maxAge).toBe(0);
  });

  it("fills the chosen lifetime when the caller provides none", () => {
    expect(hardenSessionCookie().maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
    expect(hardenSessionCookie().path).toBe("/");
  });
});
