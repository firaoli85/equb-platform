import { describe, expect, it } from "vitest";
import {
  defaultPinForPhone,
  evaluatePinAttempt,
  hashPin,
  isPinLocked,
  isValidPinFormat,
  lockoutAfterFailure,
  verifyPin,
  PIN_LOCKOUT_MINUTES,
  PIN_MAX_ATTEMPTS,
} from "./pin";

const NOW = new Date("2026-08-04T12:00:00.000Z");

describe("isValidPinFormat", () => {
  it("accepts 4 to 8 digits and nothing else", () => {
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("12345678")).toBe(true);
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("123456789")).toBe(false);
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
  });
});

describe("evaluatePinAttempt", () => {
  it("accepts the correct PIN and never stores plaintext", async () => {
    const pinHash = await hashPin("4321");
    expect(pinHash).not.toContain("4321");
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
      "4321",
      NOW,
    );
    expect(result).toEqual({ outcome: "ok" });
  });

  it("rejects when no PIN is set", async () => {
    const result = await evaluatePinAttempt(
      { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
      "4321",
      NOW,
    );
    expect(result).toEqual({ outcome: "no-pin" });
  });

  it("counts wrong attempts without locking before the limit", async () => {
    const pinHash = await hashPin("4321");
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
      "0000",
      NOW,
    );
    expect(result).toEqual({ outcome: "wrong", failedAttempts: 1, lockedUntil: null });
  });

  it(`locks for ${PIN_LOCKOUT_MINUTES} minutes on attempt ${PIN_MAX_ATTEMPTS} and resets the counter`, async () => {
    const pinHash = await hashPin("4321");
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: PIN_MAX_ATTEMPTS - 1, pinLockedUntil: null },
      "0000",
      NOW,
    );
    expect(result.outcome).toBe("wrong");
    if (result.outcome === "wrong") {
      expect(result.failedAttempts).toBe(0);
      expect(result.lockedUntil?.getTime()).toBe(NOW.getTime() + PIN_LOCKOUT_MINUTES * 60_000);
    }
  });

  it("rejects even the CORRECT pin while locked", async () => {
    const pinHash = await hashPin("4321");
    const until = new Date(NOW.getTime() + 5 * 60_000);
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 0, pinLockedUntil: until },
      "4321",
      NOW,
    );
    expect(result).toEqual({ outcome: "locked", until });
  });

  it("allows again after the lock expires", async () => {
    const pinHash = await hashPin("4321");
    const expired = new Date(NOW.getTime() - 1_000);
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 0, pinLockedUntil: expired },
      "4321",
      NOW,
    );
    expect(result).toEqual({ outcome: "ok" });
  });
});

describe("configurable lockout (2.6 — limits come from settings, not code)", () => {
  it("defaults are 5 attempts / 30 minutes when nothing is passed", () => {
    expect(PIN_MAX_ATTEMPTS).toBe(5);
    expect(PIN_LOCKOUT_MINUTES).toBe(30);
  });

  it("locks at a CONFIGURED lower limit, for the CONFIGURED duration", async () => {
    const pinHash = await hashPin("4321");
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 2, pinLockedUntil: null },
      "0000",
      NOW,
      { maxAttempts: 3, lockMinutes: 45 },
    );
    expect(result.outcome).toBe("wrong");
    if (result.outcome === "wrong") {
      expect(result.failedAttempts).toBe(0);
      expect(result.lockedUntil?.getTime()).toBe(NOW.getTime() + 45 * 60_000);
    }
  });

  it("a HIGHER configured limit does not lock at the default threshold", async () => {
    const pinHash = await hashPin("4321");
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: PIN_MAX_ATTEMPTS - 1, pinLockedUntil: null },
      "0000",
      NOW,
      { maxAttempts: 8 },
    );
    expect(result).toEqual({
      outcome: "wrong",
      failedAttempts: PIN_MAX_ATTEMPTS,
      lockedUntil: null,
    });
  });

  it("while locked, even the correct PIN is refused regardless of configured limits", async () => {
    const pinHash = await hashPin("4321");
    const until = new Date(NOW.getTime() + 60_000);
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 0, pinLockedUntil: until },
      "4321",
      NOW,
      { maxAttempts: 20, lockMinutes: 1 },
    );
    expect(result).toEqual({ outcome: "locked", until });
  });

  it("configured limits govern the phone-digit default path too", async () => {
    const result = await evaluatePinAttempt(
      { pinHash: null, pinFailedAttempts: 1, pinLockedUntil: null, phone: "+1 (240) 555-0187" },
      "1111",
      NOW,
      { allowDefaultFromPhone: true, maxAttempts: 2, lockMinutes: 10 },
    );
    expect(result.outcome).toBe("wrong");
    if (result.outcome === "wrong") {
      expect(result.lockedUntil?.getTime()).toBe(NOW.getTime() + 10 * 60_000);
    }
  });
});

