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

/**
 * SECURITY (audit C3). The attempt counter must be RESERVED with an atomic
 * database increment BEFORE the PIN is compared, and the verdict decided
 * from the value that increment returned. The previous shape — read the
 * stored counter, compare, then write an absolute value — let concurrent
 * requests all read the same snapshot and all write the same number, so N
 * simultaneous guesses cost 1 and the lock never tripped.
 *
 * These two helpers are the decision half of that flow; the action layer
 * owns the atomic `{ increment: 1 }` update that produces `attemptNumber`.
 */

/** Is the account locked right now? */
export function isPinLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/**
 * Given the reserved attempt number (1 for the first failure in a window),
 * decide what to store after a WRONG pin: the lock trips on the configured
 * attempt, and the counter resets so the next window starts clean.
 */
export function lockoutAfterFailure(input: {
  attemptNumber: number;
  maxAttempts: number;
  lockMinutes: number;
  now: Date;
}): { failedAttempts: number; lockedUntil: Date | null } {
  if (input.attemptNumber >= input.maxAttempts) {
    return {
      failedAttempts: 0, // fresh count once the lock expires
      lockedUntil: new Date(input.now.getTime() + input.lockMinutes * 60_000),
    };
  }
  return { failedAttempts: input.attemptNumber, lockedUntil: null };
}

/**
 * Compare a PIN against stored state. No counter logic — the caller has
 * already reserved the attempt. Returns "no-pin" when the member has neither
 * a hash nor an available phone-digit default.
 */
export async function verifyPin(
  state: Pick<PinAttemptState, "pinHash" | "phone">,
  pin: string,
  options?: { allowDefaultFromPhone?: boolean },
): Promise<{ result: "match"; usedDefault: boolean } | { result: "wrong" } | { result: "no-pin" }> {
  if (state.pinHash) {
    return (await bcrypt.compare(pin, state.pinHash))
      ? { result: "match", usedDefault: false }
      : { result: "wrong" };
  }
  const fallback = options?.allowDefaultFromPhone ? defaultPinForPhone(state.phone) : null;
  if (fallback === null) return { result: "no-pin" };
  return pin === fallback ? { result: "match", usedDefault: true } : { result: "wrong" };
}

/**
 * THE DOOR RULE, as one testable predicate. NOBODY is ever stopped here.
 *
 * This used to return `usedDefault`, forcing a WhatsApp/SMS code whenever the
 * phone-digit default was what matched (audit C2). That door held: of 27
 * members, only the one with her own PIN could get in, because the code
 * channel could not deliver.
 *
 * ORGANIZER'S RULING (Aug 2026), overriding C2 at the door: the default PIN
 * signs a member in DIRECTLY. Members are non-technical, and friction they do
 * not understand is worse than the risk — they have to be able to get in and
 * see the thing before being asked to secure it. The default is temporary and
 * retires at cycle 2.
 *
 * The risk C2 identified is REAL and has not gone away: the default is the
 * last 4 digits of the identifier the caller just typed, so it authenticates
 * nobody. It is answered elsewhere instead of at the door —
 *   - an encouraging, skippable "set your own PIN" prompt after sign-in,
 *   - every sign-in recorded with device, browser and IP (lib/session-record),
 *   - bounded session lifetimes, idle and absolute (lib/session-policy),
 *   - "Where you are signed in" + "Sign out everywhere else" in the portal,
 *   - a prominent new-device notice on the member's next visit,
 *   - the organizer's amber "still on the default" badges, kept as they were.
 *
 * Kept as a function, not deleted, so the ruling is asserted by tests rather
 * than living only in a removed `if`. Anything that ever needs to gate on the
 * default should read `usedDefault` directly and say why.
 */
export function requiresSecondFactor(_match: { usedDefault: boolean }): boolean {
  return false;
}

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
 * Decide what a PIN attempt does, given the stored state.
 *
 * @deprecated NOT for the login path (audit C3). This returns an ABSOLUTE
 * counter derived from a snapshot the caller read earlier, so persisting it
 * is a read-modify-write: concurrent sign-in requests all read the same
 * value and all write the same value, consuming N guesses for the price of
 * one and never tripping the lock. `signInWithPin` now reserves the attempt
 * with an atomic `{ increment: 1 }` and decides via isPinLocked / verifyPin
 * / lockoutAfterFailure. Retained only for the offline verification script
 * and the behavioural tests below.
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
