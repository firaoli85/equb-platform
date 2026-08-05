import { describe, expect, it } from "vitest";
import { phoneDigits, samePhone, toE164 } from "./phone";
import { allowLookup } from "./lookup-throttle";

describe("phone matching — formatted, autofilled, and stored forms all meet", () => {
  it("compares by digits, ignoring formatting", () => {
    expect(samePhone("(240) 555-0000", "2405550000")).toBe(true);
    expect(samePhone("+1 240-555-0000", "2405550000")).toBe(true);
    expect(samePhone("12405550000", "+1 (240) 555-0000")).toBe(true);
    expect(samePhone("2405550000", "2405550001")).toBe(false);
    expect(samePhone("", "2405550000")).toBe(false);
  });

  it("normalizes to E.164 for the OTP sender", () => {
    expect(toE164("(240) 555-0000")).toBe("+12405550000");
    expect(toE164("12405550000")).toBe("+12405550000");
    expect(toE164("+251 91 123 4567")).toBe("+251911234567");
  });

  it("phoneDigits strips everything but digits", () => {
    expect(phoneDigits("+1 (240) 555-0000")).toBe("12405550000");
  });
});

describe("lookup throttle — the directory cannot be enumerated", () => {
  it("allows a burst then refuses, per key, on a sliding window", () => {
    const key = `test-${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < 8; i++) {
      expect(allowLookup(key, t0 + i)).toBe(true);
    }
    expect(allowLookup(key, t0 + 10)).toBe(false);
    // Other keys are unaffected.
    expect(allowLookup(`${key}-other`, t0 + 10)).toBe(true);
    // The window slides: 15 minutes later the key breathes again.
    expect(allowLookup(key, t0 + 15 * 60 * 1000 + 20)).toBe(true);
  });
});