describe("defaultPinForPhone — derived, never stored", () => {
  it("is the last 4 DIGITS of the phone, however it is formatted", () => {
    expect(defaultPinForPhone("+1 (240) 555-0187")).toBe("0187");
    expect(defaultPinForPhone("2405550187")).toBe("0187");
  });

  it("no phone or fewer than 4 digits means no default (rule 6)", () => {
    expect(defaultPinForPhone(null)).toBeNull();
    expect(defaultPinForPhone(undefined)).toBeNull();
    expect(defaultPinForPhone("")).toBeNull();
    expect(defaultPinForPhone("+91")).toBeNull();
  });
});

describe("the phone-digit default (defaultPinFromPhone)", () => {
  const noPin = (phone: string | null) => ({
    pinHash: null,
    pinFailedAttempts: 0,
    pinLockedUntil: null,
    phone,
  });
  const ALLOW = { allowDefaultFromPhone: true };

  it("accepts the last 4 digits when NO PIN is set, and says the default was used", async () => {
    const result = await evaluatePinAttempt(noPin("+1 (240) 555-0187"), "0187", NOW, ALLOW);
    expect(result).toEqual({ outcome: "ok", usedDefault: true });
  });

  it("stops working the moment a real PIN is set — even if they match", async () => {
    // Real PIN "9999"; the phone-default digits no longer sign them in.
    const pinHash = await hashPin("9999");
    const result = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 0, pinLockedUntil: null, phone: "+1 (240) 555-0187" },
      "0187",
      NOW,
      ALLOW,
    );
    expect(result.outcome).toBe("wrong");
    // And their REAL pin works through the hash branch, never as a default.
    const real = await evaluatePinAttempt(
      { pinHash, pinFailedAttempts: 0, pinLockedUntil: null, phone: "+1 (240) 555-0187" },
      "9999",
      NOW,
      ALLOW,
    );
    expect(real).toEqual({ outcome: "ok" });
  });

  it("is rejected when the setting is off", async () => {
    const off = await evaluatePinAttempt(noPin("+1 (240) 555-0187"), "0187", NOW, {
      allowDefaultFromPhone: false,
    });
    expect(off).toEqual({ outcome: "no-pin" });
    const omitted = await evaluatePinAttempt(noPin("+1 (240) 555-0187"), "0187", NOW);
    expect(omitted).toEqual({ outcome: "no-pin" });
  });

  it("no usable phone means no default — never a lockout hit either", async () => {
    expect(await evaluatePinAttempt(noPin(null), "0000", NOW, ALLOW)).toEqual({
      outcome: "no-pin",
    });
  });

  it("wrong default attempts count toward the SAME lockout", async () => {
    let state = noPin("+1 (240) 555-0187");
    for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) {
      const result = await evaluatePinAttempt(state, "1111", NOW, ALLOW);
      expect(result).toEqual({ outcome: "wrong", failedAttempts: i, lockedUntil: null });
      state = { ...state, pinFailedAttempts: i };
    }
    const tripping = await evaluatePinAttempt(state, "1111", NOW, ALLOW);
    expect(tripping.outcome).toBe("wrong");
    if (tripping.outcome === "wrong") {
      expect(tripping.lockedUntil?.getTime()).toBe(
        NOW.getTime() + PIN_LOCKOUT_MINUTES * 60_000,
      );
    }
  });

  it("while locked, even the CORRECT default is refused", async () => {
    const locked = {
      ...noPin("+1 (240) 555-0187"),
      pinLockedUntil: new Date(NOW.getTime() + 60_000),
    };
    const result = await evaluatePinAttempt(locked, "0187", NOW, ALLOW);
    expect(result.outcome).toBe("locked");
  });

  it("never yields anything phone-derived to WRITE — outcomes carry only counters", async () => {
    // The accept path returns no hash and no derived value; the only fields
    // any outcome ever asks the caller to store are the failure counter and
    // the lock timestamp.
    const ok = await evaluatePinAttempt(noPin("+1 (240) 555-0187"), "0187", NOW, ALLOW);
    expect(Object.keys(ok).sort()).toEqual(["outcome", "usedDefault"]);
    const wrong = await evaluatePinAttempt(noPin("+1 (240) 555-0187"), "1111", NOW, ALLOW);
    expect(Object.keys(wrong).sort()).toEqual(["failedAttempts", "lockedUntil", "outcome"]);
  });
});

