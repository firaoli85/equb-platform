// lib/phone.ts only — this module is imported by a CLIENT component, and
// lib/pin.ts pulls in bcryptjs.
import { canonicalPhone, defaultPinForPhone, phoneDigits } from "./phone";

// THE TWO WAYS A PERSON'S RECORD CAN SURPRISE THE ORGANIZER.
//
// Both were found by auditing what each confirmation SAYS against what its
// action DOES.
//
//   1. Editing the phone is a CREDENTIAL CHANGE. The phone is the member's
//      sign-in identity on every door (PIN, WhatsApp code, Firebase SMS all
//      resolve the person through findPeopleByPhone), and when they have no
//      PIN of their own it is also their PIN — the last four digits, derived
//      at check time. The form said nothing; the toast said "✓ Saved."
//
//   2. "Remove from directory" listed two blockers and the database enforces
//      three. Message history is append-only by design, so a person who has
//      ever been messaged — or for whom a send merely FAILED, since failures
//      are logged too — can never be deleted, and nothing in the product
//      says so before the button is pressed.
//
// Both are computed here, pure and tested, so the words the organizer reads
// are derived from the same facts the server acts on.

// ————————————————————————— 1. The phone —————————————————————————

/** Whether this person's PIN is their own, derived from the phone, or absent. */
export type PinState = "own" | "default" | "none";

export type PhoneChange = {
  /** True when the digits actually moved — formatting alone does not count. */
  changed: boolean;
  /** True when the change leaves them with no number at all. */
  locksOut: boolean;
  /** The PIN they will have afterwards, when it is derived from the phone. */
  newDefaultPin: string | null;
  /** What to put in the confirmation, or null when nothing is at stake. */
  consequence: string | null;
};

/**
 * What changing this person's phone number actually does to their sign-in.
 *
 * Formatting edits are deliberately silent: `canonicalPhone` normalises a
 * 10-digit number, an 11-digit 1-prefixed number and any punctuation to the
 * same value, so adding dashes or "+1" changes neither who matches nor the
 * last-four default. Warning about those would train the organizer to click
 * through the warning that matters.
 */
export function phoneChange(args: {
  name: string;
  before: string | null;
  after: string | null;
  pinState: PinState;
}): PhoneChange {
  const before = args.before?.trim() || null;
  const after = args.after?.trim() || null;
  // Canonical on both sides, so a number with no digits at all is the same
  // as no number: neither one signs anybody in, and moving between them
  // changes nothing worth stopping for.
  if (canonicalPhone(before ?? "") === canonicalPhone(after ?? "")) {
    return { changed: false, locksOut: false, newDefaultPin: null, consequence: null };
  }

  const locksOut = phoneDigits(after ?? "").length === 0;
  if (locksOut) {
    return {
      changed: true,
      locksOut: true,
      newDefaultPin: null,
      consequence:
        `Clearing the phone signs ${args.name} out of the product for good. Their number is ` +
        `how every door finds them — PIN, WhatsApp code and SMS all look them up by it — so ` +
        `with the box empty none of the three can. Nothing tells them; they simply stop being ` +
        `recognised.`,
    };
  }

  const newDefaultPin = args.pinState === "default" ? defaultPinForPhone(after) : null;
  const identity =
    `${args.name} signs in with their phone number, so the old one stops working the moment ` +
    `this is saved.`;
  return {
    changed: true,
    locksOut: false,
    newDefaultPin,
    consequence: newDefaultPin
      ? `${identity} They have no PIN of their own, so their PIN changes too — it becomes ` +
        `${newDefaultPin}, the last 4 digits of the new number. Nothing tells them that either.`
      : identity,
  };
}

// ————————————————— 2. Removing someone from the directory —————————————————

export type PersonRemovalFacts = {
  name: string;
  participationCount: number;
  ledgerEntryCount: number;
  carriedBalance: number;
  /** Messages sent OR attempted — a failed send is logged too. */
  messageCount: number;
  /** Sign-in history rows, which the delete takes with it. */
  sessionCount: number;
};

export type RemovalBlocker = {
  /** Why the removal is refused, in the organizer's words. */
  reason: string;
  /** Whether anything they can do would clear it. */
  clearable: boolean;
};

/**
 * Every reason the database will refuse this delete — all three, in the order
 * the server checks them.
 *
 * The message-history blocker is `clearable: false` on purpose: MessageLog is
 * append-only by design (2.14), so there is no action anywhere that clears it.
 * Saying "remove the messages first" would send the organizer looking for a
 * button that does not and should not exist.
 */
export function personRemovalBlockers(f: PersonRemovalFacts): RemovalBlocker[] {
  const blockers: RemovalBlocker[] = [];
  if (f.participationCount > 0) {
    blockers.push({
      reason:
        `${f.name} is in ${f.participationCount} cycle${f.participationCount === 1 ? "" : "s"}. ` +
        `Take them out of ${f.participationCount === 1 ? "it" : "those"} first.`,
      clearable: true,
    });
  }
  if (f.ledgerEntryCount > 0) {
    blockers.push({
      reason:
        `${f.name} has a carried-balance record, which is kept whatever happens to cycles ` +
        `(2.18). Paying it off or writing it off does NOT clear this — the entries stay as ` +
        `the history of what was owed.`,
      clearable: false,
    });
  }
  if (f.messageCount > 0) {
    blockers.push({
      reason:
        `${f.messageCount} message${f.messageCount === 1 ? " has" : "s have"} been sent to ` +
        `${f.name}, or attempted. The message log is append-only, so nothing can clear this.`,
      clearable: false,
    });
  }
  return blockers;
}

/** Can this person actually be removed? */
export function canRemovePerson(f: PersonRemovalFacts): boolean {
  return personRemovalBlockers(f).length === 0;
}

/**
 * What the delete takes with it that the dialog never mentioned, and what it
 * deliberately keeps.
 */
export function personRemovalConsequences(f: PersonRemovalFacts): string[] {
  const lines: string[] = [];
  if (f.sessionCount > 0) {
    lines.push(
      `Their sign-in history goes too — all ${f.sessionCount} device and IP ` +
        `record${f.sessionCount === 1 ? "" : "s"} for ${f.name}. That is the record that answers ` +
        `"was that really them?" months later, and it cannot be recovered.`,
    );
  }
  lines.push(
    `Their name stays in the audit log. Entries written before today name ${f.name} and are ` +
      `never rewritten — the removal is from the directory, not from the history.`,
  );
  return lines;
}
