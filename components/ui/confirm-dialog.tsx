"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";

// The platform's destructive-action pattern (2.23: confirmation states
// plainly what will happen and what else it affects). Cancel is the safe
// default; the destructive button is unmistakably destructive; HIGH-STAKES
// actions require typing a confirmation phrase before the button enables.
// Focus-trapped, Escape cancels, tokens in both themes.

export type ConfirmSpec = {
  title: string;
  /** WHAT happens — plain sentences with REAL numbers, never generic. */
  body: React.ReactNode;
  /** The red button's label, e.g. "Delete payout". */
  confirmLabel: string;
  /** Optional non-destructive styling (rare — most confirms are destructive). */
  destructive?: boolean;
  /** HIGH-STAKES: the organizer must type this exact phrase to enable. */
  requirePhrase?: string;
};

export function ConfirmDialog({
  spec,
  onConfirm,
  onCancel,
  busy = false,
}: {
  spec: ConfirmSpec | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");

  const open = spec !== null;
  const phraseOk = !spec?.requirePhrase || typed.trim() === spec.requirePhrase;

  useEffect(() => {
    if (!open) {
      setTyped("");
      return;
    }
    // Cancel is the safe default focus.
    cancelRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        // Minimal focus trap: cycle within the panel.
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && spec && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast * 0.65 } }}
            transition={{ duration: motionTokens.duration.fast }}
            onClick={onCancel}
            className="fixed inset-0 z-50 bg-black/50"
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="panel"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={spec.title}
              initial={{ opacity: 0, scale: reduce ? 1 : 0.96, y: reduce ? 0 : motionTokens.distance.sm }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{
                opacity: 0,
                scale: reduce ? 1 : 0.97,
                // Exits are quicker than enters (~65%) — closing should snap.
                transition: { duration: motionTokens.duration.fast * 0.65, ease: motionTokens.easing.smooth },
              }}
              transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
              className="pointer-events-auto w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] p-5 shadow-xl shadow-black/20 dark:shadow-black/60"
            >
              <h2 className="text-base font-black text-gray-900 dark:text-white">{spec.title}</h2>
              <div className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-300">{spec.body}</div>

              {spec.requirePhrase && (
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400">
                    Type <strong className="select-all text-gray-900 dark:text-white">{spec.requirePhrase}</strong> to
                    confirm
                    <input
                      type="text"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-1.5 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 dark:focus:border-red-700"
                    />
                  </label>
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="inline-flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-4 py-2 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={busy || !phraseOk}
                  className={
                    spec.destructive === false
                      ? "inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97] disabled:opacity-40"
                      : "inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-red-700 active:scale-[0.97] disabled:opacity-40"
                  }
                >
                  {busy ? "Working…" : spec.confirmLabel}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
