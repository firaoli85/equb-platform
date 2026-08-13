"use client";

import Link from "next/link";
import { unstable_rethrow, usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AnchoredPopover } from "@/components/ui/anchored-popover";
import { SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { motionTokens } from "@/lib/motion-tokens";
import { signOutAction } from "@/app/actions/auth";
import { useTransition } from "react";
import { NavIcon, SETTINGS_LINKS } from "./admin-sidebar";

// THE ACCOUNT MENU — docs/ADMIN_IA.md §3, specified and never built.
//
// The IA is deliberate that Settings is NOT a seventh rail section: "settings
// are something you go and change, not somewhere you work." The rail is the
// working surface, so settings live in an account menu at its foot, together
// with sign-out.
//
// The menu was the half that never shipped. `SETTINGS_LINKS` and an icon for
// each of the four routes already existed in admin-sidebar.tsx; the only
// consumer was the nav INSIDE the settings area, which you can reach only once
// you are already there. So four working pages — access and security,
// messaging, cycle rules, your own devices — were reachable exclusively by
// typing the URL, and the organizer reported Settings as missing. It was.
//
// SIGN-OUT MOVES IN HERE rather than sitting alongside. Two controls for one
// action is the drift UI_STANDARDS rule 3 exists to prevent, and the IA lists
// sign-out as the last item of this menu.
//
// Overlay behaviour is NOT reimplemented: AnchoredPopover (UI_STANDARDS 10b)
// owns portalling, outside-click, Escape, viewport clamping and the flip. At
// the foot of the rail it always flips above, which is exactly right.
//
// EXEMPT FROM UI_STANDARDS RULE 6 (the SaveButton conversion), deliberately.
// Nothing in this menu is a save: four of the five items are links, and the
// fifth ends the session and leaves the page. There is no record to confirm,
// no dirty state, and a "✓ Saved" beside a control that navigates away would
// only ever flash. Rule 6a/6c do not apply.
//
// RULE 6b STILL DOES, and it was missing. A sign-out that FAILS is a refusal,
// and this menu threw it away: the promise rejected into nothing, `pending`
// went back to false, and the item read "Sign out" again as though the press
// had never happened — while the organizer was still signed in and had every
// reason to believe he was not. `SaveFeedback` now carries that reason beside
// the item that was pressed. The state lives on the MENU, not on the panel,
// so closing and reopening shows it again rather than losing it.

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Only ever "idle" or "err". The transition already owns "is it working" —
  // a second flag for the same fact is what drifts — so this state exists
  // solely to hold a refusal that would otherwise be discarded.
  const [signOut, setSignOut] = useState<SaveState>({ kind: "idle" });
  const menuId = useId();

  const onSettings = pathname.startsWith("/admin/settings");

  // Navigating closes the menu — done on each item's own onClick rather than
  // in an effect keyed on `pathname`. Setting state from an effect on every
  // route change is a cascading render (react-hooks/set-state-in-effect), and
  // there is no navigation out of this menu that does not pass through one of
  // its items: the links close it, and sign-out leaves the page entirely.

  // Focus the first item on open, and hand focus BACK to the trigger on close —
  // otherwise keyboard focus is left on a portalled node that no longer exists
  // and the next Tab starts from the top of the document.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>("[data-menu-item]");
    first?.focus();
  }, [open]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  /** Roving keyboard control across the items, the way a menu is expected to behave. */
  function onPanelKey(e: React.KeyboardEvent) {
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        items[(index + 1 + items.length) % items.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        e.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        // A menu is not a form: tabbing out of it means you are done with it.
        setOpen(false);
        break;
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        // The same three active signals as a rail row (UI_STANDARDS rule 9):
        // surface, weight, icon colour — never colour alone.
        className={
          compact
            ? "inline-flex min-h-11 md:min-h-8 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] " +
              (onSettings || open
                ? "border-indigo-400 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200"
                : "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-white/5")
            : "flex w-full min-h-11 md:min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] " +
              (onSettings || open
                ? "bg-indigo-50 font-bold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5")
        }
      >
        <span
          className={
            onSettings || open
              ? "text-indigo-600 dark:text-indigo-400"
              : "text-gray-500 dark:text-gray-400"
          }
        >
          <GearIcon />
        </span>
        {compact ? "Settings" : "Settings and account"}
        {!compact && (
          <svg
            className={`ml-auto h-4 w-4 shrink-0 text-gray-500 transition-transform duration-150 ease-out dark:text-gray-400 ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        )}
      </button>

      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onRequestClose={() => close(false)}
        offset={8}
      >
        <AnimatePresence>
          {open && (
            <motion.div
              key="account-menu"
              ref={panelRef}
              id={menuId}
              role="menu"
              aria-label="Settings and account"
              onKeyDown={onPanelKey}
              initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : motionTokens.distance.xs }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{
                opacity: 0,
                scale: reduce ? 1 : 0.98,
                transition: {
                  duration: motionTokens.duration.fast * 0.65,
                  ease: motionTokens.easing.smooth,
                },
              }}
              transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
              className="w-72 rounded-xl border border-gray-200 bg-white p-1 shadow-lg shadow-black/10 dark:border-gray-700 dark:bg-[#1f1f1f] dark:shadow-black/50"
            >
              {SETTINGS_LINKS.map((link) => {
                const active = pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    role="menuitem"
                    data-menu-item
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                      active
                        ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200"
                        : "text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5"
                    }`}
                    style={{ minHeight: "44px" }}
                  >
                    <span
                      className={`mt-0.5 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-500 dark:text-gray-400"}`}
                    >
                      <NavIcon href={link.href} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{link.label}</span>
                      {/* The hint is why these four are worth separating at all
                          (ADMIN_IA §1.3: settings was four jobs in one scroll). */}
                      {link.hint && (
                        <span className="block text-xs text-gray-600 dark:text-gray-400">
                          {link.hint}
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })}

              <div
                role="separator"
                className="my-1 border-t border-gray-100 dark:border-gray-800/60"
              />

              {/* Sign-out lives here and nowhere else now (ADMIN_IA §3). It
                  keeps the exact behaviour and wording it had in the footer —
                  only its home changed. */}
              <button
                type="button"
                role="menuitem"
                data-menu-item
                disabled={pending}
                onClick={() => {
                  setSignOut({ kind: "idle" });
                  startTransition(() =>
                    // A SUCCESSFUL SIGN-OUT REACHES THIS CATCH TOO. The action
                    // ends in redirect(), and Next delivers that redirect to
                    // the caller by REJECTING the action promise — see
                    // server-action-reducer: "the action promise will be
                    // rejected with a redirect so that it's handled by
                    // RedirectBoundary". A bare catch here would therefore
                    // report every successful sign-out as a failure.
                    //
                    // `unstable_rethrow` throws the framework's own
                    // control-flow errors straight back, so the transition
                    // rejects exactly as it did before this file had a catch
                    // at all and the navigation is untouched. Only a REAL
                    // failure survives to the line below.
                    signOutAction().catch((e: unknown) => {
                      unstable_rethrow(e);
                      setSignOut({ kind: "err", message: signOutFailure(e) });
                    }),
                  );
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-600 transition-colors duration-100 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/40"
                style={{ minHeight: "44px" }}
              >
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                {pending ? "Signing out…" : "Sign out"}
              </button>

              {/* The refusal, immediately under the item that was pressed
                  (UI_STANDARDS 6b) — and it never auto-clears. `role="none"`
                  keeps a non-menuitem child out of the menu's item list; the
                  message itself is still a live region, so it is announced. */}
              {signOut.kind === "err" && (
                <div role="none" className="px-1 pb-1">
                  <SaveFeedback state={signOut} />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </AnchoredPopover>
    </>
  );
}

/**
 * What to say when the sign-out itself failed.
 *
 * It leads with the state, not the cause, because the state is the part that
 * changes what he does next: he is STILL SIGNED IN on a machine he probably
 * intended to walk away from. The server's own words follow — a thrown server
 * action reaches the browser as an Error, carrying the real message in
 * development and the framework's digest message in production. That is the
 * reason we have, and it is more than the nothing this replaced.
 */
function signOutFailure(e: unknown): string {
  const raw = e instanceof Error && e.message.trim() !== "" ? e.message.trim() : "";
  const reason = raw === "" ? "the server did not answer." : /[.!?]$/.test(raw) ? raw : `${raw}.`;
  return `Not signed out: ${reason} You are still signed in on this device — try again.`;
}

/** A gear. The one icon the rail did not already have. */
function GearIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
