import { describe, expect, it } from "vitest";
import { isAdminClaims } from "./auth";

// SECURITY REGRESSION (audit C4). The member sign-in bridge (PIN and
// WhatsApp) must never produce a session carrying is_admin. mintBridgeSession
// refuses when the target auth user holds the claim, and
// linkCurrentUserToPerson refuses to bind an admin session to a Person — both
// decisions run through isAdminClaims, so its shape is load-bearing.

describe("isAdminClaims — the one predicate both C4 guards depend on", () => {
  it("is true only for the service-role-written app_metadata flag", () => {
    expect(isAdminClaims({ sub: "u1", app_metadata: { is_admin: true } })).toBe(true);
  });

  it("is false for a member session", () => {
    expect(isAdminClaims({ sub: "u1" })).toBe(false);
    expect(isAdminClaims({ sub: "u1", app_metadata: {} })).toBe(false);
    expect(isAdminClaims({ sub: "u1", app_metadata: { is_admin: false } })).toBe(false);
    expect(isAdminClaims(null)).toBe(false);
  });

  it("cannot be satisfied from user_metadata — the field a member CAN write", () => {
    const selfGranted = {
      sub: "u1",
      user_metadata: { is_admin: true },
    } as unknown as Parameters<typeof isAdminClaims>[0];
    expect(isAdminClaims(selfGranted)).toBe(false);
  });

  it("is strictly boolean-true — truthy impostors do not pass", () => {
    for (const impostor of ["true", 1, "1", {}, [], "yes"]) {
      expect(
        isAdminClaims({ sub: "u1", app_metadata: { is_admin: impostor as unknown } }),
      ).toBe(false);
    }
  });
});
