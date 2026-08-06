"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  autoArrangeSlots,
  cancelWinnerPlan,
  createWinnerPlan,
  reshuffleSlots,
  saveSlots,
} from "@/app/actions/wheel";
import {
  addSlot,
  deleteSlot,
  emptySlotToUnassigned,
  isDirty,
  moveNumber,
  toSavePayload,
  type Draft,
  type MoveDestination,
  type NumberLocks,
} from "@/lib/arrangement";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { formatMoney } from "@/lib/format";

type NumberInfo = {
  id: string;
  number: number;
  /** null in presentation mode — money is never sent (2.4). */
  amount: number | null;
  owner: string;
  eligible: boolean;
  /** Server-decided: frozen = cannot move; anchored = slots-only. In
   *  presentation mode every lock arrives as "frozen" with no reason. */
  lock: "frozen" | "anchored" | null;
  lockReason: string | null;
};

type SetupState = {
  presentation: boolean;
  cycleName: string;
  unitAmount: number | null;
  currentWeek: number;
  slots: { id: string; position: number; drawn: boolean; members: NumberInfo[]; total: number | null }[];
  unassigned: NumberInfo[];
  plans: { id: string; mode: string; weekNumber: number | null; numbers: number[] }[];
  weeks: { id: string; weekNumber: number; hasDraw: boolean; planned: boolean }[];
  warnings: { participationId: string; name: string; finishWeek: number; weeksLeft: number; numbers: number[] }[];
};

