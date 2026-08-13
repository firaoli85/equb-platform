import { agreementOutstanding } from "./agreement";

// WHERE ONE MEMBER STANDS ON SIGNING — the organizer's four cases, derived in
// one place so the directory chip and the profile block cannot disagree.
//
// THIS DOES NOT RE-DECIDE WHETHER A SIGNATURE IS OWED. `agreementOutstanding`
// in lib/agreement.ts is the only owner of that rule — the portal gate in
// app/me/layout.tsx and `getMemberAgreementState` both ask it — and this
// refines its boolean rather than repeating its logic (5.10: two functions
// answering one question is the same defect as none). If the ruling on the
// gate ever changes, it changes in one file and every surface follows.
//
// WHY FOUR AND NOT THREE. "Asked and never signed" and "signed, then asked
// again" are the same gate, but they are not the same sentence: only the
// second one has an earlier signature sitting there, and an organizer looking
// at it needs to be told it was against earlier terms rather than left to
// wonder why a signature he can see is not answering.

export type SigningState =
  /**
   * No welcome has been sent, so nothing has been asked for. This is the
   * ordinary state — all 27 members already mid-cycle are in it — and it is
   * NOT a missing value, a warning, or work outstanding.
   */
  | "not-asked"
  /** Asked, nothing signed. Their portal is closed until they sign. */
  | "waiting"
  /**
   * They signed, and were then asked again — a second welcome sets a later
   * `agreementRequiredAt`, so the earlier signature stops answering. That is
   * the whole "terms changed" mechanism; there is no re-sign flow.
   */
  | "waiting-again"
  /** Signed, against the requirement in force. */
  | "signed";

/**
 * A Date from Prisma, or the ISO string an action serialises one into.
 *
 * Both call sites feed this — the directory reads rows, the profile reads
 * `getMemberAgreementState` — and normalising HERE is one conversion instead
 * of two written by hand at two boundaries, which is the shape a mismatch
 * hides in.
 */
type Moment = Date | string | null | undefined;

function asDate(value: Moment): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

export function signingState(input: { requiredAt: Moment; signedAt: Moment }): SigningState {
  const requiredAt = asDate(input.requiredAt);
  const signedAt = asDate(input.signedAt);
  // SENDING THE WELCOME IS WHAT REQUIRES A SIGNATURE (organizer ruling). No
  // welcome, no requirement — asked before any signature is considered, so a
  // stray signature can never make an ungated member look gated.
  if (requiredAt === null) return "not-asked";
  if (!agreementOutstanding({ requiredAt, lastSignedAt: signedAt })) return "signed";
  return signedAt === null ? "waiting" : "waiting-again";
}
