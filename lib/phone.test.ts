import { describe, expect, it } from "vitest";
import { canonicalPhone, phoneDigits, samePhone, toE164 } from "./phone";
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

describe("audit H1 — matching and sending can NEVER disagree", () => {
  it("the exact attack: '+2405550187' matches the US member AND the code goes to THEIR number", () => {
    const victimStored = "+1 240 555 0187";
    const attackerInput = "+2405550187";
    // The lookup still matches (same 10 digits refer to the same line)…
    expect(samePhone(victimStored, attackerInput)).toBe(true);
    // …but the code is now sent to the SAME canonical number the match used —
    // the victim's US line, never country code +240.
    expect(toE164(attackerInput)).toBe("+12405550187");
    expect(toE164(attackerInput)).toBe(toE164(victimStored));
  });

  it("whenever samePhone says two inputs match, toE164 sends both to the same place", () => {
    const forms = [
      "2405550187",
      "(240) 555-0187",
      "+2405550187",
      "12405550187",
      "+1 240-555-0187",
      "1 (240) 555 0187",
    ];
    for (const a of forms) {
      for (const b of forms) {
        expect(samePhone(a, b)).toBe(true);
        expect(toE164(a)).toBe(toE164(b));
      }
    }
  });

  it("true international numbers still pass through with their country code", () => {
    expect(canonicalPhone("+251 91 123 4567")).toBe("+251911234567");
    expect(samePhone("+251 91 123 4567", "251911234567")).toBe(true);
  });

  it("no digits means no canonical form and no match", () => {
    expect(canonicalPhone("")).toBeNull();
    expect(canonicalPhone("+")).toBeNull();
    expect(samePhone("+", "+")).toBe(false);
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
