"use client";

import { useEffect, useState } from "react";
import { previewAllocation, recordPayment } from "@/app/actions/payments";
import { AmountInput, Select } from "@/components/ui/controls";
import { buttonCls } from "@/components/ui/primitives";
import { describeAllocation } from "@/lib/payments-view";
import { formatMoney, parseDollarsToCents } from "@/lib/format";

type Method = "ZELLE" | "CASH" | "OTHER";

/**
 * The allocation entry used by BOTH entry points (2.19). Preview first,
 * commit exactly what was previewed (2.15). A fresh idempotency key is
 * generated when the form opens and re-armed after each save, so a
 * double-click cannot double-pay.
 */
export function AllocationEntry({
  participationId,
  memberName,
  defaultAmountCents,
  onSaved,
}: {
  participationId: string;
  memberName: string;
  defaultAmountCents?: number;
  /** Receives the success message — callers that unmount this component on
   *  save MUST surface it themselves (2.10: confirmation is never lost). */
  onSaved?: (message: string) => void;
}) {
  const [dollars, setDollars] = useState(
    defaultAmountCents ? String(defaultAmountCents / 100) : "",
  );
  const [method, setMethod] = useState<Method>("ZELLE");
  const [notes, setNotes] = useState("");
  // preview.amount pins what was previewed; commit sends exactly that.
  const [preview, setPreview] = useState<{ text: string; amount: number } | null>(null);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // A fresh key per submission intent; re-armed after every successful save.
  const [keyNonce, setKeyNonce] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, [keyNonce]);

  const amount = parseDollarsToCents(dollars);
  const amountValid = amount !== null && amount >= 1;

  function resetPreview() {
    setPreview(null);
    setSuggested(null);
    setError(null);
    setSaved(null);
  }

  async function handlePreview() {
    if (!amountValid) return;
    setBusy("preview");
    setError(null);
    setSaved(null);
    setSuggested(null);
    try {
      const result = await previewAllocation({ participationId, amount: amount! });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The preview must be the TRUTH about what committing does (2.15).
      // recordPayment refuses any amount the window cannot fully absorb, so
      // never arm a commit the engine would reject.
      if (result.data.allocations.length === 0) {
        setPreview(null);
        setError(
          `Nothing to record — ${memberName}'s weeks are already fully covered. ` +
            `Money beyond their window needs the carried-balance ledger.`,
        );
        return;
      }
      if (result.data.unallocated > 0) {
        setPreview(null);
        setSuggested(result.data.totalApplied);
        setError(
          `Only ${formatMoney(result.data.totalApplied)} fits in ${memberName}'s remaining weeks — ` +
            `${formatMoney(result.data.unallocated)} would not land anywhere, so the whole payment ` +
            `would be refused. Reduce the amount.`,
        );
        return;
      }
      setPreview({ text: describeAllocation(result.data), amount: amount! });
    } catch {
      setError("Could not reach the server — nothing was previewed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCommit() {
    if (!preview || !idempotencyKey) return;
    if (preview.amount !== amount) {
      // The input changed after the preview — never commit unpreviewed money.
      resetPreview();
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const result = await recordPayment({
        participationId,
        amount: preview.amount,
        method,
        idempotencyKey,
        notes: notes || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // 2.20: the organizer always knows exactly what the system said — or
      // why it stayed silent.
      const confirmation = result.data.confirmation;
      const confirmationNote =
        confirmation === null
          ? " WhatsApp confirmation was not attempted (internal error — see the message log)."
          : confirmation.status === "SENT"
            ? " WhatsApp confirmation delivered."
            : // Twilio took it and has confirmed nothing. Saying "sent" here is
              // exactly the claim that produced ten false SENT rows.
              confirmation.status === "ACCEPTED"
              ? " WhatsApp confirmation accepted by Twilio — delivery not yet confirmed."
              : confirmation.status === "SKIPPED"
                ? ` No WhatsApp confirmation: ${confirmation.reason}`
                : ` WhatsApp confirmation FAILED: ${confirmation.error}`;
      const message = `✓ Recorded ${formatMoney(result.data.totalApplied)} for ${memberName} — ${describeAllocation({ allocations: result.data.allocations, unallocated: 0 })}.${confirmationNote}`;
      setSaved(message);
      setPreview(null);
      setDollars("");
      setNotes("");
      setKeyNonce((n) => n + 1); // arm a fresh key for the next receipt
      onSaved?.(message);
    } catch {
      setError(
        "Could not reach the server — the payment was NOT confirmed. Check the member's weeks before entering it again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Amount received
          </span>
          <AmountInput
            value={dollars}
            onChange={(value) => {
              setDollars(value);
              resetPreview();
            }}
            placeholder="750"
            ariaLabel="Amount received in dollars"
            className="w-32"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Method
          </span>
          <Select<Method>
            value={method}
            onChange={(value) => {
              setMethod(value);
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
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
            Notes
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-40 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
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

      {dollars.trim() !== "" && !amountValid && (
        <p className="text-red-800">Enter a valid dollar amount.</p>
      )}

      {preview && preview.amount === amount && (
        <div
          className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-3.5 py-2.5"
          data-testid="allocation-preview"
        >
          <p className="text-gray-800 dark:text-gray-200">
            <strong className="tabular-nums">{formatMoney(preview.amount)}</strong> from{" "}
            {memberName}: {preview.text}
          </p>
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

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-red-800 dark:text-red-400"
        >
          <p>Not recorded: {error}</p>
          {suggested !== null && (
            <button
              type="button"
              onClick={() => {
                setDollars(String(suggested / 100));
                resetPreview();
              }}
              className={buttonCls.secondary + " mt-1.5 !px-2.5 !py-1 !text-xs"}
            >
              Use {formatMoney(suggested)} instead
            </button>
          )}
        </div>
      )}
      {saved && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2.5 text-emerald-900 dark:text-emerald-400"
        >
          {saved}
        </p>
      )}
    </div>
  );
}
