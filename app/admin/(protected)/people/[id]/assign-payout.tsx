"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { assignPayoutManually, getManualPayoutOptions } from "@/app/actions/manual-payout";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Checkbox, Select } from "@/components/ui/controls";
import { Alert, buttonCls, inputCls, Pill } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";

// ASSIGN PAYOUT (2.2): the organizer decides, no spin. It creates the same
// structures a draw does, so the only new thing here is the choosing.
//
// EVERY week is choosable. A week that already has a draw is offered like any
// other; picking it shows exactly what disappears, and confirming does the
// undo and the assignment in ONE transaction. The picker never shows a value
// the list calls unavailable — there is no disabled state to disagree with.

type WeekOption = {
  weekId: string;
  drawId: string | null;
  weekNumber: number;
} & (
  | { kind: "free" }
  | {
      kind: "replaces";
      consequence: string;
      highStakes: boolean;
      payoutCount: number;
      totalNet: number;
      numbersReturning: number[];
      reopensWeeks: number[];
    }
  | { kind: "blocked"; reason: string }
);

type Options = {
  memberName: string;
  confirmPhrase: string;
  cycleName: string;
  weeks: WeekOption[];
  numbers: {
    id: string;
    number: number;
    amount: number;
    alreadyDrawn: boolean;
    gross: number;
    fee: number;
    net: number;
  }[];
};

/**
 * The suffix in the dropdown — the state is in the label, never a disabled
 * attribute.
 *
 * THE READING THAT WENT WRONG. A drawn week with no payout rendered as
 * "Week 6 — already drawn · replacing it undoes that draw", with the money
 * silently omitted, while every other drawn week quoted a figure. That is
 * where the organizer first saw week 6's half-state. Such a week should no
 * longer exist (its draw is now removed with its last payout), but if one
 * survives from older data the label says exactly what it is.
 */
function weekLabel(w: WeekOption): string {
  if (w.kind === "free") return `Week ${w.weekNumber} — free`;
  if (w.kind === "blocked") return `Week ${w.weekNumber} — plan committed`;
  if (w.payoutCount === 0) {
    return `Week ${w.weekNumber} — drawn but holding NO payout · choosing it clears that draw`;
  }
  return (
    `Week ${w.weekNumber} — already drawn, ${formatMoney(w.totalNet)} · ` +
    `replacing it undoes that draw`
  );
}

