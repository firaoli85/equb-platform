// WHEN THE WELCOME MAY NOT LEAVE — one rule, asked by everything.
//
// WHATSAPP_WELCOME is the only message that makes two PROMISES about the
// platform rather than reporting a fact about the member:
//
//   "Sign in at {portalUrl} with your phone number."
//   "…otherwise your PIN is the last 4 digits of your phone number."
//
// A statement that is wrong about someone's arrears is an embarrassment the
// organizer can correct in the next sentence. These two are different in kind:
// they are instructions, and a member who follows a wrong one concludes the
// account does not work and stops. Neither failure produces an error anywhere —
// the send succeeds, the log says ACCEPTED, and the only evidence is a member
// who never signs in.
//
// A PURE FUNCTION IN lib/, NOT A CHECK IN THE SEND PATH. Four callers need this
// answer: the engine before it sends, the batch before it prepares, the member
// profile before it offers the button, and the settings form while the
// organizer is typing the address. Written four times it would be four rules,
// and the settings form — the one place the organizer could actually FIX it —
// is the copy most likely to be forgotten.
//
// NO DATABASE IMPORT. The settings form is a "use client" component, and
// anything reaching Prisma from there pulls node:dns into the browser bundle
// and 500s the page (lib/client-bundle-safety.test.ts).

export type WelcomeSendCheck =
  | { ok: true }
  | {
      ok: false;
      /** Every reason, so two problems are not fixed one page-load at a time. */
      reasons: string[];
      /** The reasons as one sentence, for a refusal that has room for one. */
      reason: string;
    };

/**
 * The `portalUrl` setting as a STRING, whatever the stored row actually holds.
 *
 * `getSetting` JSON-parses the row and casts the result — there is no runtime
 * validation anywhere between the `settings` table and here. A row written by
 * hand, left behind by a renamed setting, or restored from an older dump can
 * therefore hold a boolean or a number under this key, and the very first thing
 * the welcome does with the value is `.trim()` it.
 *
 * A throw there would land MID-SEND, inside a batch, after some members had
 * already been messaged. A non-string address is no address, so it reads as ""
 * and the welcome refuses for the reason that is actually true — there is
 * nowhere to send anybody.
 */
export function portalUrlValue(stored: unknown): string {
  return typeof stored === "string" ? stored : "";
}

/**
 * The address a member is sent to has no default and cannot have one.
 *
 * "" means the organizer has not set it, which is the state the platform ships
 * in — so this is not a validation edge case, it is the ordinary first state,
 * and the welcome must refuse in it rather than tell 27 people to sign in at
 * nowhere.
 */
export const PORTAL_URL_MISSING =
  "There is no member sign-in address set, and the welcome exists to give a member one. " +
  "Set it under Settings → Messaging first — a welcome with no way in is worse than no welcome, " +
  "because the member believes they have been told everything.";

/**
 * The message states the fallback PIN as fact. With the setting off it is not.
 *
 * `defaultPinFromPhone` is what allows a member with no PIN of their own to
 * sign in with the last 4 digits of their number. Off, those digits are
 * REJECTED at the door — so the sentence in the welcome sends a new member a
 * password that does not work, and their first act on the platform is a failed
 * sign-in they have no way to explain.
 */
export const DEFAULT_PIN_OFF =
  "The welcome tells a member their PIN is the last 4 digits of their phone number, and " +
  "“Default PIN from phone” is switched off — so those digits are rejected at sign-in. " +
  "Turn it on under Settings → Access, or the welcome hands a new member a PIN that does not work.";

/**
 * PIN SIGN-IN ITSELF IS OFF, which is a bigger door than the digits.
 *
 * `defaultPinFromPhone` decides whether the phone digits work for a member who
 * has no PIN. `pinLoginEnabled` decides whether a PIN works AT ALL — with it
 * off, `app/actions/auth.ts` refuses every PIN attempt before it looks at any
 * of this, including from a member who set their own.
 *
 * So the welcome's whole sign-in sentence is false in this state, for BOTH of
 * the cases it carefully covers. The first check missed it because it read the
 * narrower setting and stopped.
 */
