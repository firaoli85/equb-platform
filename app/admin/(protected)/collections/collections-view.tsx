"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePayout, updatePayout } from "@/app/actions/edits";
import { undoDraw } from "@/app/actions/wheel";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { CarryDeductionOffer } from "@/components/admin/carry-deduction-offer";
import { WeekWinnerEditor } from "@/components/admin/week-winner-editor";
import { DatePicker } from "@/components/ui/date-picker";
import { moneyReceivedBounds } from "@/lib/date-bounds";
import { AmountInput, Select } from "@/components/ui/controls";
import { Alert, buttonCls, Card, Pill } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import type { UndoDrawConsequences } from "@/lib/undo-draw";
import { removeWinnerPreview, previewSentences, type WeekWinners } from "@/lib/week-winners";
import { removeWinnerFromWeek } from "@/app/actions/week-winners";

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
  /** Needed to add a winner to, or move one into, this week. */
  weekId: string | null;
  isSkipped: boolean;
  weekNumber: number | null;
  weekDate: string | null;
  /** 2.2: the organizer decided this payout rather than spinning for it. */
  assignedManually: boolean;
  payouts: PayoutRow[];
  undo: UndoDrawConsequences | null;
};

/**
 * Every week of the cycle with its LIVE state — what the move picker is built
 * from. Not derived from the payout groups: a free week must show as free and
 * a drawn week must show its real total, both the moment they change.
 */
export type WeekOption = {
  weekId: string;
  weekNumber: number;
  hasDraw: boolean;
  isSkipped: boolean;
  /** A winner plan is committed here (2.3) — moving into it is refused. */
  planned: boolean;
  payoutCount: number;
  totalNet: number;
};

