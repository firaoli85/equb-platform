"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePayout, updatePayout } from "@/app/actions/edits";
import { undoDraw } from "@/app/actions/wheel";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { moneyReceivedBounds } from "@/lib/date-bounds";
import { AmountInput, Select } from "@/components/ui/controls";
import { Alert, buttonCls, Card, Pill } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import type { UndoDrawConsequences } from "@/lib/undo-draw";

type Method = "ZELLE" | "CASH" | "OTHER" | null;

export type PayoutRow = {
  id: string;
  number: number;
  who: string;
  whoAmharic: string;
  grossAmount: number;
  feeAmount: number;
  /** Already reduced by the week settlement — what crosses the table. */
  netAmount: number;
  /** The winner's own-week contribution settled from this payout. */
  settlementAmount: number;
  status: "PENDING" | "COLLECTED";
  method: Method;
  paidAt: string | null;
  notes: string | null;
  /** Their derived outstanding, for the OFFER (2.18 — never automatic). */
  outstanding: number;
};

export type WeekGroup = {
  drawId: string | null;
  weekNumber: number | null;
  weekDate: string | null;
  /** 2.2: the organizer decided this payout rather than spinning for it. */
  assignedManually: boolean;
  payouts: PayoutRow[];
  undo: UndoDrawConsequences | null;
};

