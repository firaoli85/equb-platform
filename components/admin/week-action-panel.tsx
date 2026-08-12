"use client";

import { useEffect, useState } from "react";
import { deletePaymentEvent, setWeekDeferral, setWeekNote } from "@/app/actions/edits";
import { previewAllocation, recordPayment } from "@/app/actions/payments";
import { getCellDetail } from "@/app/actions/payments-view";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { AmountInput, Select } from "@/components/ui/controls";
import { Alert, buttonCls, Pill } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import { describeAllocation } from "@/lib/payments-view";
import { DEFERRED_PHRASE, SKIPPED_PHRASE } from "@/lib/status-labels";

// THE one per-week action panel (2.19: one way to do each thing). Used by the
// payments Members view, the payments Grid, and the member profile — so
// "record", "partial", "defer", "undo" behave identically everywhere.
//
// PARTIAL is first-class: the amount is prefilled to this week's remaining due
// and is editable, so "Getahun paid $400 toward week 14" is one edit away.
// The engine is unchanged (2.15 oldest-debt-first) — when the money would land
// on an EARLIER week than the one clicked, the preview says so in plain words
// before anything commits.

type Method = "ZELLE" | "CASH" | "OTHER";

export type WeekTarget = {
  participationId: string;
  memberName: string;
  weekNumber: number;
  amountDue: number;
  amountAlreadyPaid: number;
  isDeferred: boolean;
};

type Detail = {
  isDeferred: boolean;
  weekIsSkipped: boolean;
  note: string;
  receipts: {
    eventId: string;
    appliedHere: number;
    eventAmount: number;
    method: string | null;
    receivedAt: string;
  }[];
};

