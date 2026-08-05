"use client";

import { useState } from "react";
import { prepareBatch, sendBatch } from "@/app/actions/messages";
import { DEFAULT_TEMPLATES, MANUAL_MESSAGE_KEYS, type MessageKey } from "@/lib/messages";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { Alert, buttonCls, Card, CardHeader, Pill } from "@/components/ui/primitives";

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
  | { status: "FAILED"; body: string; error: string }
  | { status: "SKIPPED"; reason: string };

export function ComposeSend() {
  const [key, setKey] = useState<MessageKey>(MANUAL_MESSAGE_KEYS[0]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"prepare" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Map<string, Outcome> | null>(null);

  async function handlePrepare() {
    setBusy("prepare");
    setError(null);
    setOutcomes(null);
    setRows(null);
    try {
      const result = await prepareBatch({ key });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows(result.data.rows);
      setNote(result.data.note);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
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

  function handleSend() {
    if (checkedRows.length === 0 || busy) return;
    setConfirm({
      title: `Send ${checkedRows.length} WhatsApp message${checkedRows.length === 1 ? "" : "s"} now?`,
      destructive: false,
      body: (
        <p>
          Each member receives exactly the text previewed on their row. The server re-checks
          opt-outs and hardship at send time, and every send lands in the message log (2.20).
        </p>
      ),
      confirmLabel: `Send ${checkedRows.length} message${checkedRows.length === 1 ? "" : "s"}`,
    });
  }

  async function doSend() {
    setBusy("send");
    setError(null);
    try {
      const result = await sendBatch({
        key,
        participationIds: checkedRows.map((r) => r.participationId),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOutcomes(new Map(result.data.results.map((r) => [r.participationId, r.outcome])));
    } catch {
      setError("Could not reach the server — check the message log before retrying.");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const sentCount = outcomes
    ? [...outcomes.values()].filter((o) => o.status === "SENT").length
    : 0;

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
                setError(null);
              }}
              disabled={busy !== null}
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
            disabled={busy !== null}
            className={buttonCls.secondary}
          >
            {busy === "prepare" ? "Preparing…" : "Prepare — show who gets what"}
          </button>
        </div>

        {error && <Alert kind="err">{error}</Alert>}

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
                        disabled={r.blocked !== null || busy !== null || outcomes !== null}
                        onChange={() => toggle(r.participationId)}
                        className="mt-1 h-4 w-4"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            {r.nameAmharic}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-500">
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

            {outcomes === null ? (
              rows.length > 0 && (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy !== null || checkedRows.length === 0}
                  className={buttonCls.primary}
                >
                  {busy === "send"
                    ? "Sending…"
                    : `Send ${checkedRows.length} message${checkedRows.length === 1 ? "" : "s"} on WhatsApp`}
                </button>
              )
            ) : (
              <Alert kind={sentCount === checkedRows.length ? "ok" : "info"}>
                {sentCount} of {checkedRows.length} sent. Details above and in the message log
                below.
              </Alert>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        spec={confirm}
        busy={busy === "send"}
        onConfirm={() => void doSend()}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