export const PIN_LOGIN_OFF =
  "The welcome tells a member how to sign in with a PIN, and PIN sign-in is switched off " +
  "entirely — every PIN is refused, including one they set themselves. Turn it on under " +
  "Settings → Access, or send them a WhatsApp code instead.";

/**
 * THIS MEMBER'S OWN OVERRIDE says no, whatever the platform setting says.
 *
 * `Person.pinLoginAllowed` is a per-person override that wins over
 * `pinLoginEnabled` in both directions (`p.pinLoginAllowed ?? globallyEnabled`
 * in auth.ts). A member with it set to false is refused every PIN while
 * everyone else signs in normally — so this is the one block that can fire for
 * a single person on an otherwise healthy platform, and the only one whose
 * sentence has to name them.
 */
export function pinBlockedForMember(name: string): string {
  return (
    `${name} has PIN sign-in turned off on their own record, so the PIN this welcome ` +
    `describes would be refused for them. Turn it back on for ${name}, or send them a ` +
    `WhatsApp code instead.`
  );
}

/**
 * May the welcome be sent at all, right now?
 *
 * Both blocks are refusals, not warnings. A warning here would be answered by
 * pressing send anyway, and the two outcomes it guards against are silent —
 * there is no later moment at which anyone finds out.
 */
export function welcomeSendCheck(input: {
  /** The `portalUrl` setting, as stored. */
  portalUrl: string;
  /** The `defaultPinFromPhone` setting. */
  defaultPinFromPhone: boolean;
  /**
   * The `pinLoginEnabled` setting. Optional so the settings form can ask about
   * the platform before a member is in view; absent reads as ON, which is the
   * shipped default.
   */
  pinLoginEnabled?: boolean;
  /**
   * ONE MEMBER'S OWN OVERRIDE — `Person.pinLoginAllowed`. Null follows the
   * platform setting, which is why it is a tri-state rather than a boolean:
   * `false` is a decision about this person and `null` is no decision at all.
   */
  memberPinLoginAllowed?: boolean | null;
  /** For the per-member sentence. Omitted on the platform-wide check. */
  memberName?: string;
}): WelcomeSendCheck {
  const reasons: string[] = [];
  if (input.portalUrl.trim() === "") reasons.push(PORTAL_URL_MISSING);

  // THE THREE WAYS THE SIGN-IN SENTENCE CAN BE FALSE, widest first.
  //
  // Only the widest is reported: a member on a platform with PIN login off
  // does not need to be told about the phone-digit setting as well, because
  // turning that on would change nothing for them.
  const globallyOn = input.pinLoginEnabled ?? true;
  const allowedForMember = input.memberPinLoginAllowed ?? globallyOn;
  if (!allowedForMember && input.memberPinLoginAllowed === false) {
    reasons.push(pinBlockedForMember(input.memberName ?? "This member"));
  } else if (!globallyOn) {
    reasons.push(PIN_LOGIN_OFF);
  } else if (!input.defaultPinFromPhone) {
    reasons.push(DEFAULT_PIN_OFF);
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reasons, reason: reasons.join(" ") };
}

/**
 * What is wrong with an address the organizer typed, or null.
 *
 * Empty is NOT a problem here — clearing the address is a legitimate thing to
 * do, and `welcomeSendCheck` is what refuses to send with it clear. This
 * answers a narrower question: is what was typed something a member could
 * actually open?
 *
 * A bare "equb.example.com" is refused rather than repaired with a guessed
 * https://. The address goes into a message that cannot be recalled, and a
 * scheme the app invented is a guess printed as an instruction.
 */
export function portalUrlProblem(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (value.length > 200) return "That address is too long (200 characters maximum).";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "That is not a web address. It has to start with https:// — the whole address, exactly as a member would open it.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "A member's sign-in address has to be an https:// web address.";
  }
  return null;
}
