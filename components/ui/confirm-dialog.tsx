"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";

// The platform's destructive-action pattern (2.23: confirmation states
// plainly what will happen and what else it affects). Cancel is the safe
// default; the destructive button is unmistakably destructive; HIGH-STAKES
// actions require typing a confirmation phrase before the button enables.
// Focus-trapped, Escape cancels, tokens in both themes.
//
// PORTALLED TO BODY, and this is not optional.
//
// Reported from real use: scrolled down /admin/collections, opened a
// confirmation, and it rendered near the bottom of the DOCUMENT instead of
// centred on screen. Measured at scrollY 1019 in a 569px viewport, the panel's
// top was at −191px — entirely above the fold.
//
// The cause was NOT `position: absolute`. The dialog already used
// `position: fixed`. It was rendered inline inside
// `<div class="animate-fade-in-up-2">`, whose finished CSS animation leaves
//
//     transform: matrix(1, 0, 0, 1, 0, 0)
//
// an IDENTITY transform — visually nothing, but any non-`none` transform makes
// that element the containing block for its fixed-position descendants. So
// `inset-0` resolved against a card partway down the page rather than the
// viewport.
//
// Rendering into document.body removes every ancestor from the equation, which
// is the only fix that cannot be broken again by someone adding an animation
// to an unrelated wrapper.

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
  /**
   * THE CONSEQUENCE THE ORGANIZER MAY HAVE MISSED — stated loudly, above the
   * body, in its own amber panel rather than as one paragraph among four.
   *
   * Use it when the action's most surprising effect is something it does NOT
   * do. Deleting a payout removes the money record but leaves the number
   * drawn; that is correct behaviour and completely invisible until it is
   * said in those words.
   */
  consequence?: React.ReactNode;
  /**
   * THE ACTION HE PROBABLY MEANT, offered in the same place.
   *
   * When two similar actions exist and one of them is almost certainly the
   * intent behind opening this dialog, the other must be reachable HERE. The
   * organizer deleted a payout expecting the number to return to the wheel;
   * "undo the draw" was on a different page, and nothing connected them.
   *
   * The organizer must never have to know which of two similar actions does
   * what — the dialog tells him, and offers both.
   */
  alternative?: {
    /** The button, e.g. "Undo the draw for week 1". */
    label: string;
    /** One line: when this is the right choice instead. */
    description: React.ReactNode;
    /** Runs instead of the destructive action; the dialog closes first. */
    onChoose: () => void;
  };
};

export function ConfirmDialog({
  spec,
  onConfirm,
  onCancel,
  busy = false,
}: {
  spec: ConfirmSpec | null;
  /**
   * Receives what the human ACTUALLY TYPED into the phrase box.
   *
   * Callers that need a server-side typed-name check must forward this rather
   * than the phrase they already hold: `assignPayoutManually` sent
   * `options.confirmPhrase` — its own copy of the expected value — so its
   * `nameConfirmed` gate passed unconditionally and a replayed call could
   * destroy collected payouts with nothing typed at all.
   */
  onConfirm: (typedPhrase: string) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  // createPortal needs a real document; on the server there is none.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  /** Whatever had focus when the dialog opened, so it can be handed back. */
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const open = spec !== null;
  const phraseOk = !spec?.requirePhrase || typed.trim() === spec.requirePhrase;

  // Choosing the ALTERNATIVE swaps the spec without closing the dialog, so
  // anything already typed must not carry over into a different action's
  // confirmation — that would let a phrase typed for one destructive action
  // arm another.
  useEffect(() => {
    setTyped("");
  }, [spec?.title]);

  useEffect(() => {
    if (!open) {
      setTyped("");
      return;
    }
    // Remember the trigger so focus can go back to it on close — otherwise
    // focus falls to the top of the document and a keyboard user has to tab
    // all the way back to where they were.
    returnFocusTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

    // SCROLL LOCK that restores the exact position.
    //
    // `overflow: hidden` alone does not hold the page still on iOS Safari, and
    // pinning the body with `position: fixed` collapses it to the top — the
    // page appears to jump to the beginning behind the dialog and stays there
    // after closing. Capturing scrollY, offsetting the body by it, and putting
    // it back on close keeps the page exactly where it was.
    const scrollY = window.scrollY;
    const { overflow, position, top, width } = document.body.style;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      document.body.style.position = position;
      document.body.style.top = top;
      document.body.style.width = width;
      // `instant` — an animated scroll here reads as the page lurching after
      // the dialog closes.
      window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior });
      returnFocusTo.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!mounted) return null;

  return createPortal(
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
            className="fixed inset-0 z-[100] bg-black/50"
            aria-hidden="true"
          />
          {/* Centred against the VIEWPORT. p-4 gives the panel margins at
              390px so it is never wider than the screen. */}
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none">
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
              // max-h + overflow: a long consequence list scrolls INSIDE the
              // dialog rather than pushing it past the top and bottom of the
              // screen, which is what makes a tall confirmation unreadable on
              // a phone.
              className="pointer-events-auto flex max-h-[85dvh] w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] p-5 shadow-xl shadow-black/20 dark:shadow-black/60"
            >
              <h2 className="text-base font-black text-gray-900 dark:text-white">{spec.title}</h2>

              {/* The surprising consequence goes ABOVE the body and in its own
                  panel. Buried as the third paragraph it reads as background;
                  here it reads as the point. */}
              {spec.consequence && (
                <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-3">
                  <svg
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.3 3.38c-.87 1.5.22 3.37 1.95 3.37h14.7c1.73 0 2.82-1.87 1.95-3.37L13.95 3.38c-.87-1.5-3.03-1.5-3.9 0L2.7 16.13zM12 15.75h.01v.01H12v-.01z"
                    />
                  </svg>
                  <div className="min-w-0 text-sm text-amber-900 dark:text-amber-200 [&_strong]:font-bold">
                    {spec.consequence}
                  </div>
                </div>
              )}

              <div className="mt-2 space-y-2 text-sm text-gray-700 dark:text-gray-300">{spec.body}</div>

              {/* The other action, reachable from here. Sitting between the
                  body and the buttons on purpose: it is read after the
                  consequence and before the decision. */}
              {spec.alternative && (
                <div className="mt-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/25 px-3.5 py-3">
                  <p className="text-sm text-indigo-950 dark:text-indigo-100">
                    {spec.alternative.description}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={spec.alternative.onChoose}
                    className="mt-2.5 inline-flex min-h-11 md:min-h-9 items-center justify-center rounded-xl border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-[#141414] px-4 py-2 text-sm font-bold text-indigo-800 dark:text-indigo-200 transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-50 dark:hover:bg-indigo-950/40 active:scale-[0.97] disabled:opacity-40"
                  >
                    {spec.alternative.label}
                  </button>
                </div>
              )}

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
                  onClick={() => onConfirm(typed)}
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
    </AnimatePresence>,
    document.body,
  );
}
