"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { buttonCls } from "./primitives";

// SAVE FEEDBACK THAT CANNOT LAND OFF-SCREEN (§2.10, UI_STANDARDS rule 6).
//
// THE REPORTED DEFECT. The organizer changed a participation from 10 weeks to
// 12, pressed Save, and saw nothing. The save worked. The confirmation was
// rendered — 100 lines of JSX above the button, at the top of a form holding
// the amount field, the start week, the weeks field, two checkboxes, a cap
// message and a fee calculator. He was looking at the button; the message was
// above the fold.
//
// This is the same failure rule 6b fixed for refusals, in the other direction,
// and the fix has to be the same: THE FEEDBACK BELONGS TO THE CONTROL. Not to
// the page, not to the form — to the button that was pressed.
//
// So it is not a message a caller has to remember to place. It is part of the
// button. `SaveButton` owns all four beats of rule 6:
//
//   1. disabled until valid AND until dirty  — `dirty`, `disabled`
//   2. the control shows it is working       — its own label changes
//   3. success is unmistakable, AT the control — the confirmation renders here
//   4. failure shows the reason, AT the control — likewise
//
// A caller that uses this cannot put the feedback in the wrong place, because
// there is nowhere else to put it.

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

/**
 * How long a success confirmation stays before fading.
 *
 * Deliberately long. This is a financial record and the organizer may look
 * away mid-save; a toast that has gone by the time he looks back is the same
 * as no toast. Failures never auto-clear at all — see below.
 */
const OK_VISIBLE_MS = 6000;

