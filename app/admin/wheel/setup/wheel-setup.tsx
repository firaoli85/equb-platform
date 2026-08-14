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
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { SegmentedToggle, usePersistedChoice } from "@/components/ui/view-toggle";
import { formatMoney } from "@/lib/format";
import {
  winnerPlanArityRefusal,
  winnerPlanConfirmation,
  winnerPlanModeLabel,
  type WinnerPlanMode,
} from "@/lib/wheel";
import { buttonCls } from "@/components/ui/primitives";

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
  plans: { id: string; mode: WinnerPlanMode; weekNumber: number | null; numbers: number[] }[];
  weeks: { id: string; weekNumber: number; hasDraw: boolean; planned: boolean }[];
  warnings: { participationId: string; name: string; finishWeek: number; weeksLeft: number; numbers: number[] }[];
};

/**
 * TWO JOBS, and the order is the order he does them: put the numbers where they
 * go, then decide who is committed to which week.
 */
const SECTIONS = ["arrange", "plan"] as const;
type Section = (typeof SECTIONS)[number];

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

  // TWO JOBS, ONE AT A TIME (the same split Messages and the cycle position
  // already use).
  //
  // This screen asked one question — "is the wheel ready to spin this week?" —
  // and stacked six blocks before answering it: a banner, the empty-wheel
  // prompt, the undrawn warnings, the slot grid with five controls, the
  // unassigned tray, and a winner planner with a checkbox for EVERY eligible
  // number. It is the screen the organizer drives live on a shared call.
  //
  // EVERY NUMBER WAS DRAWN TWICE on it: as a draggable chip in a slot or the
  // tray, and again as a checkbox in the planner. Two representations of one
  // object on one screen is what 2.19 rules out. Split, they are two different
  // jobs on two screens — on ARRANGE a number is a thing you move, on PLAN
  // WINNERS it is a thing you choose — which is the honest reading of why both
  // exist.
  //
  // CLIENT STATE, not a `?section=` link, and deliberately: the draft, its
  // dirty flag and the drag state all live here, so a server round trip would
  // throw away unsaved work every time he changed section. Switching sections
  // now costs nothing and loses nothing.
  const [section, setSection] = usePersistedChoice<Section>(
    "admin-wheel-setup-section",
    SECTIONS,
    "arrange",
  );

  /**
   * WHICH CONTROL A MESSAGE BELONGS TO.
   *
   * One `banner` at the top served six actions, the furthest — Create plan —
   * some 370 lines below it, on a screen that scrolls. Now each action reports
   * at itself. One state so two controls can never disagree; the slot decides
   * which one renders it.
   */
  const [save, setSave] = useState<{ slot: string; state: SaveState }>({
    slot: "",
    state: { kind: "idle" },
  });
  const busy = save.state.kind === "saving";
  const feedbackFor = (slot: string): SaveState =>
    save.slot === slot ? save.state : { kind: "idle" };
  const [pickedNumber, setPickedNumber] = useState<string | null>(null);
  const [planNumbers, setPlanNumbers] = useState<Set<string>>(new Set());
  const [planMode, setPlanMode] = useState<WinnerPlanMode>("ALONE");
  const [planWeekId, setPlanWeekId] = useState("");
  /**
   * A refusal from `createWinnerPlan`, rendered UNDER the Create plan button
   * (UI_STANDARDS 6b). It used to land only in the page-level banner at the
   * top of a long screen — the organizer pressed the button, nothing visible
   * changed, and the reason was 400 lines above him. Cleared whenever the
   * selection or the mode changes, so a reason can never outlive its cause
   * (§5.15).
   */
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  /**
   * Confirm, run, and CLOSE ONLY ON SUCCESS.
   *
   * This called `fn()` and then `setConfirm(null)` on the very next line —
   * synchronously, before the async action it had just started could possibly
   * have resolved. So the dialog always closed, whatever came back, and
   * `setDialogError` was only ever called with `null`, from `onCancel`. The
   * `error` slot was wired to the dialog and nothing could fill it: a refusal
   * from any of the three confirmations here was discarded with the dialog
   * that existed to show it (UI_STANDARDS 6b).
   *
   * `lib/refusal-placement.test.ts` passed the whole time, because it checked
   * that the slot EXISTS. Existing and being reachable are different
   * properties, and lib/save-feedback.test.ts now owns the second one.
   *
   * `fn` returns the refusal, or null/void on success.
   */
  function ask(spec: ConfirmSpec, fn: () => Promise<string | null | void> | void) {
    setDialogError(null);
    setConfirm(spec);
    setOnConfirm(() => () => {
      void (async () => {
        const refused = await fn();
        if (typeof refused === "string" && refused.length > 0) {
          setDialogError(refused);
          return;
        }
        setConfirm(null);
        setOnConfirm(null);
      })();
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
    // A REFUSED MOVE IS NOT A FAILED SAVE — nothing was sent anywhere. It is
    // the arrangement telling him a locked number cannot go there (rule 13),
    // so it reports at the slot grid, which is what he was touching.
    if (result.error) setSave({ slot: "arrangement", state: { kind: "err", message: result.error } });
    else {
      setDraft(result.draft!);
      setSave({ slot: "arrangement", state: { kind: "idle" } });
    }
    setPickedNumber(null);
  }

  /** Returns the refusal, or null — so a caller can keep its dialog open. */
  async function run(
    slot: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okText: string,
  ): Promise<string | null> {
    setSave({ slot, state: { kind: "saving" } });
    try {
      const result = await fn();
      if (!result.ok) {
        const refused = result.error ?? "Failed.";
        setSave({ slot, state: { kind: "err", message: refused } });
        return refused;
      }
      setSave({ slot, state: { kind: "ok", message: okText } });
      router.refresh();
      return null;
    } catch {
      const refused = "Could not reach the server — nothing was confirmed.";
      setSave({ slot, state: { kind: "err", message: refused } });
      return refused;
    }
  }

  function saveArrangement() {
    void run(
      "arrangement",
      () => saveSlots({ slots: toSavePayload(draft) }),
      `Arrangement saved — ${draft.slots.length} slot${draft.slots.length === 1 ? "" : "s"}, ${draft.unassigned.length} number${draft.unassigned.length === 1 ? "" : "s"} still unassigned.`,
    );
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
    const slot = "auto-arrange";
    setSave({ slot, state: { kind: "saving" } });
    const refuse = (message: string) => setSave({ slot, state: { kind: "err", message } });
    try {
      const proposal = await autoArrangeSlots();
      if (!proposal.ok) return refuse(proposal.error);
      // The proposal is computed against SAVED state; this button is only
      // enabled when the draft is clean, so the two cannot diverge.
      const payload = [
        ...toSavePayload(draft),
        ...proposal.data.proposal.map((s) => ({ id: null, luckyNumberIds: s.luckyNumberIds })),
      ];
      const saved = await saveSlots({ slots: payload });
      if (!saved.ok) return refuse(saved.error);
      setSave({
        slot,
        state: {
          kind: "ok",
          message: `All ${eligibleUnassigned} unassigned number${eligibleUnassigned === 1 ? "" : "s"} arranged onto the wheel and saved.`,
        },
      });
      router.refresh();
    } catch {
      refuse("Could not reach the server — nothing was confirmed.");
    }
  }

  // ————— winner planning (2.3): what this selection can be committed as —————
  // The numbers he ticked, in his order of reading rather than click order.
  const planPickedNumbers = useMemo(
    () =>
      [...planNumbers]
        .map((id) => numberById.get(id)?.number)
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b),
    [planNumbers, numberById],
  );
  /**
   * Non-null when the selection cannot be committed as declared — the same
   * function `createWinnerPlan` runs, so the sentence he reads here is the
   * sentence the server would have sent back (2.3). Knowable before the
   * request, so it is said at the control rather than round-tripped
   * (UI_STANDARDS 6b, last row).
   */
  /**
   * THE HIDDEN COUPLING, MADE PLAIN.
   *
   * "Create plan" was `disabled={busy || dirty}` with the reason in a `title`
   * — a hover, on a control ~370 lines below the drag surface that caused it.
   * The organizer would arrange slots, scroll down, tick two numbers, and find
   * a dead button with no visible explanation. Split across sections it got
   * worse, not better: the cause is now on a screen he cannot even see.
   *
   * The coupling is REAL and cannot simply be removed — `createWinnerPlan`
   * writes a new slot on the server, and it is computed against SAVED state,
   * so committing over an unsaved arrangement would resolve two different
   * pictures of the wheel into one write. So it is stated instead, at the
   * control, naming the section and carrying the way back to it.
   */
  const arrangementRefusal = dirty
    ? "The arrangement has unsaved changes. A plan is committed against the SAVED wheel, so save or discard them on Arrange first."
    : null;

  const planRefusal = winnerPlanArityRefusal({
    mode: planMode,
    count: planNumbers.size,
    numbers: planPickedNumbers,
  });

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
    <div className="space-y-6">
      {/* ABOVE THE SPLIT, DELIBERATELY. These two are claims about the WHOLE
          wheel — it is empty, or somebody's window is closing undrawn — and
          hiding either behind a section would mean the organizer could be
          looking straight at the screen that owns the problem and not see it. */}
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
          <SaveFeedback state={feedbackFor("auto-arrange")} className="mt-2" />
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

      {/* PRESENTATION MODE HIDES PLANNING, so it must not be offered: the
          section body is gated on !presentation, the choice persists in
          localStorage, and the page could therefore OPEN on a blank screen
          during a screen share. */}
      <SegmentedToggle
        label="Wheel setup"
        value={state.presentation ? "arrange" : section}
        onChange={setSection}
        options={
          state.presentation
            ? [{ value: "arrange", label: "Arrange" }]
            : [
                { value: "arrange", label: "Arrange" },
                { value: "plan", label: "Plan winners" },
              ]
        }
      />

      {/* THE UNSAVED-WORK NOTICE FOLLOWS HIM. On Arrange it sits with the Save
          and Discard buttons that resolve it; on Plan winners it is the reason
          Create plan is dead, so it appears there too, with the way back. */}
      {dirty && section === "plan" && (
        <p
          data-testid="arrangement-dirty-notice"
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {arrangementRefusal}
          <button
            type="button"
            onClick={() => setSection("arrange")}
            className="ml-auto text-xs font-bold text-amber-900 underline underline-offset-2 dark:text-amber-200"
          >
            Go to Arrange
          </button>
        </p>
      )}

      {/* ————— Slots ————— */}
      <section className={section === "arrange" ? "" : "hidden"}>
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
                setSave({ slot: "arrangement", state: { kind: "saving" } });
                try {
                  // Only reachable with a CLEAN draft — the proposal is
                  // computed against SAVED state, so merging into a dirty
                  // draft would duplicate or vanish numbers.
                  const result = await reshuffleSlots();
                  if (!result.ok)
                    return setSave({
                      slot: "arrangement",
                      state: { kind: "err", message: result.error },
                    });
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
                  setSave({
                    slot: "arrangement",
                    state: {
                      kind: "ok",
                      message:
                        "Reshuffle applied to the DRAFT — press Save to keep it, Discard to revert.",
                    },
                  });
                } catch {
                  setSave({
                    slot: "arrangement",
                    state: {
                      kind: "err",
                      message: "Could not reach the server — nothing was confirmed.",
                    },
                  });
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
            <SaveButton
              state={feedbackFor("arrangement")}
              onSave={saveArrangement}
              onStateSettled={() => setSave({ slot: "arrangement", state: { kind: "idle" } })}
              label="Save arrangement"
              dirty={dirty}
              disabled={busy}
              notDirtyHint="The arrangement matches what is saved."
            />
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => {
                setDraft(original);
                setSave({
                  slot: "arrangement",
                  state: {
                    kind: "ok",
                    message: "Draft discarded — back to the last saved arrangement.",
                  },
                });
              }}
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-4 py-2 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40"
            >
              Discard
            </button>
          </span>
        </div>
        {/* Every arrangement action — move, reshuffle, save, discard, a slot
            edit — reports in this ONE place, directly under the row of buttons
            that produce it and above the grid they act on. */}
        <SaveFeedback state={feedbackFor("arrangement")} className="mb-2" />
        {pickedNumber && (
          <p className="mb-2 text-sm text-gray-700">
            Moving #{numberById.get(pickedNumber)?.number} — click a slot, the tray, or{" "}
            <button type="button" onClick={() => applyMove(pickedNumber, { kind: "new-slot" })} className="underline">
              a new slot
            </button>
            . (Drag also works.)
          </p>
        )}

        {draft.slots.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            No slots yet. Add one and drag numbers into it, or use auto-arrange to fill the wheel
            from the unassigned numbers above.
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
                            if (result.error)
                              setSave({ slot: "arrangement", state: { kind: "err", message: result.error } });
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
                              if (emptied.error)
                                return setSave({
                                  slot: "arrangement",
                                  state: { kind: "err", message: emptied.error },
                                });
                              const deleted = deleteSlot(emptied.draft!, s.key);
                              if (deleted.error)
                                return setSave({
                                  slot: "arrangement",
                                  state: { kind: "err", message: deleted.error },
                                });
                              setDraft(deleted.draft!);
                            },
                          );
                        }}
                        className={buttonCls.ghost + " !px-2 !py-0.5 !text-xs disabled:opacity-40"}
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
      <section
        className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-4 shadow-sm ${section === "plan" ? "" : "hidden"}`}
      >
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
                    setPlanError(null); // the refusal was about the old selection
                  }}
                />
                #{n.number} <span className="text-gray-500 dark:text-gray-400">{n.owner}</span>
              </label>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* The labels come from lib/wheel so the refusal below quotes the
              option he actually chose, word for word. */}
          <Select<WinnerPlanMode>
            value={planMode}
            onChange={(mode) => {
              setPlanMode(mode);
              setPlanError(null); // the refusal was about the old mode
            }}
            ariaLabel="How the planned numbers win"
            className="w-72"
            options={[
              { value: "ALONE", label: winnerPlanModeLabel("ALONE") },
              { value: "TOGETHER", label: winnerPlanModeLabel("TOGETHER") },
              { value: "OPEN_PARTNER", label: winnerPlanModeLabel("OPEN_PARTNER") },
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
            disabled={busy || arrangementRefusal !== null || planRefusal !== null}
            onClick={() => {
              // BOTH RULES AGAIN, AT THE PRESS. `disabled` is a hint the DOM
              // can lose (a stale render, a scripted click); this handler is
              // what actually runs, and the server checks the arity a third
              // time. The unsaved-arrangement reason is checked here too, so
              // it can never be the silent half of a dead button.
              if (arrangementRefusal !== null) {
                setPlanError(arrangementRefusal);
                return;
              }
              if (planRefusal !== null) {
                setPlanError(planRefusal);
                return;
              }
              const weekNumber = state.weeks.find((w) => w.id === planWeekId)?.weekNumber ?? null;
              // The title and the effect describe THIS plan, built from the
              // same labels as the refusal. It used to read "Commit #3 + #7
              // as ALONE?" — the database's word, over a write that paired
              // them, approved by the organizer on the way past.
              const { title, effect } = winnerPlanConfirmation({
                mode: planMode,
                numbers: planPickedNumbers,
                weekNumber,
              });
              ask(
                {
                  title,
                  destructive: false,
                  body: (
                    <p>
                      {effect} Committed numbers are LOCKED (2.3): no shuffle, drag, or manual
                      move can separate or re-pair them until the plan is cancelled or
                      fulfilled.
                    </p>
                  ),
                  confirmLabel: "Create plan",
                },
                async () => {
                    setSave({ slot: "plan", state: { kind: "saving" } });
                    setPlanError(null);
                    try {
                      const result = await createWinnerPlan({
                        luckyNumberIds: [...planNumbers],
                        mode: planMode,
                        weekId: planWeekId || undefined,
                      });
                      if (!result.ok) {
                        // AT the control (UI_STANDARDS 6b). The banner fires
                        // too — never instead of this.
                        //
                        // `result.error` is optional on the action's union, so
                        // it is narrowed here rather than asserted: a refusal
                        // that arrives without a reason must still SAY
                        // something, or the control goes quiet on the one
                        // outcome it exists to report.
                        const reason = result.error ?? "The plan was refused, with no reason given.";
                        setPlanError(reason);
                        setSave({ slot: "plan", state: { kind: "err", message: reason } });
                        // Returned, so the dialog STAYS OPEN carrying it.
                        return reason;
                      }
                      setPlanNumbers(new Set());
                      setSave({
                        slot: "plan",
                        state: {
                          kind: "ok",
                          message: `Plan committed — ${planPickedNumbers.length === 1 ? "that number is" : "those numbers are"} locked to their slot and cannot be shuffled or dragged.`,
                        },
                      });
                      router.refresh();
                      return null;
                    } catch {
                      const text = "Could not reach the server — nothing was confirmed.";
                      setPlanError(text);
                      setSave({ slot: "plan", state: { kind: "err", message: text } });
                      return text;
                    }
                  },
              );
            }}
            className="rounded-xl bg-indigo-600 px-3.5 py-2 font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97] disabled:opacity-40"
          >
            Create plan
          </button>
        </div>

        {/* The reason lives HERE, under the button that was pressed — never
            only in the banner at the top of the page (UI_STANDARDS 6b).
            THE UNSAVED-ARRANGEMENT REASON COMES FIRST, because it is the one
            that used to be invisible: a `title` on a disabled button, on a
            screen whose cause is now a section away. */}
        {arrangementRefusal !== null && (
          <p
            data-testid="plan-blocked-by-arrangement"
            role="alert"
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-amber-800 dark:text-amber-400"
          >
            {arrangementRefusal}
            <button
              type="button"
              onClick={() => setSection("arrange")}
              className="text-xs font-bold underline underline-offset-2"
            >
              Go to Arrange
            </button>
          </p>
        )}
        {planNumbers.size > 0 && arrangementRefusal === null && planRefusal !== null && (
          <p role="alert" className="mt-2 text-sm font-semibold text-amber-800 dark:text-amber-400">
            {planRefusal}
          </p>
        )}
        {planNumbers.size > 0 && arrangementRefusal === null && planRefusal === null && (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            {
              winnerPlanConfirmation({
                mode: planMode,
                numbers: planPickedNumbers,
                weekNumber: state.weeks.find((w) => w.id === planWeekId)?.weekNumber ?? null,
              }).effect
            }
          </p>
        )}
        {planError !== null && (
          <p role="alert" className="mt-2 text-sm font-semibold text-red-800 dark:text-red-400">
            {planError}
          </p>
        )}
        {/* The commit's own outcome, at the button that committed it. */}
        <SaveFeedback state={feedbackFor("plan")} className="mt-2" />

        {state.plans.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {state.plans.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span>
                  {p.numbers.map((n) => `#${n}`).join(" + ")} — {winnerPlanModeLabel(p.mode)}
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
                      () =>
                        run(
                          `plan:${p.id}`,
                          () => cancelWinnerPlan({ planId: p.id }),
                          `Plan cancelled — ${p.numbers.map((x) => `#${x}`).join(", ")} back on the wheel.`,
                        ),
                    )
                  }
                  className={buttonCls.dangerQuiet + " !px-2.5 !py-1 !text-xs disabled:opacity-40"}
                >
                  Cancel
                </button>
                {/* Cancelling THIS plan reports on THIS row. */}
                <SaveFeedback state={feedbackFor(`plan:${p.id}`)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
      {/* A pure navigation guard: it runs no server action, so there is no
          refusal it could ever be asked to show. Stated explicitly rather
          than omitted, so the rule 6b scan reads as satisfied on purpose. */}
      <ConfirmDialog
        error={null}
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
