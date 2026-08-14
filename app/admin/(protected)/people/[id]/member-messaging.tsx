"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  resendWelcome,
  sendToMember,
  type MemberMessagingView,
} from "@/app/actions/member-messaging";
import { Card, CardHeader, EmptyState, Pill } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { TruncationNotice } from "@/components/ui/pager";
import { CAPS, truncationNotice } from "@/lib/paging";

// The re-send's slot key in the shared save state. Not a MessageKey on
// purpose: the ordinary rows map over view.types, so this can never collide
// with — or accidentally render as — one of them.
const RESEND_WELCOME = "RESEND_WELCOME";

/** "on August 10, 2026" — the requirement moment, in the organizer's clock. */
function welcomedOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// SEND ONE MESSAGE TO ONE MEMBER, FROM THEIR OWN PAGE.
//
// The shape follows what the organizer is actually doing: he is looking at
// someone who is behind, and the question is "what can I send her, and what
// would it say". So the applicable types are listed with their REAL rendered
// text already visible — not behind a preview button — because reading them
// IS the decision. The ones that do not apply stay on screen with the reason,
// since a type that silently disappears looks like a missing feature.

export function MemberMessaging({
  view,
  personName,
}: {
  view: MemberMessagingView;
  personName: string;
}) {
  const router = useRouter();

  // ONE SLOT, KEYED TO THE ROW IT BELONGS TO (UI_STANDARDS rule 6).
  //
  // What was here was a hand-rolled `{ key, status, reason }`. Its PLACEMENT
  // was already right — the sentence rendered beside the button that was
  // pressed, not in a banner at the top of the card — but it wore
  // role="status" on EVERY outcome, so a screen reader announced "Not sent —
  // she is marked as receiving no messages" politely, in the same queue as a
  // success, behind whatever was already being read. SaveState carries that
  // distinction for the whole platform: `err` renders role="alert" and never
  // auto-clears, `ok` fades.
  //
  // The KEY stays, because there is one control per type and one state for
  // the card. Without it the closing statement's confirmation would also
  // render under the late notice's button — the page banner in miniature.
  const [save, setSave] = useState<{ key: string; state: SaveState } | null>(null);
  /** DERIVED, never a second flag (2.14): which row is mid-send, if any. */
  const sendingKey = save?.state.kind === "saving" ? save.key : null;

  // THREE OUTCOMES ONTO TWO KINDS, AND THE LINE IS "DID ANYTHING LEAVE".
  //
  // A send ends in one of three places: SENT, ACCEPTED (Twilio has it and has
  // confirmed nothing), or SKIPPED/FAILED. SaveState has two kinds, and they
  // are not "good news" and "bad news": `err` is the reason something DID NOT
  // HAPPEN, so it is announced as an alert and stays until he acts on it
  // (rule 6b); `ok` fades, because the screen behind it already shows the new
  // truth. The honest split is therefore the one compose-send.tsx already
  // draws for the batch — SENT and ACCEPTED both LEFT and are counted
  // together as handed to WhatsApp; SKIPPED and FAILED left nothing and are
  // the two he has to do something about.
  //
  // A SKIPPED MEMBER IS THEREFORE NEVER REPORTED AS MESSAGED: nothing went,
  // so the row says so in red, in the engine's own words, and stays saying it.
  //
  // ACCEPTED IS NOT FLATTENED INTO SENT. It shares the kind and keeps its own
  // sentence, because the difference is carried by the WORDS: this screen once
  // said "Sent." for anything Twilio accepted — and Twilio accepts with
  // 201/"queued" before it knows anything — so ten messages were reported as
  // delivered while Twilio's own records showed all ten failed with 63112.
  // Nothing below calls an ACCEPTED message delivered. Its lasting record is
  // the history row further down, which keeps the neutral "Accepted" pill for
  // good, so the fact outlives the confirmation that fades.
  async function send(key: string) {
    if (!view.participationId) return;
    setSave({ key, state: { kind: "saving" } });
    try {
      // The re-send is its own ACTION, not a flag on the ordinary one — its
      // server precondition is the mirror image (refused UNLESS already
      // welcomed), so neither path can be reached by mistaking it for the
      // other. It shares this helper because the four beats are identical.
      const outcome =
        key === RESEND_WELCOME
          ? await resendWelcome({ participationId: view.participationId })
          : await sendToMember({ participationId: view.participationId, key });
      if (!outcome.ok) {
        setSave({ key, state: { kind: "err", message: `Not sent — ${outcome.error}` } });
        return;
      }
      const { status, reason } = outcome.data;
      // THE CLOCK TIME IS LOAD-BEARING, NOT DECORATION. SaveButton remembers
      // the message it has already faded out and will not show that exact
      // string again — so a second send of the same type to the same member
      // would confirm NOTHING, on the one screen whose job is answering "have
      // I already chased her this week?". The time is also the fact he wants:
      // every other line on this card is stamped with one.
      const at = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      });
      setSave({
        key,
        state:
          status === "SENT"
            ? { kind: "ok", message: `Delivered to ${personName} at ${at}.` }
            : status === "ACCEPTED"
              ? {
                  kind: "ok",
                  message: `Handed to WhatsApp at ${at} — delivery to ${personName} is not confirmed yet.`,
                }
              : { kind: "err", message: `Not sent — ${reason ?? "no reason given."}` },
      });
      // BEAT 3 IS TWO THINGS: say it happened, AND let the screen take on the
      // new truth. The inline confirmation beside the button is exemplary, but
      // "Already sent to them" below is a SERVER prop read at page load, and
      // nothing here or in the action revalidated it — so the message just
      // sent was absent from the very list that exists to answer "have I
      // already chased them this week?". Send twice and neither appeared.
      //
      // Every other client component in this folder already does this; this
      // was the one that did not.
      router.refresh();
    } catch {
      // 6b IS OWED BY THE PATH NOBODY TESTS. A rejected action used to leave
      // `sendingKey` set forever and no sentence at all: the button read
      // "Sending…" until the page was reloaded, which is indistinguishable
      // from a send still in flight.
      setSave({
        key,
        state: {
          kind: "err",
          message: "Could not reach the server — nothing was sent. Check the list below and try again.",
        },
      });
    }
  }

  const applicable = view.types.filter((t) => t.applicable);
  const notApplicable = view.types.filter((t) => !t.applicable);
  // The action renders the welcome's preview even once it stops being
  // applicable, precisely so the re-send card can show the text a second
  // send would carry.
  const welcomePreview =
    view.types.find((t) => t.key === "WHATSAPP_WELCOME")?.preview ?? null;

  return (
    <div className="space-y-4">
      {/* THIS CARD USED TO SWALLOW THE WHOLE SCREEN THE DAY IT WAS NEEDED MOST.
          `participationId` was the id of an ACTIVE participation in an ACTIVE
          cycle, so the moment the cycle closed it went null and this replaced
          the send card entirely — on exactly the day 2.18 says every member
          gets a closing statement. It now means what it says: this person has
          no participation anywhere, in a running cycle or a closed one whose
          records are still here, so there is genuinely nothing to state. */}
      {view.participationId === null ? (
        <Card className="px-5 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {personName} is not in a cycle — not the running one, and not a closed one whose
            records are still here. A statement states where a member stands in a cycle (2.21),
            so there is nothing to send. Anything already sent to them is still listed below.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={`Send ${personName} a statement`}
              sub="Their real figures, rendered now. Nothing leaves until you press send (2.20)."
            />
            <div className="space-y-3 px-5 pb-5">
              {applicable.length === 0 ? (
                // THE OLD HINT WAS A GUESS THAT COULD BE FALSE. "is current,
                // and their number has not been drawn" was written when the
                // list could empty for a dozen ordinary reasons. It cannot any
                // more: a member of a cycle can always be sent the closing
                // statement (2.18), so an empty list means the person is
                // blocked outright — no phone, or "no messages" (2.28). Naming
                // the wrong cause is worse than naming none, so this points at
                // the reasons instead of inventing one.
                <EmptyState
                  title="Nothing can be sent right now."
                  hint={`Every type is blocked for ${personName}. The reason is on each one below.`}
                />
              ) : (
                applicable.map((type) => (
                  <div
                    key={type.key}
                    className="rounded-xl border border-gray-200 dark:border-gray-800"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                        {type.label}
                      </h3>
                      {type.chasing && <Pill tone="attention">chases for money</Pill>}
                    </div>
                    {/* WHY THIS ONE IS HERE — above the preview, because it
                        changes how the preview reads. "No payment recorded at
                        all" is what turns the dash in "last payment week —"
                        from a glitch into a fact, and the welcome's note is
                        the consequence of pressing the button underneath it. */}
                    {type.note !== null && (
                      <p className="mx-4 mt-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        {type.note}
                      </p>
                    )}
                    {/* The real text, not a description of it. */}
                    <p className="mx-4 mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-800 dark:bg-white/5 dark:text-gray-200">
                      {type.preview}
                    </p>
                    {/* THE CONTROL AND ITS FEEDBACK ARE ONE THING. There is
                        nowhere else to put this sentence, which is the whole
                        reason it is a SaveButton and not a button plus a
                        paragraph somebody has to remember to place beside it
                        (UI_STANDARDS rule 6). A refusal now announces itself
                        as an alert rather than waiting politely in line.

                        The state is handed over only for THIS row; every other
                        row is idle, so one send never speaks for another. */}
                    <SaveButton
                      className="px-4 py-3"
                      state={save !== null && save.key === type.key ? save.state : { kind: "idle" }}
                      onSave={() => void send(type.key)}
                      // Only clear what is still the settled message. A second
                      // row can be started while this one's confirmation is on
                      // screen, and a blind `setSave(null)` six seconds later
                      // would wipe THAT row's "Sending…" mid-flight — the
                      // button would re-enable and invite a duplicate send.
                      onStateSettled={() =>
                        setSave((current) =>
                          current !== null && current.key === type.key && current.state.kind === "ok"
                            ? null
                            : current,
                        )
                      }
                      label={`Send this to ${personName}`}
                      savingLabel="Sending…"
                      disabled={sendingKey !== null && sendingKey !== type.key}
                    />
                  </div>
                ))
              )}
            </div>
          </Card>

          {notApplicable.length > 0 && (
            <Card>
              <CardHeader
                title="Not applicable right now"
                sub="Kept on screen with the reason — a type that simply vanishes looks like a missing feature."
              />
              <ul className="border-t border-gray-100 dark:border-gray-800/60">
                {notApplicable.map((type) => (
                  <li
                    key={type.key}
                    className="border-b border-gray-100 px-5 py-3 last:border-b-0 dark:border-gray-800/60"
                  >
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {type.label}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{type.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* SEND THE WELCOME AGAIN — the deliberate second send, its own card.
              Appears only once a welcome HAS been sent, which is exactly when
              the ordinary list stops offering it: between them the two
              controls cover every state and never overlap. Separate from the
              primary send because its consequence is different in kind — the
              others deliver a statement; this one re-locks a portal — and a
              consequence like that must be read where it is pressed, not
              inferred from a button that looks like all the rest. */}
          {view.welcomeSentAt !== null && (
            <Card>
              <CardHeader
                title="Send the welcome again"
                sub={`Last sent ${welcomedOn(view.welcomeSentAt)}.`}
              />
              <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800/60">
                <p className="text-sm text-gray-700 dark:text-gray-300 text-pretty">
                  Sending it again asks {personName} to read and sign their agreement on the{" "}
                  <span className="font-semibold">current terms</span> — their earlier signature
                  stops counting, and the portal stays closed to them until they sign. Use it
                  after changing their commitment, so what they signed matches what they are in.
                  There is no un-send.
                </p>
                {/* The exact text a second send carries — reading it IS the
                    decision (2.20), same as every card above. */}
                {welcomePreview !== null && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-800 dark:bg-white/5 dark:text-gray-200">
                    {welcomePreview}
                  </p>
                )}
                <SaveButton
                  className="mt-3"
                  state={
                    save !== null && save.key === RESEND_WELCOME ? save.state : { kind: "idle" }
                  }
                  onSave={() => void send(RESEND_WELCOME)}
                  onStateSettled={() =>
                    setSave((current) =>
                      current !== null &&
                      current.key === RESEND_WELCOME &&
                      current.state.kind === "ok"
                        ? null
                        : current,
                    )
                  }
                  label={`Send the welcome to ${personName} again`}
                  savingLabel="Sending…"
                  disabled={sendingKey !== null && sendingKey !== RESEND_WELCOME}
                />
              </div>
            </Card>
          )}
        </>
      )}

      {/* WHAT WAS LAST SENT, AND WHEN — before sending again. Without it the
          organizer has no way to tell whether he already chased this member
          this week, and the honest answer to that is on the Messages screen
          three clicks away. */}
      <Card>
        <CardHeader
          title="Already sent to them"
          sub="Every message this member has received, automatic or manual. Append-only."
        />
        {view.history.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="Nothing has been sent to them yet."
              hint="Anything sent from here or from the batch appears in this list."
            />
          </div>
        ) : (
          <>
            <ul className="border-t border-gray-100 dark:border-gray-800/60">
              {view.history.map((entry) => (
                <li
                  key={entry.id}
                  className="border-b border-gray-100 px-5 py-3 last:border-b-0 dark:border-gray-800/60"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                      {entry.templateKey}
                    </span>
                    <Pill tone={entry.trigger === "AUTOMATIC" ? "accent" : "neutral"}>
                      {entry.trigger === "AUTOMATIC" ? "Automatic" : "Manual"}
                    </Pill>
                    {/* ACCEPTED is neither good nor a problem — it is unknown,
                        so it must not wear the green that means delivered nor
                        the red that means refused. */}
                    <Pill
                      tone={
                        entry.status === "SENT"
                          ? "good"
                          : entry.status === "ACCEPTED"
                            ? "neutral"
                            : "problem"
                      }
                    >
                      {entry.status === "SENT"
                        ? "Delivered"
                        : entry.status === "ACCEPTED"
                          ? "Accepted"
                          : entry.status}
                    </Pill>
                    <span className="ml-auto text-xs tabular-nums text-gray-600 dark:text-gray-400">
                      {new Date(entry.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                    {entry.body}
                  </p>
                  {entry.error && (
                    <p className="mt-1 text-xs text-red-700 dark:text-red-400">{entry.error}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-5 pb-4">
              <TruncationNotice
                notice={truncationNotice({
                  shown: view.history.length,
                  cap: CAPS.memberMessages,
                  noun: "messages",
                  fullListAt: "the Messages screen",
                })}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
