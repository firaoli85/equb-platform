"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { isNavActive, MEMBER_SECONDARY, MEMBER_TABS, MemberNavIcon, type MemberNavItem } from "./member-nav";

// THE DESKTOP SIDEBAR — the same destinations, the same active treatment, the
// same three signals as the tab bar (surface + icon fill + weight).
//
// UI_STANDARDS rule 3: it reads from the shared list in member-nav.tsx rather
// than keeping its own. It previously listed three of the six member
// destinations, and inactive icons were gray-400 on white — 2.8:1, well under
// the 4.5:1 floor.
//
// Desktop has room for the secondary destinations that live as tiles on the
// phone home screen, so they appear here under their own heading rather than
// being unreachable.

function NavRow({ item, active }: { item: MemberNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-[background-color,color] duration-150 " +
        (active
          ? "bg-[#0F172A] dark:bg-white"
          : "hover:bg-slate-100 dark:hover:bg-white/[0.06]")
      }
      style={{ minHeight: "44px" }}
    >
      {/* slate-600/300, matching the tab bar exactly. slate-500 measured
          4.76:1 here against the tab bar's 7.52:1 — passing, but the same
          icon should not have two appearances (UI_STANDARDS rule 3). */}
      <span className={active ? "text-white dark:text-[#0F172A]" : "text-slate-600 dark:text-slate-300"}>
        <MemberNavIcon href={item.href} solid={active} />
      </span>
      <span className="min-w-0">
        <span
          className={
            "block text-sm leading-tight " +
            (active
              ? "font-bold text-white dark:text-[#0F172A]"
              : "font-semibold text-slate-700 dark:text-slate-200")
          }
        >
          {item.label}
        </span>
        {item.sidebarHint && (
          <span
            className={
              "block text-[11px] leading-tight " +
              (active ? "text-white/75 dark:text-[#0F172A]/70" : "text-slate-600 dark:text-slate-400")
            }
          >
            {item.sidebarHint}
          </span>
        )}
      </span>
    </Link>
  );
}

export function MemberSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex fixed top-14 left-0 bottom-0 w-60 z-30 flex-col border-r border-slate-200 dark:border-gray-800/60 bg-white dark:bg-[#0a0a0b] px-3 py-4">
      <nav className="flex-1 space-y-4 overflow-y-auto" aria-label="Primary navigation">
        <div className="space-y-1">
          {MEMBER_TABS.map((item) => (
            <NavRow key={item.href} item={item} active={isNavActive(item.href, pathname)} />
          ))}
        </div>

        <div>
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
            More
          </p>
          <div className="space-y-1">
            {MEMBER_SECONDARY.map((item) => (
              <NavRow key={item.href} item={item} active={isNavActive(item.href, pathname)} />
            ))}
          </div>
        </div>
      </nav>

      <button
        type="button"
        onClick={() => void signOutAction()}
        className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-700 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40"
        style={{ minHeight: "44px" }}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        Sign out
      </button>
    </aside>
  );
}
