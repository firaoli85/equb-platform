"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { forgiveBalance, recordLedgerPayment } from "@/app/actions/ledger";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { AmountInput, Select } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { moneyReceivedBounds } from "@/lib/date-bounds";
import { Alert, buttonCls, inputCls, Pill } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";

// THE LIFE OF A CARRIED BALANCE (2.18).
//
// Not a number — a story. Where each debt came from, every payment against it,
// everything written off, and the running total after each event, so it is
// still readable two years later. Both actions work whether or not the person
// is in a cycle: the balance belongs to the PERSON.

type StoryEntry = {
  id: string;
  type: "DEBT" | "PAYMENT" | "FORGIVEN";
  amount: number;
  description: string;
  notes: string | null;
  method: "ZELLE" | "CASH" | "OTHER" | null;
  occurredAt: string;
  balanceAfter: number;
};

const TYPE_LABEL: Record<StoryEntry["type"], { text: string; tone: "problem" | "good" | "neutral" }> = {
  DEBT: { text: "Owed", tone: "problem" },
  PAYMENT: { text: "Paid", tone: "good" },
  // Deliberately NOT "paid" — nobody paid this, and the record must say so.
  FORGIVEN: { text: "Written off", tone: "neutral" },
};

const METHODS = [
  { value: "ZELLE", label: "Zelle" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" },
] as const;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CarriedBalance({
  personId,
  personName,
  story,
}: {
  personId: string;
  personName: string;
  story: { entries: StoryEntry[]; balance: number; raised: number; repaid: number; forgiven: number };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "settle" | "forgive">("none");
  const [dollars, setDollars] = useState("");
  const [method, setMethod] = useState<"ZELLE" | "CASH" | "OTHER">("ZELLE");
  const [when, setWhen] = useState(todayIso());
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  const cents = parseDollarsToCents(dollars);

  function close() {
    setMode("none");
    setDollars("");
    setNote("");
    setReason("");
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const result = await fn();
      if (!result.ok) setMsg({ kind: "err", text: `Not recorded: ${result.error}` });
      else {
        setMsg({ kind: "ok", text: okText });
        close();
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing was recorded." });
    } finally {
      setBusy(false);
      setConfirm(null);
      setOnConfirm(null);
    }
  }

  return (
    <div className="space-y-3">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {/* The headline: what is still carried, and where it stands. */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Carried balance
          </p>
          <p className="mt-0.5 text-2xl font-black tabular-nums leading-none text-gray-900 dark:text-white">
            {formatMoney(story.balance)}
          </p>
        </div>
        <p className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
          {formatMoney(story.raised)} owed over time · {formatMoney(story.repaid)} repaid
          {story.forgiven > 0 && ` · ${formatMoney(story.forgiven)} written off`}
        </p>
        {story.balance > 0 && (
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setMode(mode === "settle" ? "none" : "settle")}
              className={buttonCls.primary + " !px-3 !py-1.5 !text-xs"}
            >
              Record against the balance
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "forgive" ? "none" : "forgive")}
              className={buttonCls.dangerQuiet + " !text-xs"}
            >
              Write it off
            </button>
          </span>
        )}
      </div>

      {/* ————— Settle: works with no active cycle (2.18) ————— */}
      {mode === "settle" && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Amount
            </span>
            <AmountInput
              value={dollars}
              onChange={setDollars}
              ariaLabel="Payment against the carried balance, in dollars"
              className="w-32"
              placeholder={String(story.balance / 100)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              How
            </span>
            <Select
              value={method}
              onChange={(v) => setMethod(v as "ZELLE" | "CASH" | "OTHER")}
              ariaLabel="Payment method"
              className="w-32"
              options={METHODS.map((m) => ({ value: m.value, label: m.label }))}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              When
            </span>
            <DatePicker
              value={when}
              onChange={setWhen}
              ariaLabel="Date the money arrived"
              className="w-44"
              bounds={moneyReceivedBounds()}
            />
          </label>
          <label className="block flex-1 min-w-40">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Note (optional)
            </span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
          <button
            type="button"
            disabled={busy || cents === null || cents < 1}
            onClick={() => {
              if (cents === null) return;
              const left = Math.max(0, story.balance - cents);
              setConfirm({
                title: `Record ${formatMoney(cents)} from ${personName}?`,
                destructive: false,
                body: (
                  <>
                    <p>
                      This is LEDGER money, not week money — it settles the carried balance and
                      never marks a week paid.
                    </p>
                    <p>
                      Their balance goes from{" "}
                      <strong className="tabular-nums">{formatMoney(story.balance)}</strong> to{" "}
                      <strong className="tabular-nums">{formatMoney(left)}</strong>. An audit entry
                      records it.
                    </p>
                  </>
                ),
                confirmLabel: "Record the payment",
              });
              setOnConfirm(() => () =>
                void run(
                  () =>
                    recordLedgerPayment({
                      personId,
                      amount: cents,
                      method,
                      occurredAt: when,
                      notes: note || undefined,
                    }),
                  `✓ ${formatMoney(cents)} recorded — ${formatMoney(left)} still carried.`,
                ),
              );
            }}
            className={buttonCls.primary}
          >
            Review…
          </button>
        </div>
      )}

      {/* ————— Forgive: a DIFFERENT fact from a payment (2.2) ————— */}
      {mode === "forgive" && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-3">
          <p className="basis-full text-xs text-amber-900 dark:text-amber-200">
            Writing off is not a payment. The balance clears, and the history will show it was
            forgiven rather than paid — so nobody later reads it as money received.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Amount to write off
            </span>
            <AmountInput
              value={dollars}
              onChange={setDollars}
              ariaLabel="Amount to write off, in dollars"
              className="w-32"
              placeholder={String(story.balance / 100)}
            />
          </label>
          <label className="block flex-1 min-w-48">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
              Reason (kept forever)
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. agreed to clear it — hardship"
              className={inputCls}
            />
          </label>
          <button
            type="button"
            disabled={busy || cents === null || cents < 1 || reason.trim().length < 3}
            onClick={() => {
              if (cents === null) return;
              const left = Math.max(0, story.balance - cents);
              setConfirm({
                title:
                  cents >= story.balance
                    ? `Write off ${personName}'s whole ${formatMoney(story.balance)} balance?`
                    : `Write off ${formatMoney(cents)} of ${personName}'s balance?`,
                body: (
                  <>
                    <p>
                      <strong>Nobody pays this.</strong> The balance goes from{" "}
                      <strong className="tabular-nums">{formatMoney(story.balance)}</strong> to{" "}
                      <strong className="tabular-nums">{formatMoney(left)}</strong>, recorded as
                      FORGIVEN — never as a payment.
                    </p>
                    <p>
                      Your reason is kept with the entry: “{reason.trim()}”. An audit entry records
                      the decision.
                    </p>
                  </>
                ),
                confirmLabel: "Write it off",
                requirePhrase: personName,
              });
              setOnConfirm(() => () =>
                void run(
                  () => forgiveBalance({ personId, amount: cents, reason }),
                  `✓ ${formatMoney(cents)} written off — ${formatMoney(left)} still carried.`,
                ),
              );
            }}
            className={buttonCls.danger}
          >
            Review…
          </button>
        </div>
      )}

      {/* ————— THE STORY ————— */}
      {story.entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
          No carried balance. One appears if a cycle closes with them short, or a terms change
          leaves a gap.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          {story.entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 dark:border-gray-800/60 bg-white dark:bg-[#141414] px-3.5 py-2.5 last:border-b-0"
            >
              <Pill tone={TYPE_LABEL[e.type].tone}>{TYPE_LABEL[e.type].text}</Pill>
              <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
                {formatDateUTC(new Date(e.occurredAt))}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">
                {e.description}
                {e.method && (
                  <span className="text-gray-600 dark:text-gray-400">
                    {" "}
                    · {METHODS.find((m) => m.value === e.method)?.label}
                  </span>
                )}
                {e.notes && (
                  <span className="text-gray-600 dark:text-gray-400"> · “{e.notes}”</span>
                )}
              </span>
              <span className="tabular-nums font-semibold text-gray-900 dark:text-white">
                {e.type === "DEBT" ? "+" : "−"}
                {formatMoney(e.amount)}
              </span>
              <span className="w-24 text-right text-xs tabular-nums text-gray-600 dark:text-gray-400">
                {formatMoney(e.balanceAfter)} left
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}