export function WeekActionPanel({
  target,
  onSaved,
  onClose,
}: {
  target: WeekTarget;
  /** Fires after any successful change — the host refreshes and shows this. */
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const remaining = Math.max(0, target.amountDue - target.amountAlreadyPaid);

  const [dollars, setDollars] = useState(remaining > 0 ? String(remaining / 100) : "");
  const [method, setMethod] = useState<Method>("ZELLE");
  const [notes, setNotes] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<{
    text: string;
    amount: number;
    landsEarlier: number[];
    coversThisWeek: number;
  } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | "week" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  // A fresh idempotency key per submission intent, re-armed after each save,
  // so a double-click cannot double-pay.
  const [keyNonce, setKeyNonce] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, [keyNonce]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    getCellDetail({
      participationId: target.participationId,
      weekNumber: target.weekNumber,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDetail(result.data);
        setNote(result.data.note);
      } else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [target.participationId, target.weekNumber]);

  const amount = parseDollarsToCents(dollars);
  const amountValid = amount !== null && amount >= 1;
  const isPartial = amountValid && amount! < remaining;
  const previewValid = preview !== null && preview.amount === amount;

  function resetPreview() {
    setPreview(null);
    setError(null);
    setOk(null);
  }

  async function handlePreview() {
    if (!amountValid) return;
    setBusy("preview");
    setError(null);
    setOk(null);
    try {
      const result = await previewAllocation({
        participationId: target.participationId,
        amount: amount!,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.allocations.length === 0 || result.data.unallocated > 0) {
        setPreview(null);
        setError(
          result.data.allocations.length === 0
            ? `Nothing to record — ${target.memberName}'s weeks are already covered.`
            : `Only ${formatMoney(result.data.totalApplied)} fits their remaining weeks — the rest would land nowhere, so the whole payment would be refused. Reduce the amount.`,
        );
        return;
      }
      setPreview({
        text: describeAllocation(result.data),
        amount: amount!,
        landsEarlier: result.data.allocations
          .filter((a) => a.weekNumber < target.weekNumber)
          .map((a) => a.weekNumber),
        coversThisWeek:
          result.data.allocations.find((a) => a.weekNumber === target.weekNumber)?.applied ?? 0,
      });
    } catch {
      setError("Could not reach the server — nothing was previewed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCommit() {
    if (!previewValid || !idempotencyKey) return;
    setBusy("save");
    setError(null);
    try {
      const result = await recordPayment({
        participationId: target.participationId,
        amount: preview!.amount,
        method,
        idempotencyKey,
        notes: notes.trim() || `Toward week ${target.weekNumber}`,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const where = describeAllocation({ allocations: result.data.allocations, unallocated: 0 });
      const message = `Recorded ${formatMoney(result.data.totalApplied)} for ${target.memberName} — ${where}.`;
      // KEEP IT HERE TOO, not only in the parent. Every caller of this panel
      // closed it on save and rendered the confirmation at the top of its own
      // screen — the top of a 27×20 grid, or of a long member page. The cell
      // he clicked was nowhere near it (§2.10, rule 6 beat 3).
      setOk(message);
      onSaved(`✓ ${message}`);
      setPreview(null);
      setKeyNonce((n) => n + 1);
    } catch {
      setError(
        "Could not reach the server — the payment was NOT confirmed. Check their weeks before entering it again.",
      );
    } finally {
      setBusy(null);
    }
  }

  /** `fn` returns its refusal, or nothing on success (UI_STANDARDS 6b). */
  function ask(spec: ConfirmSpec, fn: () => Promise<string | null | void>) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void (async () => {
        setBusy("week");
        let refused: string | null = null;
        try {
          const reported = await fn();
          if (typeof reported === "string" && reported.length > 0) refused = reported;
        } finally {
          setBusy(null);
          // CLOSE ONLY ON SUCCESS. This used to close whatever happened, so a
          // refusal was thrown away with the dialog that could have shown it
          // (UI_STANDARDS 6b).
          if (refused === null) {
            setConfirm(null);
            setOnConfirm(null);
          } else {
            setDialogError(refused);
          }
        }
      })();
    });
  }

  function toggleDeferral() {
    if (!detail) return;
    const next = !detail.isDeferred;
    ask(
      {
        title: next
          ? `Defer week ${target.weekNumber} for ${target.memberName}?`
          : `Remove the deferral on week ${target.weekNumber}?`,
        destructive: false,
        body: next ? (
          <>
            <p>
              <strong>Deferring does not cancel the debt.</strong> {target.memberName} still owes{" "}
              {formatMoney(target.amountDue)} for week {target.weekNumber}; it still counts in
              their overdue total and their weeks behind. What changes is that the week
              stops reading LATE and they drop out of the chasing messages.
            </p>
            <p>An audit entry records the decision.</p>
          </>
        ) : (
          <>
            <p>
              Week {target.weekNumber} goes back to being chased. The {formatMoney(target.amountDue)}{" "}
              was owed all along — this only lets it read LATE again and puts{" "}
              {target.memberName} back in the reminders.
            </p>
            <p>An audit entry records the decision.</p>
          </>
        ),
        confirmLabel: next ? `Defer week ${target.weekNumber}` : "Chase it again",
      },
      async () => {
        const result = await setWeekDeferral({
          participationId: target.participationId,
          weekNumber: target.weekNumber,
          deferred: next,
        });
        if (!result.ok) setError(result.error);
        else
          onSaved(
            next
              ? `✓ Week ${target.weekNumber} deferred — not chased, still owed.`
              : `✓ Deferral removed — week ${target.weekNumber} is chased again.`,
          );
      },
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 bg-white dark:bg-[#141414] p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-black text-gray-900 dark:text-white">
          {target.memberName} — week {target.weekNumber}
        </h3>
        {detail?.weekIsSkipped ? (
          <Pill tone="neutral">{SKIPPED_PHRASE}</Pill>
        ) : remaining > 0 ? (
          <>
            <Pill tone="attention">{formatMoney(remaining)} still due</Pill>
            {detail?.isDeferred && <Pill tone="attention">{DEFERRED_PHRASE}</Pill>}
          </>
        ) : (
          <Pill tone="good">Settled</Pill>
        )}
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={toggleDeferral}
            disabled={busy !== null || !detail || detail.weekIsSkipped}
            title={
              detail?.weekIsSkipped
                ? "The whole week is skipped for everyone — edit it on the Weeks page"
                : undefined
            }
            className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
          >
            {detail?.isDeferred ? "Remove deferral" : "Mark deferred"}
          </button>
          <button type="button" onClick={onClose} className={buttonCls.ghost + " !text-xs"}>
            Close
          </button>
        </span>
      </div>

      {error && <Alert kind="err">Not recorded: {error}</Alert>}
      {/* THE CONFIRMATION FOR THIS PANEL, INSIDE IT (§2.10, rule 6 beat 3).
          `ok` already existed and only ever carried "Note saved."; a recorded
          PAYMENT went straight to the host, which closed the panel and drew
          the message at the top of its own screen — the top of a 27×20 grid,
          or of a long member page. The cell he clicked was nowhere near it. */}
      {ok && (
        <p
          role="status"
          data-testid="save-ok"
          className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          ✓ {ok.replace(/^✓\s*/, "")}
        </p>
      )}

      {/* ————— Record: prefilled to this week's due, editable for a partial ————— */}
      {!detail?.weekIsSkipped && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Amount received
              </span>
              <AmountInput
                value={dollars}
                onChange={(v) => {
                  setDollars(v);
                  resetPreview();
                }}
                ariaLabel={`Amount toward week ${target.weekNumber} in dollars`}
                className="w-32"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Method
              </span>
              <Select<Method>
                value={method}
                onChange={(v) => {
                  setMethod(v);
                  resetPreview();
                }}
                ariaLabel="Payment method"
                className="w-28"
                options={[
                  { value: "ZELLE", label: "Zelle" },
                  { value: "CASH", label: "Cash" },
                  { value: "OTHER", label: "Other" },
                ]}
              />
            </label>
            <label className="block grow">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Note (optional)
              </span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>
            <button
              type="button"
              onClick={handlePreview}
              disabled={!amountValid || busy !== null}
              className={buttonCls.secondary}
            >
              {busy === "preview" ? "Checking…" : "Preview"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => {
                  setDollars(String(remaining / 100));
                  resetPreview();
                }}
                className={buttonCls.ghost + " !text-xs"}
              >
                Full week — {formatMoney(remaining)}
              </button>
            )}
            {isPartial && (
              <span className="text-amber-800 dark:text-amber-400">
                Partial: {formatMoney(amount!)} of {formatMoney(remaining)} due on week{" "}
                {target.weekNumber}.
              </span>
            )}
            {dollars.trim() !== "" && !amountValid && (
              <span className="text-red-700 dark:text-red-400">Enter a valid dollar amount.</span>
            )}
          </div>

          {previewValid && (
            <div
              className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-3.5 py-2.5 text-sm"
              data-testid="week-panel-preview"
            >
              <p className="text-gray-800 dark:text-gray-200">
                <strong className="tabular-nums">{formatMoney(preview!.amount)}</strong>:{" "}
                {preview!.text}
              </p>
              {preview!.landsEarlier.length > 0 && (
                <p className="mt-1 font-semibold text-amber-800 dark:text-amber-400">
                  Heads up — oldest debt is paid first (2.15), so this money lands on week
                  {preview!.landsEarlier.length === 1 ? " " : "s "}
                  {preview!.landsEarlier.join(", ")} before week {target.weekNumber}.
                  {preview!.coversThisWeek === 0
                    ? ` Nothing reaches week ${target.weekNumber}.`
                    : ` Only ${formatMoney(preview!.coversThisWeek)} reaches week ${target.weekNumber}.`}
                </p>
              )}
              <button
                type="button"
                onClick={handleCommit}
                disabled={busy !== null || !idempotencyKey}
                className={buttonCls.primary + " mt-2"}
              >
                {busy === "save" ? "Recording…" : "Confirm and record"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ————— Receipts on this week, each undoable ————— */}
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Receipts on this week ({detail?.receipts.length ?? "…"})
        </p>
        {detail === null ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">Loading…</p>
        ) : detail.receipts.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {detail.receipts.map((r) => (
              <li key={r.eventId} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formatMoney(r.appliedHere)}
                  {r.appliedHere < r.eventAmount && (
                    <span className="font-normal text-gray-600 dark:text-gray-400">
                      {" "}
                      (of a {formatMoney(r.eventAmount)} receipt)
                    </span>
                  )}
                </span>
                <span className="text-gray-600 dark:text-gray-400">{r.method ?? "—"}</span>
                <span className="tabular-nums text-gray-600 dark:text-gray-400">
                  {formatDateUTC(new Date(r.receivedAt))}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    ask(
                      {
                        title: `Undo this ${formatMoney(r.eventAmount)} receipt from ${target.memberName}?`,
                        body: (
                          <>
                            {r.appliedHere < r.eventAmount ? (
                              <p>
                                Only {formatMoney(r.appliedHere)} of it sits on week{" "}
                                {target.weekNumber} — the WHOLE receipt is deleted and every week
                                recalculates.
                              </p>
                            ) : (
                              <p>
                                The receipt is deleted and week {target.weekNumber} recalculates.
                              </p>
                            )}
                            <p>
                              Their standing and the cash position recalculate immediately. An
                              audit entry records what was removed.
                            </p>
                          </>
                        ),
                        confirmLabel: "Undo receipt",
                      },
                      async () => {
                        const result = await deletePaymentEvent({ eventId: r.eventId });
                        if (!result.ok) setError(result.error);
                        else
                          onSaved(
                            `✓ Undone — ${formatMoney(r.eventAmount)} receipt deleted and weeks recalculated.`,
                          );
                      },
                    )
                  }
                  className={buttonCls.danger + " !px-2 !py-0.5 !text-xs"}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ————— Note on the week ————— */}
      <div className="flex items-end gap-2">
        <label className="grow">
          <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Note on week {target.weekNumber}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </label>
        <button
          type="button"
          disabled={busy !== null || detail === null || note === (detail?.note ?? "")}
          onClick={() => {
            void (async () => {
              setBusy("week");
              const result = await setWeekNote({
                participationId: target.participationId,
                weekNumber: target.weekNumber,
                note,
              });
              setBusy(null);
              if (!result.ok) setError(result.error);
              else {
                setOk("✓ Note saved.");
                onSaved("✓ Note saved.");
              }
            })();
          }}
          className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
        >
          Save note
        </button>
      </div>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy === "week"}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}
