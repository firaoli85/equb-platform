import { Card, CardHeader, Pill, type PillTone } from "@/components/ui/primitives";
import { signingState, type SigningState } from "@/lib/agreement-view";

// THE ORGANIZER'S VIEW OF SIGNING — the four facts the old app showed and this
// one must carry across: HAS THIS MEMBER SIGNED, WHEN, FROM WHAT DEVICE, and
// HAVE THEY SET THEIR OWN PIN.
//
// Server-safe: no state, no handlers, nothing to press. Both surfaces render
// from here — the chip in the directory and the block on the profile — so a
// member cannot read "Signed" in the list and something else on their page.
//
// EVERY CASE IS STATED IN WORDS, NEVER A BARE BOOLEAN. "Signed: no" is true of
// a member nobody has asked and of a member who is locked out of their portal
// waiting, and those are opposite situations for the organizer.

/**
 * What the block needs, restated rather than imported from the action.
 *
 * `MemberAgreementState` lives in app/actions/agreement.ts, which pulls in
 * Prisma; a presentational component that can be rendered in a markup test
 * without a database is worth more than the four saved lines. The link is
 * still checked: the profile passes `agreement.data` straight in, so a renamed
 * or retyped field there is a compile error at that call site.
 */
export type MemberSigningView = {
  /** ISO, or null when no welcome has ever been sent. */
  requiredAt: string | null;
  signedAt: string | null;
  version: number | null;
  /** "Chrome on Windows" — as recorded with the signature. */
  device: string | null;
  ip: string | null;
  /** Have they replaced the phone-digit PIN with one of their own? */
  hasOwnPin: boolean;
};

const CHIP: Record<SigningState, { tone: PillTone; text: string }> = {
  signed: { tone: "good", text: "Signed" },
  waiting: { tone: "attention", text: "Waiting" },
  // Still waiting, but for a different reason, and the list should say which
  // — the organizer sent the second welcome and needs to see it landed.
  "waiting-again": { tone: "attention", text: "Waiting · new terms" },
  // GATED WITHOUT HAVING BEEN ASKED — no welcome was sent; nothing has ever
  // been paid. The chip names the cause because the fix is a different one:
  // send the welcome, or record the money that arrived and was never entered.
  "waiting-unpaid": { tone: "attention", text: "Waiting · no payment yet" },
  // NEUTRAL BY RULING, NOT BY TASTE. A member nobody has asked has done
  // nothing wrong and nothing is outstanding, so this must not read as a
  // warning — an amber chip down 27 rows would invent 27 problems.
  "not-asked": { tone: "neutral", text: "Not asked" },
};

/** The compact form, for a list. */
export function SigningChip({ state }: { state: SigningState }) {
  return <Pill tone={CHIP[state].tone}>{CHIP[state].text}</Pill>;
}

/**
 * A signature is a MOMENT, not a calendar day, so it is rendered in the
 * organizer's own clock — the same way the sign-in list beside it does, rather
 * than on the UTC week calendar the money uses.
 */
function moment(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AgreementSigningCard({
  personName,
  state,
}: {
  personName: string;
  state: MemberSigningView;
}) {
  const kind = signingState({ requiredAt: state.requiredAt, signedAt: state.signedAt });
  const askedAt = state.requiredAt === null ? null : moment(state.requiredAt);
  const signedAt = state.signedAt === null ? null : moment(state.signedAt);
  const device = state.device ?? "an unrecorded device";

  return (
    <Card>
      <CardHeader
        title="Member agreement"
        sub="Whether they have signed, when, and from what device."
        right={<SigningChip state={kind} />}
      />
      <div className="space-y-3 px-5 pb-5">
        {kind === "not-asked" && (
          <>
            {/* THE SENTENCE IS THE RULING. Sending the welcome is what asks
                for a signature — there is no date comparison and no exemption
                list, so the absence of a request is not an omission to fix. */}
            <p className="text-sm text-gray-700 dark:text-gray-300">
              No agreement has been asked for. Sending the welcome is what asks for one.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {personName}&rsquo;s portal is open and nothing is owed here. Everyone already in
              the cycle is in this state.
            </p>
          </>
        )}

        {kind === "waiting" && (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Asked on {askedAt}. {personName} has not signed yet.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Their portal is closed until they sign — signing in takes them straight to the
              agreement and nowhere else.
            </p>
          </>
        )}

        {kind === "waiting-again" && (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Asked again on {askedAt}. {personName} has not signed the current terms.
            </p>
            {/* The earlier signature is visible in the record, so it has to be
                accounted for here — otherwise a signature he can see reads as
                a signature that should have counted. */}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              They signed on {signedAt}
              {state.version !== null && <> (version {state.version})</>} from {device}, but that
              signature was against earlier terms, so it no longer answers this request.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Their portal is closed until they sign the current terms.
            </p>
          </>
        )}

        {kind === "signed" && (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {personName} signed on {signedAt}.
            </p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Version
                </dt>
                <dd className="tabular-nums text-gray-900 dark:text-white">
                  {state.version === null ? "—" : state.version}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Device
                </dt>
                <dd className="text-gray-900 dark:text-white">{device}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  IP address
                </dt>
                {/* Corroborating detail, never identity — carriers share
                    addresses, which is why it sits beside the device rather
                    than standing on its own. */}
                <dd className="tabular-nums text-gray-900 dark:text-white">{state.ip ?? "—"}</dd>
              </div>
            </dl>
            {askedAt !== null && (
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Asked on {askedAt}. The document is always live, so changing their terms and
                sending the welcome again asks for a fresh signature.
              </p>
            )}
          </>
        )}

        {/* THE PIN IS A FACT, NOT A WARNING (ruling: the prompt stays
            skippable and is never forced). A member who skipped it has done
            nothing wrong, so this states what is true and points at the
            control below rather than colouring the sentence. */}
        <p className="border-t border-gray-100 pt-3 text-sm text-gray-700 dark:border-gray-800/60 dark:text-gray-300">
          {state.hasOwnPin ? (
            <>{personName} has set their own PIN.</>
          ) : (
            <>
              {personName} has not set their own PIN. The prompt to set one is skippable, so
              skipping it is a choice rather than a fault — PIN sign-in below is where one can
              be set for them.
            </>
          )}
        </p>
      </div>
    </Card>
  );
}
