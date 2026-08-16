import bcrypt from "bcryptjs";
import { defaultPinForPhone, phoneDigits } from "./phone";

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
 * AMENDED 16 August 2026 — THE DOOR IS UNCHANGED, WHAT FOLLOWS IT IS NOT.
 * Nobody is still stopped HERE, so this predicate keeps returning false. But
 * "temporary" is now enforced rather than hoped for: a member who signs in on
 * the phone-digit default is required to set their own PIN before reaching the
 * portal, because the last 4 digits of the number the caller just typed
 * authenticate nobody, and a default nobody is made to replace is permanent in
 * practice. A member who arrives by WhatsApp CODE has proved who they are and
 * is still only asked, never forced.
 *
 * The risk C2 identified is REAL and has not gone away: the default is the
 * last 4 digits of the identifier the caller just typed, so it authenticates
 * nobody. It is answered elsewhere instead of at the door —
 *   - a FORCED "set your own PIN" step after a default sign-in, and a
 *     skippable one after a code (login-flow.tsx),
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

// ————————————— ONE RULE: A PIN IS FOUR DIGITS —————————————
//
// This briefly held two rules — four when SETTING, any stored length at the
// LOGIN door — because 4-to-8-digit PINs existed and a bcrypt hash does not
// say which length it hashed, so the long ones could not be found and
// migrated. Applying one rule everywhere would have locked those members out.
//
// Resolved by removing the reason rather than working around it: every PIN was
// reset to the member's own phone's last four digits
// (scripts/reset-pins-to-phone-default.mts, 28 of 28 verified against their
// own hash). The longer ones were the organizer's test data — no member had
// been sent the portal link, so no member had ever chosen a PIN. No PIN in the
// system is anything but four digits, so there is no second rule to keep.
//
// The length lives in lib/pin-constants.ts so the login pad — a client
// component — can read it without pulling bcryptjs into the browser bundle.
import { PIN_LENGTH } from "./pin-constants";
export { PIN_LENGTH } from "./pin-constants";

/**
 * Is this an acceptable PIN to SET?
 *
 * Named for the moment it governs rather than for a shape. The original name,
 * `isValidPinFormat`, described a regex — and a name like that is what gets
 * reused at the login door by someone being careful. That mattered while the
 * two rules differed; the name is kept now because the next divergence would
 * be just as quiet.
 */
export function isValidNewPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/**
 * Re-exported from lib/phone.ts, where it lives so that client components can
 * compute it without pulling bcryptjs into the browser bundle. Every existing
 * caller imports it from here and keeps working.
 */
export { defaultPinForPhone } from "./phone";

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