// READ-FIRST (2.25): rows display; actions are deliberate. The two delete
// intentions are separate buttons with separate, computed consequences —
// the organizer never guesses whether a number goes back on the wheel.
export function CollectionsView({
  groups,
  weeks,
  cycleName,
}: {
  groups: WeekGroup[];
  weeks: WeekOption[];
  cycleName: string;
}) {
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

  /**
   * THE UNDO FLOW, in one place.
   *
   * Reachable from the week's own button AND from inside the delete-payout
   * dialog. The organizer deleted #78's payout expecting the number back on
   * the wheel; that is what THIS action does, and it used to live only on a
   * different control with nothing connecting them. One definition means the
   * two entry points can never describe the same action differently.
   */
  function askUndoDraw(group: WeekGroup) {
    const u = group.undo;
    if (!u || !group.drawId) return;
    ask(
      {
        title: `Undo the draw for week ${u.weekNumber}?`,
        consequence: (
          <>
            Number{u.numbersReturning.length === 1 ? "" : "s"}{" "}
            <strong>{u.numbersReturning.map((n) => `#${n}`).join(", ")}</strong>{" "}
            {u.numbersReturning.length === 1 ? "RETURNS" : "RETURN"} TO THE WHEEL POOL and week{" "}
            {u.weekNumber} can be drawn again.
          </>
        ),
        body: (
          <>
            <p>
              This says week {u.weekNumber} was NOT drawn. The draw and its{" "}
              <strong>{u.payoutCount}</strong> payout record{u.payoutCount === 1 ? "" : "s"}{" "}
              totalling <strong className="tabular-nums">{formatMoney(u.totalNet)}</strong> are
              removed
              {u.collectedCount > 0 && (
                <>
                  {" "}
                  — including{" "}
                  <strong className="tabular-nums">{formatMoney(u.collectedNet)}</strong> already
                  handed over ({u.collectedCount} collected)
                </>
              )}
              .
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
            <p>
              The cash position and every standing recalculate immediately. An audit entry keeps
              the full record.
            </p>
          </>
        ),
        confirmLabel: `Undo the draw for week ${u.weekNumber}`,
        requirePhrase: u.highStakes ? cycleName : undefined,
      },
      () => undoDraw({ drawId: group.drawId! }),
      `✓ Week ${u.weekNumber}'s draw undone — ${u.numbersReturning
        .map((n) => `#${n}`)
        .join(", ")} returned to the wheel.`,
    );
  }

  /** The group, in the shape lib/week-winners.ts computes against. */
  function asWeekWinners(group: WeekGroup): WeekWinners {
    return {
      weekId: group.weekId ?? "",
      weekNumber: group.weekNumber ?? 0,
      undrawn: group.drawId === null,
      isSkipped: group.isSkipped,
      planned: weeks.find((w) => w.weekId === group.weekId)?.planned ?? false,
      payouts: group.payouts.map((p) => ({
        payoutId: p.id,
        luckyNumberId: "",
        number: p.number,
        participationId: "",
        memberName: p.who,
        gross: p.grossAmount,
        fee: p.feeAmount,
        net: p.netAmount,
        settlement: p.settlementAmount,
        status: p.status,
      })),
    };
  }

  /**
   * REMOVE ONE WINNER — distinct from "Delete payout", which keeps the number
   * drawn. That difference has already misled the organizer once, so each
   * dialog says what the other does.
   */
  function askRemoveWinner(group: WeekGroup, payoutId: string) {
    const week = asWeekWinners(group);
    const payout = week.payouts.find((p) => p.payoutId === payoutId);
    if (!payout) return;
    const preview = removeWinnerPreview({ week, payout });
    ask(
      {
        title: `Remove ${payout.memberName} (#${payout.number}) from week ${week.weekNumber}?`,
        consequence: (
          <>
            #{payout.number} <strong>RETURNS TO THE WHEEL POOL</strong> and can be drawn again.
            This is the opposite of “Delete payout”, which keeps the number drawn.
          </>
        ),
        body: (
          <>
            <ul className="space-y-1">
              {previewSentences(preview, formatMoney).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p>
              {preview.freedWeek
                ? "They were this week's only winner, so nothing is left on it to keep the draw alive."
                : "The week's other winners are untouched."}{" "}
              An audit entry records the change.
            </p>
          </>
        ),
        confirmLabel: "Remove this winner",
        requirePhrase: payout.status === "COLLECTED" ? payout.memberName : undefined,
      },
      () => removeWinnerFromWeek({ payoutId }),
      `✓ #${payout.number} removed — the number is back on the wheel.`,
    );
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
                onClick={() => askUndoDraw(group)}
              >
                Undo the draw for week {group.weekNumber}
              </button>
            )}
          </div>

          {/* A draw holding NO payout is a week counted as drawn while holding
              nothing — un-redrawable and unassignable. It should no longer be
              creatable (lib/draw-cascade removes the draw with its last
              payout), so seeing one means older data: name it and offer the
              undo rather than rendering an empty card. */}
          {group.drawId && group.payouts.length === 0 && (
            <div className="mx-5 mb-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Week {group.weekNumber} is marked drawn but holds no payout.
              </p>
              <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
                Nothing can be drawn or assigned to it while this record exists. Undo the draw to
                free the week{group.undo && group.undo.numbersReturning.length > 0
                  ? ` and return ${group.undo.numbersReturning.map((n) => `#${n}`).join(", ")} to the wheel`
                  : ""}
                .
              </p>
            </div>
          )}

          <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
            {group.payouts.map((p) => (
              <PayoutLine
                key={p.id}
                payout={p}
                weekNumber={group.weekNumber}
                cycleName={cycleName}
                // Deleting the LAST payout takes the draw with it — the
                // dialog has to say so before it happens, not after.
                isLastPayout={group.payouts.length === 1}
                numbersReturning={group.undo?.numbersReturning ?? []}
                open={openRow?.id === p.id ? openRow.mode : null}
                setOpen={(mode) => setOpenRow(mode ? { id: p.id, mode } : null)}
                busy={busy}
                ask={ask}
                onUndoDraw={group.undo && group.drawId ? () => askUndoDraw(group) : null}
                onRemoveWinner={
                  group.weekId ? () => askRemoveWinner(group, p.id) : null
                }
              />
            ))}
          </ul>

          {/* 2.23: reshape the week without undoing it. Week 6 recorded Hana
              (#19) alone at $4,900 when she was clearly paired with someone —
              this is how that gets corrected. */}
          {group.weekId && (
            <WeekWinnerEditor
              week={asWeekWinners(group)}
              cycleName={cycleName}
              // EVERY other week of the cycle, drawn or not, straight from
              // live state. A winner belongs where the organizer says (2.2),
              // and a week freed a second ago is selectable immediately.
              otherWeeks={weeks.filter((w) => w.weekId !== group.weekId)}
              busy={busy}
              ask={ask}
            />
          )}
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
  isLastPayout,
  numbersReturning,
  open,
  setOpen,
  busy,
  ask,
  onUndoDraw,
  onRemoveWinner,
}: {
  payout: PayoutRow;
  weekNumber: number | null;
  cycleName: string;
  /** This is the week's only payout — deleting it removes the draw too. */
  isLastPayout: boolean;
  /** Numbers coming back to the wheel if the draw goes with this payout. */
  numbersReturning: number[];
  open: "collect" | "edit" | null;
  setOpen: (mode: "collect" | "edit" | null) => void;
  busy: boolean;
  ask: (
    spec: ConfirmSpec,
    action: () => Promise<{ ok: boolean; error?: string } | { ok: boolean }>,
    okText: string,
  ) => void;
  /** The alternative action, when this payout came from a real draw. */
  onUndoDraw: (() => void) | null;
  /** Remove this winner and RETURN their number to the wheel. */
  onRemoveWinner: (() => void) | null;
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
          {/* THE OTHER intention, beside its neighbour on purpose: this one
              returns the number to the wheel, the next one does not. Having
              them adjacent with distinct labels is what stops the confusion
              that "Delete payout" alone caused. */}
          {onRemoveWinner && (
            <button
              type="button"
              disabled={busy}
              onClick={onRemoveWinner}
              className={buttonCls.ghost + " !px-2.5 !py-1.5 !text-xs"}
            >
              Remove winner
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              ask(
                {
                  title: `Delete #${p.number} ${p.who}'s payout?`,
                  // THE MISS THAT PROMPTED THIS. The organizer deleted a
                  // payout because the member never received the money, and
                  // expected the number back on the wheel. With another winner
                  // on the week it is not — by design. As the LAST payout it
                  // now is, because a draw holding nothing is the half-state
                  // that stranded weeks 1 and 6.
                  consequence: isLastPayout ? (
                    <>
                      This is week {weekNumber}&apos;s <strong>only</strong> payout, so the draw
                      goes with it: week {weekNumber} becomes <strong>UNDRAWN</strong> and
                      selectable again
                      {numbersReturning.length > 0 && (
                        <>
                          , and{" "}
                          <strong>{numbersReturning.map((n) => `#${n}`).join(", ")}</strong>{" "}
                          {numbersReturning.length === 1 ? "returns" : "return"} to the wheel pool
                        </>
                      )}
                      . A week is never left counted as drawn while holding nothing.
                    </>
                  ) : (
                    <>
                      <strong>The draw stands.</strong> #{p.number} stays drawn and does{" "}
                      <strong>NOT</strong> return to the wheel
                      {weekNumber !== null ? ` — week ${weekNumber} remains drawn` : ""}, because
                      it still has another winner. Only the money record is removed.
                    </>
                  ),
                  // The action he probably meant, right here. With one payout
                  // left the two actions now do the same thing, so offering
                  // the "alternative" would only suggest a difference that is
                  // no longer there.
                  alternative:
                    onUndoDraw && !isLastPayout
                      ? {
                          description: (
                            <>
                              If {p.who} never received the money and week {weekNumber} should be
                              drawn again for everyone on it, undo the whole draw instead — that
                              returns every number on the week to the wheel.
                            </>
                          ),
                          label: `Undo the draw for week ${weekNumber}`,
                          onChoose: onUndoDraw,
                        }
                      : undefined,
                  body: (
                    <>
                      <p>
                        The record of{" "}
                        <strong className="tabular-nums">{formatMoney(p.netAmount)}</strong> going
                        out ({p.status.toLowerCase()}) disappears and the cash position
                        recalculates.
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
                isLastPayout
                  ? `✓ #${p.number}'s payout deleted — week ${weekNumber} is undrawn and selectable again.`
                  : `✓ #${p.number}'s payout deleted — the draw stands.`,
              )
            }
            className={buttonCls.dangerQuiet + " !text-xs"}
          >
            Delete payout
          </button>
        </span>
      </div>

      {open === "collect" && (
        <>
        {/* D-2: the remembered "deduct from payout" choice resurfaces HERE,
            pre-ticked but never applied without this button being pressed. */}
        <CarryDeductionOffer payoutId={p.id} />
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-3">
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
        </>
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
