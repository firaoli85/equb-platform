// THE TWO PIN LENGTHS, IN A MODULE A CLIENT COMPONENT CAN IMPORT.
//
// These live here rather than in lib/pin.ts for the same reason
// `defaultPinForPhone` lives in lib/phone.ts: lib/pin.ts imports bcryptjs, and
// the login pad is a client component. Importing the constants from there
// would pull the whole hashing library into the browser bundle to read two
// numbers. `lib/client-bundle-safety.test.ts` exists to catch exactly that.
//
// WHY THERE ARE TWO. The platform accepted 4-to-8-digit PINs for months and
// members are signed in right now with PINs somewhere in that range. Nothing
// stored says which — a bcrypt hash is fixed-width whatever it hashed, and no
// audit row records a chosen length — so the long ones cannot be found and
// migrated. A single 4-digit rule everywhere would lock those members out of
// their own money.
//
//   SETTING a PIN  →  NEW_PIN_LENGTH. Exactly four, every path, every screen.
//   SIGNING IN     →  no length rule; the pad must merely be able to TYPE up
//                     to LEGACY_PIN_MAX so an existing PIN stays reachable.
//
// A migration with no migration: everyone converges on four the next time they
// change it, and nobody is stranded meanwhile.

/** A new PIN is exactly this many digits. */
export const NEW_PIN_LENGTH = 4;

/**
 * The longest PIN the login pad must still be able to enter.
 *
 * Not a statement about what is valid — bcrypt decides that by comparing
 * against the stored hash — but about not shipping a pad that physically
 * cannot type a PIN somebody already has.
 */
export const LEGACY_PIN_MAX = 8;