export function WheelSetup({ state }: { state: SetupState }) {
  const router = useRouter();

  // ————— the local draft: arrange freely, save once (2.10) —————
  const numberById = useMemo(() => {
    const map = new Map<string, NumberInfo>();
    for (const s of state.slots) for (const m of s.members) map.set(m.id, m);
    for (const n of state.unassigned) map.set(n.id, n);
    return map;
  }, [state]);

  const locks: NumberLocks = useMemo(
    () => ({
      frozenIds: new Set([...numberById.values()].filter((n) => n.lock === "frozen").map((n) => n.id)),
      anchoredIds: new Set([...numberById.values()].filter((n) => n.lock === "anchored").map((n) => n.id)),
    }),
    [numberById],
  );

  const original: Draft = useMemo(
    () => ({
      slots: state.slots.map((s) => ({
        key: s.id,
        id: s.id,
        luckyNumberIds: s.members.map((m) => m.id),
        locked: s.drawn || s.members.some((m) => m.lock === "frozen"),
      })),
      unassigned: state.unassigned.map((n) => n.id),
    }),
    [state],
  );
  const [draft, setDraft] = useState<Draft>(original);
  // After a save/refresh the server sends a NEW arrangement (new slots gain
  // real ids) — sync the draft to it, or "unsaved changes" would stick.
  const originalKey = useMemo(() => JSON.stringify(original), [original]);
  const [syncedKey, setSyncedKey] = useState(originalKey);
  if (originalKey !== syncedKey) {
    setSyncedKey(originalKey);
    setDraft(original);
  }
  const dirty = isDirty(original, draft);

  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedNumber, setPickedNumber] = useState<string | null>(null);
  const [planNumbers, setPlanNumbers] = useState<Set<string>>(new Set());
  const [planMode, setPlanMode] = useState<"ALONE" | "TOGETHER" | "OPEN_PARTNER">("ALONE");
  const [planWeekId, setPlanWeekId] = useState("");
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  function ask(spec: ConfirmSpec, fn: () => void) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      fn();
      setConfirm(null);
      setOnConfirm(null);
    });
  }

  // The draft lives only in this component — guard against losing it to a
  // reload/close (beforeunload) or an in-app link click (capture-phase
  // intercept; preventDefault stops Next's Link navigation, then the
  // designed dialog decides).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onDocClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(anchor.getAttribute("href"));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocClick, true);
    };
  }, [dirty]);

  function applyMove(numberId: string, destination: MoveDestination) {
    const result = moveNumber(draft, numberId, destination, locks);
    if (result.error) setBanner({ kind: "err", text: result.error });
    else {
      setDraft(result.draft!);
      setBanner(null);
    }
    setPickedNumber(null);
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    setBanner(null);
    try {
      const result = await fn();
      if (!result.ok) setBanner({ kind: "err", text: result.error ?? "Failed." });
      else {
        setBanner({ kind: "ok", text: okText });
        router.refresh();
      }
    } catch {
      setBanner({ kind: "err", text: "Could not reach the server — nothing was confirmed." });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    void run(async () => {
      const result = await saveSlots({ slots: toSavePayload(draft) });
      return result;
    }, "✓ Arrangement saved.");
  }

  // ————— empty-wheel notice (requirement 6) —————
  const drawnSlotIds = useMemo(
    () => new Set(state.slots.filter((s) => s.drawn).map((s) => s.id)),
    [state],
  );
  const spinnableSlots = draft.slots.filter(
    (s) => s.luckyNumberIds.length > 0 && !drawnSlotIds.has(s.key),
  ).length;
  const eligibleUnassigned = draft.unassigned.filter((id) => numberById.get(id)?.eligible).length;
  const wheelIsEmpty = spinnableSlots === 0 && eligibleUnassigned > 0;

  async function autoArrangeEverything() {
    setBusy(true);
    setBanner(null);
    try {
      const proposal = await autoArrangeSlots();
      if (!proposal.ok) return setBanner({ kind: "err", text: proposal.error });
      // The proposal is computed against SAVED state; this button is only
      // enabled when the draft is clean, so the two cannot diverge.
      const payload = [
        ...toSavePayload(draft),
        ...proposal.data.proposal.map((s) => ({ id: null, luckyNumberIds: s.luckyNumberIds })),
      ];
      const saved = await saveSlots({ slots: payload });
      if (!saved.ok) return setBanner({ kind: "err", text: saved.error });
      setBanner({ kind: "ok", text: "✓ All unassigned numbers arranged onto the wheel." });
      router.refresh();
    } catch {
      setBanner({ kind: "err", text: "Could not reach the server — nothing was confirmed." });
    } finally {
      setBusy(false);
    }
  }

  // ————— chips —————
  const chip = (id: string) => {
    const n = numberById.get(id);
    if (!n) return null;
    const inLockedSlot = draft.slots.find((s) => s.luckyNumberIds.includes(id))?.locked ?? false;
    const immovable = n.lock === "frozen" || inLockedSlot;
    const picked = pickedNumber === id;
    const lockText =
      n.lock || inLockedSlot
        ? ` — locked: ${n.lockReason ?? (inLockedSlot && !n.lock ? "sits with a locked number" : "locked")}`
        : "";
    const identity = [n.owner, n.amount !== null ? formatMoney(n.amount) : null]
      .filter(Boolean)
      .join(" — ");
    const chipTone = picked
      ? "border-indigo-600 bg-indigo-600 text-white"
      : immovable
        ? "cursor-not-allowed border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400"
        : n.eligible
          ? "border-[var(--gold-badge-border)] text-[var(--gold-badge-text)] hover:border-indigo-400"
          : "border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300";
    return (
      <span
        key={id}
        draggable={!immovable && !busy}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
        }}
        title={`${identity || `#${n.number}`}${lockText}${n.eligible ? "" : " — not in the pool (window closed or not started)"}`}
      >
        <button
          type="button"
          disabled={busy || immovable}
          onClick={(e) => {
            // Without this, the click bubbles to the slot/tray container's
            // click-to-move handler and MOVES the previously picked number.
            e.stopPropagation();
            setPickedNumber(picked ? null : id);
          }}
          style={!picked && !immovable && n.eligible ? { background: "var(--gold-badge-bg)" } : undefined}
          className={`inline-flex select-none items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold tabular-nums transition-[border-color,transform] duration-150 ease-out active:scale-95 ${chipTone}`}
        >
          #{n.number}
          {n.amount !== null && <span className="font-semibold opacity-75">{formatMoney(n.amount)}</span>}
          {(n.lock || inLockedSlot) && (
            <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          )}
        </button>
      </span>
    );
  };

  // `busy` gates moves too: a move landed during an in-flight Save/Reshuffle
  // would be overwritten by that request's stale draft and silently lost.
  const dropProps = (destination: MoveDestination, disabled = false) => ({
    onDragOver: (e: DragEvent) => {
      if (!disabled && !busy) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (disabled || busy) return;
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      if (id) applyMove(id, destination);
    },
    onClick: () => {
      if (!disabled && !busy && pickedNumber) applyMove(pickedNumber, destination);
    },
  });

  return (
    <div className="space-y-8">
      {banner && (
        <p
          role={banner.kind === "err" ? "alert" : "status"}
          className={`rounded-xl border px-3.5 py-2.5 text-sm ${banner.kind === "err" ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"}`}
        >
          {banner.text}
        </p>
      )}

      {wheelIsEmpty && (
        <section className="rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm shadow-sm">
          <p className="mb-2 font-bold text-amber-900 dark:text-amber-300">
            The wheel is EMPTY — {eligibleUnassigned} eligible number
            {eligibleUnassigned === 1 ? "" : "s"} are unassigned, so there is nothing to spin.
          </p>
          <button
            type="button"
            disabled={busy || dirty}
            title={dirty ? "Save or discard your changes first" : undefined}
            onClick={() => void autoArrangeEverything()}
            className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97] disabled:opacity-40"
          >
            Auto-arrange all unassigned numbers
          </button>
          {dirty && (
            <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-400">
              Save or discard your changes first.
            </p>
          )}
        </section>
      )}

      {state.warnings.length > 0 && (
        <section className="rounded-2xl border-2 border-red-500 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-bold text-red-900 dark:text-red-300">
            Windows ending undrawn — draw these members soon
          </h2>
          <ul className="space-y-0.5 text-sm text-red-900 dark:text-red-300">
            {state.warnings.map((w) => (
              <li key={w.participationId}>
                <strong>{w.name}</strong> — window ends week {w.finishWeek}
                {w.weeksLeft > 0 ? ` (${w.weeksLeft} week${w.weeksLeft === 1 ? "" : "s"} left)` : " (ALREADY CLOSING)"}{" "}
                and they have not been drawn. Numbers: {w.numbers.map((n) => `#${n}`).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ————— Slots ————— */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-black text-gray-900 dark:text-white">
            {state.unitAmount === null ? "Slots" : `Slots (unit ${formatMoney(state.unitAmount)})`}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => setDraft(addSlot(draft))}
            className="inline-flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-3.5 py-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40"
          >
            Add slot
          </button>
          <button
            type="button"
            disabled={busy || dirty}
            title={dirty ? "Save or discard your changes first" : undefined}
            onClick={() =>
              void (async () => {
                setBusy(true);
                setBanner(null);
                try {
                  // Only reachable with a CLEAN draft — the proposal is
                  // computed against SAVED state, so merging into a dirty
                  // draft would duplicate or vanish numbers.
                  const result = await reshuffleSlots();
                  if (!result.ok) return setBanner({ kind: "err", text: result.error });
                  // Keep locked slots AND empty slots (they persist — never
                  // silently dropped); the proposal replaces the free ones.
                  const kept = draft.slots.filter(
                    (s) => s.locked || s.luckyNumberIds.length === 0,
                  );
                  setDraft({
                    slots: [
                      ...kept,
                      ...result.data.proposedSlots.map((s, i) => ({
                        key: `proposal-${Date.now()}-${i}`,
                        id: null,
                        luckyNumberIds: [...s.luckyNumberIds],
                        locked: false,
                      })),
                    ],
                    unassigned: draft.unassigned,
                  });
                  setBanner({ kind: "ok", text: "Reshuffle applied to the DRAFT — press Save to keep it, Discard to revert." });
                } catch {
                  setBanner({ kind: "err", text: "Could not reach the server — nothing was confirmed." });
                } finally {
                  setBusy(false);
                }
              })()
            }
            className="inline-flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-3.5 py-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40"
          >
            Reshuffle (draft)
          </button>
          <span className="ml-auto flex items-center gap-2">
            {dirty && (
              <span className="rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-400">
                unsaved changes
              </span>
            )}
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={save}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97] disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save arrangement"}
            </button>
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => {
                setDraft(original);
                setBanner({ kind: "ok", text: "Draft discarded — back to the last saved arrangement." });
              }}
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-4 py-2 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40"
            >
              Discard
            </button>
          </span>
        </div>
        {pickedNumber && (
          <p className="mb-2 text-sm text-gray-700">
            Moving #{numberById.get(pickedNumber)?.number} — click a slot, the tray, or{" "}
            <button type="button" onClick={() => applyMove(pickedNumber, { kind: "new-slot" })} className="underline">
              a new slot
            </button>
            . (Drag also works.)
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {draft.slots.map((s, index) => {
            const total = s.luckyNumberIds.reduce((sum, id) => sum + (numberById.get(id)?.amount ?? 0), 0);
            const over = state.unitAmount !== null && total > state.unitAmount;
            return (
              <div
                key={s.key}
                {...dropProps({ kind: "slot", key: s.key }, s.locked)}
                className={`rounded-2xl border p-3 shadow-sm transition-colors duration-150 ${
                  s.locked
                    ? "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03]"
                    : pickedNumber
                      ? "cursor-pointer border-2 border-dashed border-indigo-500 bg-white dark:bg-[#141414]"
                      : "border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] hover:border-indigo-300 dark:hover:border-indigo-700"
                }`}
              >
                <p className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                    Slot {index + 1}
                    {s.locked && (
                      <svg className="ml-1 inline h-3 w-3 -translate-y-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="locked">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                    )}
                    {s.id === null && <span className="ml-1 font-medium normal-case text-indigo-600 dark:text-indigo-400">(new)</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`tabular-nums ${over ? "font-bold text-amber-700 dark:text-amber-400" : "text-gray-700 dark:text-gray-300"}`}
                    >
                      {state.unitAmount === null
                        ? `${s.luckyNumberIds.length} number${s.luckyNumberIds.length === 1 ? "" : "s"}`
                        : `${formatMoney(total)} / ${formatMoney(state.unitAmount)}${over ? " (over unit)" : ""}`}
                    </span>
                    {!s.locked && (
                      <button
                        type="button"
                        disabled={busy}
                        title={s.luckyNumberIds.length > 0 ? "Holds numbers — you will be offered to move them to Unassigned" : "Delete this empty slot"}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (s.luckyNumberIds.length === 0) {
                            const result = deleteSlot(draft, s.key);
                            if (result.error) setBanner({ kind: "err", text: result.error });
                            else setDraft(result.draft!);
                            return;
                          }
                          const held = s.luckyNumberIds
                            .map((id) => `#${numberById.get(id)?.number ?? "?"}`)
                            .join(", ");
                          ask(
                            {
                              title: "Delete this slot?",
                              body: (
                                <p>
                                  It holds {held}. The number
                                  {s.luckyNumberIds.length === 1 ? " moves" : "s move"} to
                                  Unassigned (off the wheel) and the slot is deleted. Nothing is
                                  saved until you press Save arrangement.
                                </p>
                              ),
                              confirmLabel: "Move numbers and delete",
                            },
                            () => {
                              const emptied = emptySlotToUnassigned(draft, s.key, locks);
                              if (emptied.error) return setBanner({ kind: "err", text: emptied.error });
                              const deleted = deleteSlot(emptied.draft!, s.key);
                              if (deleted.error) return setBanner({ kind: "err", text: deleted.error });
                              setDraft(deleted.draft!);
                            },
                          );
                        }}
                        className="rounded border border-gray-300 px-1.5 text-xs disabled:opacity-40"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </p>
                <div className="flex min-h-7 flex-wrap gap-1.5">
                  {s.luckyNumberIds.length === 0 ? (
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      empty — drop numbers here
                    </span>
                  ) : (
                    s.luckyNumberIds.map((id) => chip(id))
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ————— The unassigned tray ————— */}
        <div
          {...dropProps({ kind: "unassigned" })}
          className={`mt-3 rounded-2xl border-2 border-dashed p-3 transition-colors duration-150 ${
            pickedNumber
              ? "cursor-pointer border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20"
              : "border-gray-300 dark:border-gray-700"
          }`}
        >
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Unassigned ({draft.unassigned.length}) — not on the wheel. Drop a number here to take
            it off.
          </p>
          <div className="flex min-h-7 flex-wrap gap-1.5">
            {draft.unassigned.length === 0 ? (
              <span className="text-xs text-gray-600 dark:text-gray-400">empty</span>
            ) : (
              draft.unassigned.map((id) => chip(id))
            )}
          </div>
        </div>
      </section>

      {/* ————— Winner planning (2.3) — never rendered in presentation mode:
            the server sent no plans and no committed/planned indicators. ————— */}
      {!state.presentation && (
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-4 shadow-sm">
        <h2 className="mb-1 text-base font-black text-gray-900 dark:text-white">Winner planning</h2>
        <p className="mb-2 text-xs text-gray-600 dark:text-gray-400">
          Pick numbers, choose how they win, assign a week. Committing locks them: no shuffle,
          drag, or manual move can separate or re-pair a committed number.
        </p>
        <div className="mb-2 flex flex-wrap gap-1">
          {[...numberById.values()]
            .filter((n) => n.eligible && n.lock === null)
            .sort((a, b) => a.number - b.number)
            .map((n) => (
              <label
                key={n.id}
                className={`flex cursor-pointer select-none items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] focus-within:ring-2 focus-within:ring-indigo-500/40 ${
                  planNumbers.has(n.id)
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/50 font-semibold text-indigo-900 dark:text-indigo-200"
                    : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={planNumbers.has(n.id)}
                  onChange={(e) => {
                    const next = new Set(planNumbers);
                    if (e.target.checked) next.add(n.id);
                    else next.delete(n.id);
                    setPlanNumbers(next);
                  }}
                />
                #{n.number} <span className="text-gray-500 dark:text-gray-400">{n.owner}</span>
              </label>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select<"ALONE" | "TOGETHER" | "OPEN_PARTNER">
            value={planMode}
            onChange={setPlanMode}
            ariaLabel="How the planned numbers win"
            className="w-72"
            options={[
              { value: "ALONE", label: "Win alone" },
              { value: "TOGETHER", label: "Win together (same week)" },
              { value: "OPEN_PARTNER", label: "Open partner (shuffle may attach one)" },
            ]}
          />
          <Select
            value={planWeekId}
            onChange={setPlanWeekId}
            ariaLabel="Planned week"
            className="w-40"
            options={[
              { value: "", label: "No week yet" },
              ...state.weeks
                .filter((w) => !w.hasDraw && !w.planned)
                .map((w) => ({ value: w.id, label: `Week ${w.weekNumber}` })),
            ]}
          />
          <button
            type="button"
            disabled={busy || planNumbers.size === 0 || dirty}
            title={dirty ? "Save or discard the arrangement first" : undefined}
            onClick={() => {
              const picked = [...planNumbers]
                .map((id) => `#${numberById.get(id)?.number ?? "?"}`)
                .join(" + ");
              const weekLabel = state.weeks.find((w) => w.id === planWeekId)?.weekNumber;
              ask(
                {
                  title: `Commit ${picked} as ${planMode}?`,
                  destructive: false,
                  body: (
                    <p>
                      {planWeekId ? `They win week ${weekLabel}. ` : "No week is assigned yet. "}
                      Committed numbers are LOCKED (2.3): no shuffle, drag, or manual move can
                      separate or re-pair them until the plan is cancelled or fulfilled.
                    </p>
                  ),
                  confirmLabel: "Create plan",
                },
                () =>
                  void run(async () => {
                    const result = await createWinnerPlan({
                      luckyNumberIds: [...planNumbers],
                      mode: planMode,
                      weekId: planWeekId || undefined,
                    });
                    if (result.ok) setPlanNumbers(new Set());
                    return result;
                  }, "✓ Plan saved — numbers locked."),
              );
            }}
            className="rounded-xl bg-indigo-600 px-3.5 py-2 font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97] disabled:opacity-40"
          >
            Create plan
          </button>
        </div>

        {state.plans.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {state.plans.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span>
                  {p.numbers.map((n) => `#${n}`).join(" + ")} — {p.mode}
                  {p.weekNumber !== null ? `, week ${p.weekNumber}` : ", no week yet"}
                </span>
                <button
                  type="button"
                  disabled={busy || dirty}
                  title={dirty ? "Save or discard your arrangement changes first" : undefined}
                  onClick={() =>
                    ask(
                      {
                        title: `Cancel the plan for ${p.numbers.map((n) => `#${n}`).join(" + ")}?`,
                        body: (
                          <p>
                            The number{p.numbers.length === 1 ? "" : "s"} unlock
                            {p.numbers.length === 1 ? "s" : ""} and the shuffle may move them
                            again{p.weekNumber !== null ? ` — week ${p.weekNumber} loses its planned winner` : ""}.
                          </p>
                        ),
                        confirmLabel: "Cancel the plan",
                      },
                      () => void run(() => cancelWinnerPlan({ planId: p.id }), "✓ Plan cancelled — numbers unlocked."),
                    )
                  }
                  className="rounded border border-red-400 px-2 py-0.5 text-xs text-red-800 disabled:opacity-40"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
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
      <ConfirmDialog
        spec={
          leaveTo !== null
            ? {
                title: "Leave with unsaved arrangement changes?",
                body: (
                  <p>
                    Your dragged arrangement is NOT saved — the wheel still shows the last saved
                    arrangement. Leaving discards the draft.
                  </p>
                ),
                confirmLabel: "Discard and leave",
              }
            : null
        }
        onConfirm={() => {
          if (leaveTo) window.location.assign(leaveTo);
        }}
        onCancel={() => setLeaveTo(null)}
      />
    </div>
  );
}