export function SaveButton({
  state,
  onSave,
  onStateSettled,
  label = "Save",
  savingLabel = "Saving…",
  /** False disables the button and says why on hover. */
  dirty = true,
  disabled = false,
  /** Shown as the title when not dirty — why pressing would do nothing. */
  notDirtyHint = "Nothing has changed yet.",
  className = "",
  tone = "primary",
}: {
  state: SaveState;
  onSave: () => void;
  /** Called when a success message expires, so the caller can reset to idle. */
  onStateSettled?: () => void;
  label?: string;
  savingLabel?: string;
  dirty?: boolean;
  disabled?: boolean;
  notDirtyHint?: string;
  className?: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  const reduce = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // THE MESSAGE IS DERIVED FROM THE PROP, NOT MIRRORED INTO STATE.
  //
  // It was mirrored, through a `useEffect` — and the rendered-HTML test caught
  // what that costs: effects do not run during render, so the confirmation was
  // ABSENT from the markup on first paint and only appeared after hydration.
  // A component whose whole job is "the feedback is visible" must not depend
  // on an effect having run to be visible. (It is also the cascading-render
  // smell `react-hooks/set-state-in-effect` exists to catch.)
  //
  // Only the DISMISSAL is state: which message has already had its time.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const live = state.kind === "ok" || state.kind === "err" ? state : null;
  const shown = live !== null && live.message !== dismissed ? live : null;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    // A FAILURE NEVER AUTO-CLEARS. It is the reason something did not happen,
    // and it stays until the organizer acts on it (rule 6b). Only success
    // fades, because the screen behind it already shows the new truth.
    if (shown?.kind !== "ok") return;
    const message = shown.message;
    timer.current = setTimeout(() => {
      setDismissed(message);
      onStateSettled?.();
    }, OK_VISIBLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [shown, onStateSettled]);

  const saving = state.kind === "saving";
  const cls =
    tone === "danger" ? buttonCls.danger : tone === "secondary" ? buttonCls.secondary : buttonCls.primary;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || saving || !dirty}
        title={!dirty && !disabled && !saving ? notDirtyHint : undefined}
        aria-busy={saving}
        className={cls}
      >
        {saving ? savingLabel : label}
      </button>

      {/* THE CONFIRMATION, BESIDE THE BUTTON. `aria-live` so a screen reader
          announces it without moving focus — the organizer has not navigated
          anywhere and should not be sent anywhere. */}
      <span aria-live="polite" aria-atomic="true" className="min-w-0">
        <AnimatePresence mode="wait">
          {shown && (
            <motion.span
              key={shown.message}
              initial={{ opacity: 0, x: reduce ? 0 : -motionTokens.distance.xs }}
              animate={{ opacity: 1, x: 0 }}
              exit={{
                opacity: 0,
                transition: {
                  duration: motionTokens.duration.fast * 0.65,
                  ease: motionTokens.easing.smooth,
                },
              }}
              transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
              role={shown.kind === "err" ? "alert" : "status"}
              data-testid={shown.kind === "err" ? "save-error" : "save-ok"}
              className={
                "inline-block rounded-xl px-3 py-1.5 text-sm font-semibold " +
                (shown.kind === "ok"
                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")
              }
            >
              {shown.kind === "ok" ? `✓ ${shown.message}` : shown.message}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}

/**
 * The same confirmation without the button — for controls that are not a
 * "Save" (a row's Delete, a toggle, a dialog's own action), where the feedback
 * still has to render next to the thing that was pressed.
 *
 * THE SAME LIFETIME AS THE BUTTON'S OWN CONFIRMATION, and this is the fix for
 * a reported defect: a payment confirmation rendered through this stayed on
 * screen until navigation, so "covers week 3 in full" sat beside a NEW week
 * selection describing an OLD save. A confirmation is a statement about a
 * moment; six seconds after the moment it is history wearing the tense of
 * news. Success fades on the shared clock; a FAILURE still never auto-clears
 * (rule 6b) — it is the reason something did not happen, and it stays until
 * the organizer acts on it.
 *
 * THE EXIT COLLAPSES ITS OWN HEIGHT, so the rows below do not jump when it
 * leaves — the one thing a fading message must not do is yank the control the
 * organizer is reaching for.
 */
export function SaveFeedback({
  state,
  onStateSettled,
  className = "",
}: {
  state: SaveState;
  /** Called after a success has faded OUT, so the caller can reset to idle. */
  onStateSettled?: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Derived from the prop, never mirrored — the confirmation must be in the
  // first-paint markup (see SaveButton's note). Only the dismissal is state.
  const [dismissed, setDismissed] = useState<string | null>(null);
  // The settle callback fires after the fade completes, not when it starts —
  // otherwise the caller resets to idle, the wrapper unmounts, and the exit
  // animation is cut to a blink.
  const settlePending = useRef(false);

  const live = state.kind === "ok" || state.kind === "err" ? state : null;
  const shown =
    live !== null && !(live.kind === "ok" && live.message === dismissed) ? live : null;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (shown?.kind !== "ok") return;
    const message = shown.message;
    timer.current = setTimeout(() => {
      settlePending.current = true;
      setDismissed(message);
    }, OK_VISIBLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [shown]);

  const ok = shown?.kind === "ok";
  return (
    <AnimatePresence
      onExitComplete={() => {
        if (settlePending.current) {
          settlePending.current = false;
          onStateSettled?.();
        }
      }}
    >
      {shown && (
        <motion.p
          key={`${shown.kind}:${shown.message}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{
            opacity: 0,
            height: reduce ? "auto" : 0,
            paddingTop: reduce ? undefined : 0,
            paddingBottom: reduce ? undefined : 0,
            marginTop: reduce ? undefined : 0,
            transition: {
              duration: motionTokens.duration.fast,
              ease: motionTokens.easing.smooth,
            },
          }}
          transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
          style={{ overflow: "hidden" }}
          role={ok ? "status" : "alert"}
          aria-live="polite"
          data-testid={ok ? "save-ok" : "save-error"}
          className={
            `rounded-xl px-3 py-1.5 text-sm font-semibold ${className} ` +
            (ok
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")
          }
        >
          {ok ? `✓ ${shown.message}` : shown.message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