export function AssignPayout({
  participationId,
  /** Embedded uses (the waiting list) open straight into the panel. */
  defaultOpen = false,
  /** Numbers to tick on load — the ones the calling row quoted a figure for. */
  preselectNumbers,
  onAssigned,
  onCancel,
}: {
  participationId: string;
  defaultOpen?: boolean;
  preselectNumbers?: number[];
  onAssigned?: (message: string) => void;
  /** Embedded uses close the CALLER row, so the panel shows no Cancel. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [options, setOptions] = useState<Options | null>(null);
  const [weekId, setWeekId] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    getManualPayoutOptions(participationId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setMsg({ kind: "err", text: result.error });
        return;
      }
      setOptions(result.data);
      // Default to the first GENUINELY FREE week — never a drawn one, so the
      // opening state never proposes destroying a payout.
      const firstFree = result.data.weeks.find((w) => w.kind === "free");
      setWeekId((firstFree ?? result.data.weeks[0])?.weekId ?? "");
      // Preselect what the caller quoted, else the single free number — so
      // the figures on screen match the figure that led the organizer here.
      const free = result.data.numbers.filter((n) => !n.alreadyDrawn);
      const wanted = preselectNumbers
        ? free.filter((n) => preselectNumbers.includes(n.number))
        : free.length === 1
          ? free
          : [];
      if (wanted.length > 0) setChosen(new Set(wanted.map((n) => n.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, options, participationId, preselectNumbers]);

  const selected = options?.numbers.filter((n) => chosen.has(n.id)) ?? [];
  const totals = selected.reduce(
    (acc, n) => ({ gross: acc.gross + n.gross, fee: acc.fee + n.fee, net: acc.net + n.net }),
    { gross: 0, fee: 0, net: 0 },
  );
  const week = options?.weeks.find((w) => w.weekId === weekId) ?? null;
  const replacing = week?.kind === "replaces" ? week : null;
  // An empty draw holds no money record, so there is nothing to type a name
  // for — the server relaxes the same way, and the two must agree.
  const needsPhrase = replacing !== null && replacing.payoutCount > 0;
  const blocked = week?.kind === "blocked" ? week : null;
  const canConfirm = week !== null && !blocked && selected.length > 0 && !busy;

  async function doAssign() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await assignPayoutManually({
        participationId,
        weekId,
        luckyNumberIds: [...chosen],
        notes,
        replaceConfirmation: needsPhrase ? options?.confirmPhrase : undefined,
      });
      if (!result.ok) setMsg({ kind: "err", text: `Not assigned: ${result.error}` });
      else {
        const r = result.data;
        const text =
          (r.replaced
            ? `✓ Week ${r.weekNumber}'s previous draw was undone (${r.replaced.payoutCount} payout(s), ` +
              `${formatMoney(r.replaced.totalNet)}; ${r.replaced.numbersReturned.map((n) => `#${n}`).join(", ")} back in the wheel) and `
            : "✓ ") +
          `payout assigned for week ${r.weekNumber} — ` +
          `${r.numbers.map((n) => `#${n}`).join(", ")}, ${formatMoney(r.totalNet)} net` +
          (r.settled > 0
            ? `, with ${formatMoney(r.settled)} of it settling their week-${r.weekNumber} contribution.`
            : ". It is PENDING in Collections until you mark it collected.");
        setMsg({ kind: "ok", text });
        if (onAssigned) onAssigned(text);
        setOpen(defaultOpen);
        setOptions(null);
        setChosen(new Set());
        setNotes("");
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing was assigned." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-3">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={buttonCls.secondary}>
          Assign payout…
        </button>
      ) : (
        <div className="space-y-3 rounded-2xl border-2 border-indigo-300 dark:border-indigo-800 bg-white dark:bg-[#141414] p-4">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-black text-gray-900 dark:text-white">
              Assign a payout without the wheel
            </h3>
            {/* Embedded, the caller row owns the single close control — two
                would leave the panel collapsed inside an open row. */}
            {!defaultOpen && (
              <button
                type="button"
                onClick={() => (onCancel ? onCancel() : setOpen(false))}
                className={buttonCls.ghost + " ml-auto !text-xs"}
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            The organizer&apos;s decision (2.2) — an emergency, an agreement. It records exactly
            what a draw records: the number leaves the wheel, the week is settled from the payout,
            and it appears in Collections as pending. The audit log shows it was assigned, not
            drawn.
          </p>

          {options === null ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading the options…</p>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Which week does this payout belong to?
                </span>
                <Select
                  value={weekId}
                  onChange={setWeekId}
                  ariaLabel="Payout week"
                  className="w-full max-w-md"
                  options={options.weeks.map((w) => ({ value: w.weekId, label: weekLabel(w) }))}
                />
              </label>

              {/* The consequence, computed from that week's REAL draw. */}
              {replacing && (
                <div className="space-y-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    {replacing.consequence}
                  </p>
                  <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
                    The clearing and the assignment happen together, in one transaction — the week
                    is never left with neither, and the audit entry records both.
                    {needsPhrase ? (
                      <>
                        {" "}
                        You will be asked to type <strong>{options.confirmPhrase}</strong> to
                        confirm
                        {replacing.highStakes
                          ? ", because money already collected would be un-recorded"
                          : ""}
                        .
                      </>
                    ) : (
                      " No money record is destroyed, so nothing needs to be typed."
                    )}
                  </p>
                </div>
              )}

              {blocked && (
                <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-white/5 p-3">
                  <p className="text-sm text-gray-800 dark:text-gray-200">{blocked.reason}</p>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Which lucky number? Each is a separate payout with its own fee.
                </p>
                <div className="space-y-1.5">
                  {options.numbers.map((n) => (
                    <div key={n.id} className="flex flex-wrap items-center gap-2 text-sm">
                      {n.alreadyDrawn ? (
                        <span className="flex items-center gap-2 opacity-60">
                          <span className="w-[18px]" />
                          <span className="font-semibold tabular-nums">#{n.number}</span>
                          <Pill tone="neutral">already drawn — out of the pool</Pill>
                        </span>
                      ) : (
                        <Checkbox
                          checked={chosen.has(n.id)}
                          onChange={(on) => {
                            const next = new Set(chosen);
                            if (on) next.add(n.id);
                            else next.delete(n.id);
                            setChosen(next);
                          }}
                          label={
                            <span className="tabular-nums">
                              <strong>#{n.number}</strong> {formatMoney(n.amount)}/wk —{" "}
                              {formatMoney(n.gross)} gross · {formatMoney(n.fee)} fee ·{" "}
                              <strong>{formatMoney(n.net)} net</strong>
                            </span>
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Why (kept in the audit log)
                </span>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. emergency, agreed 5 Aug"
                  className={inputCls}
                />
              </label>

              {selected.length > 0 && (
                <p className="rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-2 text-sm tabular-nums text-gray-800 dark:text-gray-200">
                  {selected.length} number{selected.length === 1 ? "" : "s"}:{" "}
                  {formatMoney(totals.gross)} gross · {formatMoney(totals.fee)} fee ·{" "}
                  <strong>{formatMoney(totals.net)} net</strong>
                </p>
              )}

              <button
                type="button"
                disabled={!canConfirm}
                onClick={() =>
                  setConfirm({
                    title: replacing
                      ? `Replace week ${week?.weekNumber}'s draw and assign ${formatMoney(totals.net)} to ${options.memberName}?`
                      : `Assign ${formatMoney(totals.net)} to ${options.memberName}?`,
                    destructive: needsPhrase,
                    requirePhrase: needsPhrase ? options.confirmPhrase : undefined,
                    body: (
                      <>
                        {replacing && <p>{replacing.consequence}</p>}
                        <p>
                          Week {week?.weekNumber} is recorded as paid out to{" "}
                          {selected.map((n) => `#${n.number}`).join(", ")} —{" "}
                          {formatMoney(totals.gross)} gross, {formatMoney(totals.fee)} fee,{" "}
                          <strong>{formatMoney(totals.net)} net</strong>.
                        </p>
                        <p>
                          {selected.length === 1 ? "That number" : "Those numbers"} leave
                          {selected.length === 1 ? "s" : ""} the wheel pool permanently (2.27), and
                          their week-{week?.weekNumber} contribution is settled from the payout. It
                          appears in Collections as PENDING until you mark it collected.
                        </p>
                        <p>
                          {replacing
                            ? "The undo and the assignment are one transaction, and the audit entry records both."
                            : "The audit entry records this as ASSIGNED MANUALLY"}
                          {notes.trim() ? `, with your reason: “${notes.trim()}”` : ""}.
                        </p>
                      </>
                    ),
                    confirmLabel: replacing ? "Replace and assign" : "Assign the payout",
                  })
                }
                className={buttonCls.primary}
              >
                Review and assign…
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => void doAssign()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
