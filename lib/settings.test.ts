import { describe, expect, it } from "vitest";
import { SETTING_DEFAULTS } from "./settings";

// SECURITY REGRESSION (audit C2). The phone-digit "default PIN" is the last
// 4 digits of the identifier the caller just typed — anyone holding a
// member's phone number knows it. It shipped ON, which made a phone number a
// working password. The organizer may still enable it for onboarding, but it
// is never the shipped default.

describe("SETTING_DEFAULTS — the security-relevant shipped defaults", () => {
  it("defaultPinFromPhone ships OFF", () => {
    expect(SETTING_DEFAULTS.defaultPinFromPhone).toBe(false);
  });

  it("presentation mode ships OFF and PIN login ships ON — unchanged by the fix", () => {
    expect(SETTING_DEFAULTS.presentationMode).toBe(false);
    expect(SETTING_DEFAULTS.pinLoginEnabled).toBe(true);
  });

  it("the lockout ships with a real limit and a real duration", () => {
    expect(SETTING_DEFAULTS.pinMaxAttempts).toBeGreaterThan(0);
    expect(SETTING_DEFAULTS.pinMaxAttempts).toBeLessThanOrEqual(10);
    expect(SETTING_DEFAULTS.pinLockMinutes).toBeGreaterThan(0);
  });
});