// ————————————————————————————————————————————————————————————————
// SECURITY REGRESSION (audit C3): the lockout race.
//
// The old flow read pinFailedAttempts, compared the PIN, then wrote an
// ABSOLUTE counter. Concurrent requests all read the same snapshot and all
// wrote the same number, so N simultaneous guesses cost 1 and the lock never
// tripped. signInWithPin now RESERVES each attempt with an atomic database
// increment and decides from the number that increment returned — these are
// the pure halves of that flow.
// ————————————————————————————————————————————————————————————————

describe("isPinLocked — the lock is read from the reserved row, not a snapshot", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  it("is locked while the deadline is in the future", () => {
    expect(isPinLocked(new Date(now.getTime() + 60_000), now)).toBe(true);
  });

  it("is not locked once it has passed, or when never set", () => {
    expect(isPinLocked(new Date(now.getTime() - 1), now)).toBe(false);
    expect(isPinLocked(null, now)).toBe(false);
  });
});

describe("lockoutAfterFailure — every reserved attempt is consumed exactly once", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  const opts = { maxAttempts: 5, lockMinutes: 30, now };

  it("counts up without locking below the limit", () => {
    for (let n = 1; n < 5; n++) {
      expect(lockoutAfterFailure({ ...opts, attemptNumber: n })).toEqual({
        failedAttempts: n,
        lockedUntil: null,
      });
    }
  });

  it("trips the lock on the configured attempt and resets the counter", () => {
    const result = lockoutAfterFailure({ ...opts, attemptNumber: 5 });
    expect(result.failedAttempts).toBe(0);
    expect(result.lockedUntil).toEqual(new Date(now.getTime() + 30 * 60_000));
  });

  it("CONCURRENCY: five racing attempts consume five distinct numbers and the fifth locks", () => {
    // The atomic increment hands each concurrent caller its own number —
    // this is what the old snapshot-based flow could not do.
    const reserved = [1, 2, 3, 4, 5];
    const verdicts = reserved.map((attemptNumber) =>
      lockoutAfterFailure({ ...opts, attemptNumber }),
    );
    expect(verdicts.filter((v) => v.lockedUntil !== null)).toHaveLength(1);
    expect(verdicts[4].lockedUntil).not.toBeNull();
    // Under the OLD behaviour every racer computed 0 + 1 = 1 and none locked.
    const oldRacyBehaviour = reserved.map(() => lockoutAfterFailure({ ...opts, attemptNumber: 1 }));
    expect(oldRacyBehaviour.every((v) => v.lockedUntil === null)).toBe(true);
  });

  it("an attempt beyond the limit still locks — nothing slips past", () => {
    expect(lockoutAfterFailure({ ...opts, attemptNumber: 9 }).lockedUntil).not.toBeNull();
  });

  it("honours configured limits rather than the defaults (2.6)", () => {
    expect(
      lockoutAfterFailure({ attemptNumber: 3, maxAttempts: 3, lockMinutes: 1, now }).lockedUntil,
    ).toEqual(new Date(now.getTime() + 60_000));
  });
});

describe("verifyPin — comparison only; the counter is the caller's business", () => {
  it("matches a real hashed PIN and rejects a wrong one", async () => {
    const pinHash = await hashPin("4321");
    expect(await verifyPin({ pinHash, phone: "+12405550187" }, "4321")).toEqual({
      result: "match",
      usedDefault: false,
    });
    expect(await verifyPin({ pinHash, phone: "+12405550187" }, "1111")).toEqual({
      result: "wrong",
    });
  });

  it("uses the phone-digit default ONLY when there is no hash and it is enabled", async () => {
    const state = { pinHash: null, phone: "+12405550187" };
    expect(await verifyPin(state, "0187", { allowDefaultFromPhone: true })).toEqual({
      result: "match",
      usedDefault: true,
    });
    expect(await verifyPin(state, "0187", { allowDefaultFromPhone: false })).toEqual({
      result: "no-pin",
    });
  });

  it("a real hash beats the default permanently — the phone digits stop working", async () => {
    const pinHash = await hashPin("4321");
    expect(
      await verifyPin({ pinHash, phone: "+12405550187" }, "0187", {
        allowDefaultFromPhone: true,
      }),
    ).toEqual({ result: "wrong" });
  });
});
