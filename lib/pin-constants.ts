// A PIN IS FOUR DIGITS. EVERYWHERE, AT EVERY MOMENT.
//
// This module briefly carried two lengths — four for setting, up to eight at
// the login door — because the platform had accepted 4-to-8-digit PINs and
// nothing stored said who held which. A bcrypt hash is fixed-width whatever it
// hashed, so the long ones could not be found and migrated, and applying one
// rule everywhere would have locked those members out.
//
// That is resolved, by removing the reason rather than working around it:
// every member's PIN was reset to the last four digits of their own phone
// (scripts/reset-pins-to-phone-default.mts, 28 of 28 verified). The six longer
// hashes were the organizer's test data — no member had been sent the portal
// link, so no member had ever chosen a PIN. There is no longer any PIN in the
// system that is not four digits, so there is no longer a second rule.
//
// It lives here rather than in lib/pin.ts so the login pad — a client
// component — can read it without pulling bcryptjs into the browser bundle.
// `lib/client-bundle-safety.test.ts` exists to catch exactly that.

/** A PIN is exactly this many digits. Setting one, and typing one. */
export const PIN_LENGTH = 4;
