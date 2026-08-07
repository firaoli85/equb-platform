// A TYPED CONFIRMATION THAT THE SERVER ENFORCES.
//
// WHAT THE THREAT ACTUALLY IS (the organizer's ruling, August 2026).
//
// Not an attacker. There is one admin, and he owns the data. It is *him*, on a
// Sunday, tired, clicking something whose consequence he did not register — or
// a double-submit, or a stale form replayed after the page moved on. A
// confirmation that lives only in the browser does not survive any of those:
// the dialog is skipped by a retry, and a second click lands on an action that
// never asked anything.
//
// So the rule is drawn by CONSEQUENCE, not by risk of malice:
//
//   SERVER-CHECKED — the action destroys a money record that cannot be
//   rebuilt from anything else:
//     undoDraw            when payouts have been collected
//     deletePayout        when that payout has been collected
//     forgiveBalance      a real debt cleared without payment
//     deletePerson        the directory row and its sign-in history
//
//   CLIENT-ONLY — recoverable, or a real check already guards the modern path:
//     removeParticipation   the legacy path; removeFromCycle supersedes it and
//                           does check
//     updatePerson (phone)  a mistyped number is retyped in ten seconds; a
//                           server round-trip buys nothing worth the friction
//
// The distinction is deliberate and is not "how dangerous does it feel". It is
// whether an accidental click loses something the organizer cannot get back.

/**
 * Did the human type the exact phrase?
 *
 * Case- and whitespace-insensitive, because the organizer is typing a cycle
 * name from memory, not a password. Empty never passes — an omitted field is
 * the replay case this exists to stop.
 */
export function phraseConfirmed(typed: string | undefined | null, expected: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const candidate = norm(typed ?? "");
  return candidate.length > 0 && candidate === norm(expected);
}

/**
 * The refusal to show when it does not match, or null.
 *
 * `whatItDoes` is the consequence in the organizer's words — the message has
 * to be worth reading on the day he meets it, not a generic "confirmation
 * required".
 */
export function typedConfirmationRefusal(input: {
  typed: string | undefined | null;
  expected: string;
  whatItDoes: string;
}): string | null {
  if (phraseConfirmed(input.typed, input.expected)) return null;
  return (
    `Type “${input.expected}” exactly to confirm — ${input.whatItDoes} ` +
    `Nothing has been changed.`
  );
}
