import bcrypt from "bcryptjs";
import { phoneDigits } from "./phone";

// Transition-period PIN login (retired at cycle 2). Pure decision logic —
// no database — so the lockout rules are unit-testable. PINs are stored
// ONLY as bcrypt hashes; the phone-digit DEFAULT is never stored at all.
//
// The lockout limits are CONFIGURABLE (2.6): these constants are only the
// defaults behind the pinMaxAttempts / pinLockMinutes settings. The action
// layer reads the settings at check time and passes them in — nothing here
// is ever the final word.

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MINUTES = 30;
const BCRYPT_ROUNDS = 10;

export type PinAttemptState = {
  pinHash: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: Date | null;
  /** Registered phone — the source of the default PIN when no hash is set. */
  phone?: string | null;
};

export type PinAttemptOutcome =
  | { outcome: "no-pin" }
  | { outcome: "locked"; until: Date }
  | {
      outcome: "wrong";
      /** New counter to store (resets to 0 when the lockout trips). */
      failedAttempts: number;
      /** Set when this failure trips the lockout. */
      lockedUntil: Date | null;
    }
  | { outcome: "ok"; usedDefault?: boolean };

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/**
 * The default PIN (2.6: defaultPinFromPhone): the LAST 4 DIGITS of the
 * registered phone. Derived on every call, never stored — a phone with
 * fewer than 4 digits (or none) has no default.
 */
export function defaultPinForPhone(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone ?? "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Decide what a PIN attempt does, given the stored state. The caller
 * persists the returned counter/lock fields — always in the same place, so
 * lockout state is durable in the database, not process memory.
 *
 * When no pinHash exists and `allowDefaultFromPhone` is on, the phone-digit
 * default is checked INSTEAD — with the same lockout rules. The moment a
 * real PIN is set, the hash branch takes over and the default is dead for
 * that member, permanently.
 */
export async function evaluatePinAttempt(
  state: PinAttemptState,
  pin: string,
  now: Date,
  options?: {
    allowDefaultFromPhone?: boolean;
    /** The configured limits (2.6) — read from settings at check time. */
    maxAttempts?: number;
    lockMinutes?: number;
  },
): Promise<PinAttemptOutcome> {
  const maxAttempts = options?.maxAttempts ?? PIN_MAX_ATTEMPTS;
  const lockMinutes = options?.lockMinutes ?? PIN_LOCKOUT_MINUTES;

  // Lockout first — it applies to default attempts exactly as to real ones.
  if (state.pinLockedUntil && state.pinLockedUntil.getTime() > now.getTime()) {
    return { outcome: "locked", until: state.pinLockedUntil };
  }

  let matched: boolean;
  let usedDefault = false;
  if (state.pinHash) {
    matched = await bcrypt.compare(pin, state.pinHash);
  } else {
    const fallback = options?.allowDefaultFromPhone ? defaultPinForPhone(state.phone) : null;
    if (fallback === null) return { outcome: "no-pin" };
    matched = pin === fallback;
    usedDefault = true;
  }

  if (matched) return usedDefault ? { outcome: "ok", usedDefault: true } : { outcome: "ok" };

  const failedAttempts = state.pinFailedAttempts + 1;
  if (failedAttempts >= maxAttempts) {
    return {
      outcome: "wrong",
      failedAttempts: 0, // fresh count after the lock expires
      lockedUntil: new Date(now.getTime() + lockMinutes * 60_000),
    };
  }
  return { outcome: "wrong", failedAttempts, lockedUntil: null };
}
