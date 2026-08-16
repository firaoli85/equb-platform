"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { AdminSidebar, navIsActive, NavIcon, navLink } from "./admin-sidebar";

// THE ADMIN'S MOBILE NAVIGATION — the half that never shipped.
//
// The rail is `hidden md:flex`, and below 768px there was nothing in its
// place: all nineteen destinations were `display: none`, and the mobile header
// carried a title, a screen-share switch and an account menu. The organizer
// signed in on his phone, landed on the dashboard, and could not leave it. He
// works outside and records payments from that phone, so the one thing the
// product exists to do could not be done where he does it.
//
// THE PATTERN IS THE MEMBER PORTAL'S, DELIBERATELY. `member-tab-bar.tsx` is
// proven on these same phones: a fixed bottom bar under `md:hidden`, a capsule
// behind the active item, every label legible rather than only the active one,
// and `env(safe-area-inset-bottom)` so nothing sits under the home indicator.
// Copying a working pattern beats inventing a second one — and the two bars now
// answer the same question the same way in both halves of the product.
//
// ONE SOURCE FOR THE NAV. The four tabs below are LOOKED UP from `NAV_GROUPS`
// by href rather than retyped, and the drawer renders `AdminSidebar` itself.
// There is no second copy of the nav list anywhere: add a destination to
// NAV_GROUPS and it appears in the drawer with no other edit.

/**
 * The four the organizer needs in the FIELD, in the order he needs them.
 *
 * Payments is first and leftmost because recording money on a phone outside is
 * the entire reason this component exists — it is one thumb-tap from anywhere.
 * Everything else lives behind More, which is the whole rail.
 *
 * HREFS ONLY. The label, the icon and whether the route matches exactly all
 * come back from `navLink`, so this file cannot disagree with the rail about
 * what a destination is called.
 */
export const FIELD_TAB_HREFS = [
  "/admin/payments",
  "/admin/this-week",
  "/admin/collections",
  "/admin",
] as const;

const FIELD_TABS = FIELD_TAB_HREFS.map(navLink);

export function AdminTabBar({ queuedCount = 0 }: { queuedCount?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerId = useId();

  // The drawer is a route-level overlay, so a navigation must close it —
  // otherwise tapping a destination leaves the sheet sitting over the page it
  // just opened.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes, and the page behind does not scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // "More" counts as current whenever the page is not one of the four, so the
  // bar never shows nothing selected.
  const onATab = FIELD_TABS.some((t) => navIsActive(pathname, t));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* The scrim shows the page through it on purpose — this is a
              temporary detour, not a new place. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            id={drawerId}
            role="dialog"
            aria-modal="true"
            aria-label="All admin sections"
            // Bottom sheet, not a side drawer: this bar is at the bottom and
            // the thumb is already there. `max-h` + the sidebar's own
            // overflow-y keeps every group reachable on a short screen.
            className="absolute inset-x-0 bottom-0 flex max-h-[82dvh] flex-col rounded-t-3xl border-t border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-[#0a0a0b] motion-safe:animate-fade-in-up"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-800/60">
              <span className="text-sm font-black text-gray-900 dark:text-white">
                All sections
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Close
              </button>
            </div>
            {/* THE SAME COMPONENT THE DESKTOP RAIL RENDERS. Not a copy of the
                list — the component itself, so the two can never drift. */}
            <AdminSidebar queuedCount={queuedCount} />
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/92 backdrop-blur-md md:hidden dark:border-gray-800 dark:bg-[#0a0a0b]/92"
        // Without this, labels sit under the iOS home indicator on every
        // modern iPhone (UI_STANDARDS rule 2).
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Admin sections"
      >
        <ul className="mx-auto flex max-w-md items-stretch gap-1 px-2 py-1.5">
          {FIELD_TABS.map((tab) => {
            // The rail's own rule, including `exact` — without it Dashboard
            // ("/admin") would light up on every admin page and two tabs would
            // look current at once.
            const active = navIsActive(pathname, tab);
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  // Three signals, never colour alone (UI_STANDARDS rule 9):
                  // the inverted surface, the weight, and the icon riding the
                  // inverted colour with it.
                  className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 transition-transform duration-100 ease-out select-none active:scale-[0.96] ${
                    active
                      ? "bg-[#0F172A] font-bold text-white dark:bg-white dark:text-[#0F172A]"
                      : "font-semibold text-slate-700 dark:text-slate-200"
                  }`}
                  style={{ touchAction: "manipulation", minHeight: "56px" }}
                >
                  <NavIcon href={tab.href} />
                  <span className="text-[11px] leading-none tracking-tight">{tab.label}</span>
                </Link>
              </li>
            );
          })}

          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls={drawerId}
              aria-haspopup="dialog"
              className={`relative flex w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 transition-transform duration-100 ease-out select-none active:scale-[0.96] ${
                !onATab
                  ? "bg-[#0F172A] font-bold text-white dark:bg-white dark:text-[#0F172A]"
                  : "font-semibold text-slate-700 dark:text-slate-200"
              }`}
              style={{ touchAction: "manipulation", minHeight: "56px" }}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              <span className="text-[11px] leading-none tracking-tight">
                More
                {queuedCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white tabular-nums">
                    {queuedCount}
                  </span>
                )}
              </span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
