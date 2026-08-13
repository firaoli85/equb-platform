"use client";

import { useState } from "react";
import { prepareBatch, sendBatch } from "@/app/actions/messages";
import { DEFAULT_TEMPLATES, MANUAL_MESSAGE_KEYS, type MessageKey } from "@/lib/messages";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { buttonCls, Card, CardHeader, Pill } from "@/components/ui/primitives";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";

// The manual send flow (2.20): pick a type → the system PREPARES (who is
// suggested, the real rendered text each would get, who is excluded and
// why) → the organizer unchecks anyone → presses send. Nothing leaves
// before the send press, and the server re-renders and re-checks hardship
// at send time regardless of what this UI submits.

type Row = {
  participationId: string;
  nameAmharic: string;
  nameEnglish: string;
  phone: string | null;
  rendered: string;
  checked: boolean;
  blocked: string | null;
};

type Outcome =
  | { status: "SENT"; body: string }
  /** Twilio has it; delivery is unconfirmed until a status callback lands. */
  | { status: "ACCEPTED"; body: string }
  | { status: "FAILED"; body: string; error: string }
  | { status: "SKIPPED"; reason: string };

export function ComposeSend() {
  const [key, setKey] = useState<MessageKey>(MANUAL_MESSAGE_KEYS[0]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [outcomes, setOutcomes] = useState<Map<string, Outcome> | null>(null);

  // TWO CONTROLS, TWO FEEDBACK SLOTS — each message renders at the button that
  // produced it (rule 6). One shared `error` string used to serve both, in a
  // banner ABOVE the recipient list: a send refusal therefore appeared far
  // above the send button, and the press read as having silently done nothing
  // — the "Send N messages on WhatsApp" row of the UI_STANDARDS 6b audit.
  const [prepare, setPrepare] = useState<SaveState>({ kind: "idle" });
  const [send, setSend] = useState<SaveState>({ kind: "idle" });
  const preparing = prepare.kind === "saving";
  const sending = send.kind === "saving";
  /** Either control working locks both. DERIVED — never a second flag. */
  const busy = preparing || sending;

  // PREPARE IS EXEMPT FROM THE SAVE SHAPE: it writes nothing, and its success
  // is the recipient list appearing directly below the button — a "✓ prepared"
  // beside it would be a second claim about the same thing. What it does owe
  // rule 6b is its REFUSAL, at the control: that is the `SaveFeedback` in the
  // button's own row, and the reason a `SaveState` is used here at all.
  async function handlePrepare() {
    setPrepare({ kind: "saving" });
    // A send summary belongs to the batch that produced it, not to a fresh one.
    setSend({ kind: "idle" });
    setOutcomes(null);
    setRows(null);
    try {
      const result = await prepareBatch({ key });
      if (!result.ok) {
        setPrepare({ kind: "err", message: `Not prepared: ${result.error}` });
        return;
      }
      setRows(result.data.rows);
      setNote(result.data.note);
      setPrepare({ kind: "idle" });
    } catch {
      setPrepare({ kind: "err", message: "Could not reach the server. Try again." });
    }
  }

  function toggle(participationId: string) {
    setRows(
      (prev) =>
        prev?.map((r) =>
          r.participationId === participationId && r.blocked === null
            ? { ...r, checked: !r.checked }
            : r,
        ) ?? null,
    );
  }

  const checkedRows = rows?.filter((r) => r.checked && r.blocked === null) ?? [];

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);

  function handleSend() {
    if (checkedRows.length === 0 || busy) return;
    // A refusal belongs to the press that produced it. Reopening the dialog is
    // a new press, so the old reason is withdrawn as it opens.
    setSend({ kind: "idle" });
    setConfirm({
      title: `Send ${checkedRows.length} WhatsApp message${checkedRows.length === 1 ? "" : "s"} now?`,
      destructive: false,
      // THIS USED TO SAY "exactly the text previewed on their row", and it
      // stopped being true the day WhatsApp moved to Meta's Content templates:
      // the SENTENCE is Meta's, fixed word for word, and only the figures in
      // it come from the preview. Promising more than that is how the
      // organizer ends up certain he sent something he did not.
      body: (
        <p>
          Each member receives Meta&apos;s approved wording for this message type, carrying
          the figures previewed on their row. The server re-checks opt-outs and hardship at
          send time, and every send lands in the message log (2.20).
        </p>
      ),
      confirmLabel: `Send ${checkedRows.length} message${checkedRows.length === 1 ? "" : "s"}`,
    });
  }

  async function doSend() {
    setSend({ kind: "saving" });
    setDialogError(null);
    try {
      const result = await sendBatch({
        key,
        participationIds: checkedRows.map((r) => r.participationId),
      });
      if (!result.ok) {
        // The send button is rendered BELOW the whole recipient list, so a
        // whole-batch refusal ("Nobody is selected", a stale winner,
        // presentation mode) in a banner above it appeared off-screen and the
        // send read as having silently done nothing (UI_STANDARDS 6b). It goes
        // in the dialog — which STAYS OPEN, never closed in a `finally` — and
        // beside the button it came back to.
        const refused = `Not sent: ${result.error}`;
        setSend({ kind: "err", message: refused });
        setDialogError(refused);
        return;
      }
      const results = result.data.results;
      const counts = { SENT: 0, ACCEPTED: 0, FAILED: 0, SKIPPED: 0 };
      for (const r of results) counts[r.outcome.status] += 1;
      setOutcomes(new Map(results.map((r) => [r.participationId, r.outcome])));
      setConfirm(null);

      // WHAT ACTUALLY HAPPENED, WITH THE FIGURES. "Handed to WhatsApp" counts
      // ACCEPTED as well as SENT because ACCEPTED is the ordinary outcome —
      // Twilio has it and has confirmed nothing — and it is never called
      // delivered here. A batch with a failure or a skip is RED and never
      // clears: a partly-sent batch is the thing he has to act on.
      const handed = counts.SENT + counts.ACCEPTED;
      const trouble = [
        counts.FAILED > 0 ? `${counts.FAILED} failed` : null,
        counts.SKIPPED > 0 ? `${counts.SKIPPED} skipped` : null,
      ].filter((s): s is string => s !== null);
      const awaiting =
        counts.ACCEPTED > 0
          ? ` ${counts.ACCEPTED} still awaiting WhatsApp's delivery confirmation.`
          : "";
      const message =
        trouble.length > 0
          ? `Sent ${handed} of ${checkedRows.length} — ${trouble.join(", ")}.${awaiting} The reason is on each row and in the message log below.`
          : `Sent ${handed} of ${checkedRows.length} on WhatsApp.${awaiting} Every one is in the message log below.`;
      setSend(trouble.length > 0 ? { kind: "err", message } : { kind: "ok", message });
    } catch {
      const refused = "Could not reach the server — check the message log before retrying.";
      setSend({ kind: "err", message: refused });
      setDialogError(refused);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Send a statement"
        sub="The system prepares and shows exactly who receives what. Nothing leaves until you press send (2.20)."
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Message type
            </span>
            <Select<MessageKey>
              value={key}
              onChange={(value) => {
                setKey(value);
                setRows(null);
                setOutcomes(null);
                setPrepare({ kind: "idle" });
                setSend({ kind: "idle" });
              }}
              disabled={busy}
              ariaLabel="Message type"
              className="w-64"
              options={MANUAL_MESSAGE_KEYS.map((k) => ({
                value: k,
                label: DEFAULT_TEMPLATES[k].name,
              }))}
            />
          </label>
          <button
            type="button"
            onClick={handlePrepare}
            disabled={busy}
            className={buttonCls.secondary}
          >
            {preparing ? "Preparing…" : "Prepare — show who gets what"}
          </button>
          {/* The refusal, in the button's own row. */}
          <SaveFeedback state={prepare} />
        </div>

        {rows !== null && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {note} {rows.length === 0 ? "Nobody matches right now." : ""}
            </p>

            {rows.length > 0 && (
              <div className="space-y-2">
                {rows.map((r) => {
                  const outcome = outcomes?.get(r.participationId);
                  return (
                    <label
                      key={r.participationId}
                      className={`flex items-start gap-3 rounded-xl border p-3 ${
                        r.blocked
                          ? "border-gray-200 dark:border-gray-800 opacity-60"
                          : "border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={r.checked}
                        disabled={r.blocked !== null || busy || outcomes !== null}
                        onChange={() => toggle(r.participationId)}
                        className="mt-1 h-4 w-4"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {r.nameAmharic}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {r.nameEnglish} {r.phone ? `· ${r.phone}` : ""}
                          </span>
                          {outcome &&
                            (outcome.status === "SENT" ? (
                              <Pill tone="good">Sent</Pill>
                            ) : outcome.status === "FAILED" ? (
                              <Pill tone="problem">Failed</Pill>
                            ) : (
                              <Pill tone="attention">Skipped</Pill>
                            ))}
                        </span>
                        <span className="mt-1 block whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-white/5 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-300">
                          {r.rendered}
                        </span>
                        {r.blocked && (
                          <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                            {r.blocked}
                          </span>
                        )}
                        {outcome && outcome.status === "FAILED" && (
                          <span className="mt-1 block text-xs text-red-700 dark:text-red-400">
                            {outcome.error}
                          </span>
                        )}
                        {outcome && outcome.status === "SKIPPED" && (
                          <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                            {outcome.reason}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* THE SEND FEEDBACK, BELOW THE WHOLE LIST — where the press was.
                While the batch can still be sent it renders at the button; once
                it has been sent the button is gone (a second press would send
                twice) and the summary keeps its place. */}
            {rows.length > 0 &&
              (outcomes === null ? (
                <SaveButton
                  state={send}
                  onSave={handleSend}
                  label={`Send ${checkedRows.length} message${checkedRows.length === 1 ? "" : "s"} on WhatsApp`}
                  savingLabel="Sending…"
                  dirty={checkedRows.length > 0}
                  disabled={preparing}
                  notDirtyHint="Nobody is ticked — nothing would be sent."
                />
              ) : (
                <SaveFeedback state={send} />
              ))}
          </>
        )}
      </div>
      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={sending}
        onConfirm={() => void doSend()}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
        }}
      />
    </Card>
  );
}