// READ-FIRST (2.25): rows display; actions are deliberate. The two delete
// intentions are separate buttons with separate, computed consequences —
// the organizer never guesses whether a number goes back on the wheel.
export function CollectionsView({ groups, cycleName }: { groups: WeekGroup[]; cycleName: string }) {
  const router = useRouter();
  const [openRow, setOpenRow] = useState<{ id: string; mode: "collect" | "edit" } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function ask(spec: ConfirmSpec, action: () => Promise<{ ok: boolean; error?: string } | { ok: boolean }>, okText: string) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void (async () => {
        setBusy(true);
        try {
          const result = await action();
          if (!result.ok) {
            setFeedback({ kind: "err", text: ("error" in result && result.error) || "Failed — nothing changed." });
          } else {
            setFeedback({ kind: "ok", text: okText });
            setOpenRow(null);
            router.refresh();
          }
        } catch {
          setFeedback({ kind: "err", text: "Could not reach the server — nothing was confirmed." });
        } finally {
          setBusy(false);
          setConfirm(null);
          setOnConfirm(null);
        }
      })();
    });
  }

  if (groups.length === 0) {
    return (
      <Card className="px-6 py-10 text-center">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">No payouts yet.</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Payouts appear here the moment a week is drawn on the wheel.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {feedback && <Alert kind={feedback.kind}>{feedback.text}</Alert>}

      {groups.map((group) => (
        <Card key={group.drawId ?? "unlinked"}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-2">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
                {group.weekNumber !== null ? (
                  <>
                    <span>Week {group.weekNumber}</span>
                    <span className="font-normal tabular-nums text-gray-500 dark:text-gray-400">
                      {group.weekDate ? formatDateUTC(new Date(group.weekDate)) : ""}
                    </span>
                    {group.assignedManually && <Pill tone="accent">assigned, not drawn</Pill>}
                  </>
                ) : (
                  "Not linked to a draw"
                )}
              </h2>
              {/* The week's own subtotal — what this draw is worth, and what
                  of it is still owed. Computed here, never typed in. */}
              <p className="mt-0.5 text-xs tabular-nums text-gray-600 dark:text-gray-400">
                {group.payouts.length} payout{group.payouts.length === 1 ? "" : "s"} ·{" "}
                {formatMoney(group.payouts.reduce((s, p) => s + p.netAmount, 0))} total
                {(() => {
                  const owed = group.payouts
                    .filter((p) => p.status === "PENDING")
                    .reduce((s, p) => s + p.netAmount, 0);
                  return owed > 0 ? ` · ${formatMoney(owed)} still to hand over` : " · all collected";
                })()}
              </p>
            </div>
            {group.drawId && group.undo && (
              <button
                type="button"
                className={buttonCls.dangerQuiet + " !text-xs"}
                onClick={() => {
                  const u = group.undo!;
                  ask(
                    {
                      title: `Undo the draw for week ${u.weekNumber}?`,
                      body: (
                        <>
                          <p>
                            This says week {u.weekNumber} was NOT drawn. The draw and its{" "}
                            <strong>{u.payoutCount}</strong> payout record
                            {u.payoutCount === 1 ? "" : "s"} totalling{" "}
                            <strong className="tabular-nums">{formatMoney(u.totalNet)}</strong> are
                            removed
                            {u.collectedCount > 0 && (
                              <>
                                {" "}
                                — including{" "}
                                <strong className="tabular-nums">
                                  {formatMoney(u.collectedNet)}
                                </strong>{" "}
                                already handed over ({u.collectedCount} collected)
                              </>
                            )}
                            .
                          </p>
                          <p>
                            Number{u.numbersReturning.length === 1 ? "" : "s"}{" "}
                            <strong>{u.numbersReturning.map((n) => `#${n}`).join(", ")}</strong>{" "}
                            RETURN TO THE WHEEL POOL.
                          </p>
                          {u.unsettled.length > 0 && (
                            <p>
                              {u.unsettled
                                .map(
                                  (s) =>
                                    `#${s.number}'s week-${u.weekNumber} contribution of ${formatMoney(s.amount)}`,
                                )
                                .join(" and ")}{" "}
                              was settled from the payout — it becomes owed again.
                            </p>
                          )}
                          <p>The cash position and every standing recalculate immediately. An audit entry keeps the full record.</p>
                        </>
                      ),
                      confirmLabel: `Undo the draw for week ${u.weekNumber}`,
                      requirePhrase: u.highStakes ? cycleName : undefined,
                    },
                    () => undoDraw({ drawId: group.drawId! }),
                    `✓ Week ${u.weekNumber}'s draw undone — ${u.numbersReturning.map((n) => `#${n}`).join(", ")} returned to the wheel.`,
                  );
                }}
              >
                Undo the draw for week {group.weekNumber}
              </button>
            )}
          </div>

          <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
            {group.payouts.map((p) => (
              <PayoutLine
                key={p.id}
                payout={p}
                weekNumber={group.weekNumber}
                cycleName={cycleName}
                open={openRow?.id === p.id ? openRow.mode : null}
                setOpen={(mode) => setOpenRow(mode ? { id: p.id, mode } : null)}
                busy={busy}
                ask={ask}
              />
            ))}
          </ul>
        </Card>
      ))}

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

function PayoutLine({
  payout: p,
  weekNumber,
  cycleName,
  open,
  setOpen,
  busy,
  ask,
}: {
  payout: PayoutRow;
  weekNumber: number | null;
  cycleName: string;
  open: "collect" | "edit" | null;
  setOpen: (mode: "collect" | "edit" | null) => void;
  busy: boolean;
  ask: (
    spec: ConfirmSpec,
    action: () => Promise<{ ok: boolean; error?: string } | { ok: boolean }>,
    okText: string,
  ) => void;
}) {
  const [method, setMethod] = useState<Exclude<Method, null>>(p.method ?? "ZELLE");
  const [date, setDate] = useState(p.paidAt ?? new Date().toISOString().slice(0, 10));
  const [gross, setGross] = useState(String(p.grossAmount / 100));
  const [fee, setFee] = useState(String(p.feeAmount / 100));
  const [net, setNet] = useState(String(p.netAmount / 100));
  const [notes, setNotes] = useState(p.notes ?? "");

  function saveEdit() {
    const grossC = parseDollarsToCents(gross);
    const feeC = parseDollarsToCents(fee);
    const netC = parseDollarsToCents(net);
    if (grossC === null || feeC === null || netC === null) return;
    ask(
      {
        title: `Save #${p.number} ${p.who}'s payout?`,
        destructive: false,
        body: (
          <p>
            {weekNumber !== null ? `Week ${weekNumber}: ` : ""}gross{" "}
            <strong className="tabular-nums">{formatMoney(grossC)}</strong>, fee{" "}
            <strong className="tabular-nums">{formatMoney(feeC)}</strong>, net handed over{" "}
            <strong className="tabular-nums">{formatMoney(netC)}</strong> ({p.status.toLowerCase()}
            ). An audit entry records old and new values, and the cash position recalculates
            immediately.
          </p>
        ),
        confirmLabel: "Save payout",
      },
      () =>
        updatePayout({
          payoutId: p.id,
          grossAmount: grossC,
          feeAmount: feeC,
          netAmount: netC,
          status: p.status,
          method,
          paidAt: date || null,
          notes: notes || undefined,
        }),
      `✓ #${p.number}'s payout saved.`,
    );
  }

  return (
    <li className="px-5 py-3">
      {/* One obligation per row, read left to right: who, then the state,
          then the money right-aligned so a column of figures lines up. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex select-none items-center rounded-full border px-2.5 py-0.5 text-[11px] font-black tabular-nums"
              style={{
                background: "var(--gold-badge-bg)",
                borderColor: "var(--gold-badge-border)",
                color: "var(--gold-badge-text)",
              }}
            >
              #{p.number}
            </span>
            <span className="truncate font-bold text-gray-900 dark:text-white">{p.who}</span>
            <Pill tone={p.status === "COLLECTED" ? "good" : "attention"}>
              {p.status === "COLLECTED" ? "Collected" : "Pending"}
            </Pill>
          </div>
          <p className="mt-0.5 text-xs tabular-nums text-gray-600 dark:text-gray-400">
            {formatMoney(p.grossAmount)} gross · {formatMoney(p.feeAmount)} fee
            {p.settlementAmount > 0 && (
              <> · week {weekNumber} contribution {formatMoney(p.settlementAmount)} deducted</>
            )}
            {p.status === "COLLECTED" && (
              <>
                {" · "}
                {p.method ?? "—"}
                {p.paidAt ? ` · ${formatDateUTC(new Date(p.paidAt + "T00:00:00Z"))}` : ""}
              </>
            )}
          </p>
        </div>

        <p className="text-right text-base font-black tabular-nums leading-none text-gray-900 dark:text-white">
          {formatMoney(p.netAmount)}
          <span className="ml-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            net
          </span>
        </p>

        <span className="flex items-center gap-1.5">
          {p.status === "PENDING" && (
            <button
              type="button"
              onClick={() => setOpen(open === "collect" ? null : "collect")}
              className={buttonCls.primary + " !px-3 !py-1.5 !text-xs"}
            >
              Mark collected
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(open === "edit" ? null : "edit")}
            className={buttonCls.ghost + " !px-2.5 !py-1.5 !text-xs"}
          >
            {open === "edit" ? "Close" : "Edit"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              ask(
                {
                  title: `Delete #${p.number} ${p.who}'s payout?`,
                  body: (
                    <>
                      <p>
                        The record of{" "}
                        <strong className="tabular-nums">{formatMoney(p.netAmount)}</strong> going
                        out ({p.status.toLowerCase()}) disappears and the cash position
                        recalculates.
                      </p>
                      <p>
                        <strong>The draw stands.</strong> #{p.number} stays drawn and does NOT
                        return to the wheel{weekNumber !== null ? ` — week ${weekNumber} remains drawn` : ""}.
                      </p>
                      {p.settlementAmount > 0 && weekNumber !== null && (
                        <p>
                          Their week-{weekNumber} contribution of{" "}
                          <strong className="tabular-nums">{formatMoney(p.settlementAmount)}</strong>{" "}
                          was settled from this payout — that week becomes owed again.
                        </p>
                      )}
                      <p>An audit entry keeps what was deleted.</p>
                    </>
                  ),
                  confirmLabel: "Delete payout",
                  requirePhrase: p.status === "COLLECTED" ? p.who : undefined,
                },
                () => deletePayout({ payoutId: p.id }),
                `✓ #${p.number}'s payout deleted — the draw stands.`,
              )
            }
            className={buttonCls.dangerQuiet + " !text-xs"}
          >
            Delete payout
          </button>
        </span>
      </div>

      {open === "collect" && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Method</span>
            <Select<Exclude<Method, null>>
              value={method}
              onChange={setMethod}
              ariaLabel="Collection method"
              className="w-32"
              options={[
                { value: "ZELLE", label: "Zelle" },
                { value: "CASH", label: "Cash" },
                { value: "OTHER", label: "Other" },
              ]}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Date</span>
            <DatePicker
              value={date}
              onChange={setDate}
              ariaLabel="Collection date"
              bounds={moneyReceivedBounds()}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              ask(
                {
                  title: `Hand ${formatMoney(p.netAmount)} to ${p.who}?`,
                  destructive: false,
                  body: (
                    <>
                      <p>
                        #{p.number}
                        {weekNumber !== null ? ` (week ${weekNumber})` : ""} is marked COLLECTED —{" "}
                        <strong className="tabular-nums">{formatMoney(p.netAmount)}</strong> by{" "}
                        {method.toLowerCase()} on {formatDateUTC(new Date(date + "T00:00:00Z"))}.
                        The cash position recalculates immediately.
                      </p>
                      {p.outstanding > 0 && (
                        <p className="text-amber-800 dark:text-amber-400">
                          They still owe {formatMoney(p.outstanding)} on their weeks. Hand over the
                          full amount, or Cancel and use Edit to deduct — your decision, never
                          automatic (2.18).
                        </p>
                      )}
                    </>
                  ),
                  confirmLabel: "Mark collected",
                },
                () =>
                  updatePayout({
                    payoutId: p.id,
                    grossAmount: p.grossAmount,
                    feeAmount: p.feeAmount,
                    netAmount: p.netAmount,
                    status: "COLLECTED",
                    method,
                    paidAt: date,
                    notes: p.notes ?? undefined,
                  }),
                `✓ #${p.number} collected — ${formatMoney(p.netAmount)} handed to ${p.who}.`,
              )
            }
            className={buttonCls.primary}
          >
            Mark collected
          </button>
        </div>
      )}

      {open === "edit" && (
        <div className="mt-3 space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] p-3">
          {p.status === "PENDING" && p.outstanding > 0 && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-300">
              They currently owe <strong className="tabular-nums">{formatMoney(p.outstanding)}</strong> on
              their weeks. You may hand over the full amount, or deduct —{" "}
              <strong>your decision, never automatic</strong> (2.18).{" "}
              <button
                type="button"
                onClick={() => {
                  const current = parseDollarsToCents(net) ?? p.netAmount;
                  setNet(String(Math.max(0, current - Math.min(p.outstanding, current)) / 100));
                }}
                className="mt-1 inline-flex rounded-lg border border-amber-400 dark:border-amber-700 px-2 py-1 font-semibold transition-[background-color,transform] duration-150 ease-out hover:bg-amber-100 dark:hover:bg-amber-950/60 active:scale-[0.97]"
              >
                Offer: deduct {formatMoney(Math.min(p.outstanding, parseDollarsToCents(net) ?? p.netAmount))} from the net
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Gross</span>
              <AmountInput value={gross} onChange={setGross} ariaLabel="Gross amount in dollars" className="w-28" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Fee</span>
              <AmountInput value={fee} onChange={setFee} ariaLabel="Fee amount in dollars" className="w-24" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Net</span>
              <AmountInput value={net} onChange={setNet} ariaLabel="Net amount in dollars" className="w-28" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Method</span>
              <Select<Exclude<Method, null>>
                value={method}
                onChange={setMethod}
                ariaLabel="Payout method"
                className="w-28"
                options={[
                  { value: "ZELLE", label: "Zelle" },
                  { value: "CASH", label: "Cash" },
                  { value: "OTHER", label: "Other" },
                ]}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Date</span>
              <DatePicker
                value={date}
                onChange={setDate}
                ariaLabel="Paid-at date"
                bounds={moneyReceivedBounds()}
              />
            </label>
            <label className="block grow">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Notes</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </label>
            <button type="button" onClick={saveEdit} disabled={busy} className={buttonCls.secondary}>
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
