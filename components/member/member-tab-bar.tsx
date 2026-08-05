"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "@/lib/motion-tokens";

// KNOWN DEFECT FIXED ON PORT: the old bar set inactive tabs in gray-400 at
// 10px — members couldn't see the other tabs and called the organizer.
// This version uses gray-600 (7.6:1 on white) / gray-300 (11:1 on #0a0a0b)
// at 11px, and the active tab gets a filled indigo pill + label so the
// current place is unmistakable in both themes.

const TABS = [
  { label: "Home", href: "/me" },
  { label: "Group", href: "/me/group" },
  { label: "Collections", href: "/me/collections" },
] as const;

function TabIcon({ href, active }: { href: string; active: boolean }) {
  const cls = `w-5 h-5 ${active ? "text-indigo-600 dark:text-indigo-300" : "text-gray-600 dark:text-gray-300"}`;
  switch (href) {
    case "/me":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
        </svg>
      );
    case "/me/group":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      );
    default:
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      );
  }
}

export function MemberTabBar() {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  function isActive(href: string) {
    return href === "/me" ? pathname === "/me" : pathname.startsWith(href);
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#0a0a0b]/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary navigation"
    >
      <div className="grid grid-cols-3 h-16">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center justify-center gap-1 select-none active:scale-95"
              style={{ touchAction: "manipulation", minHeight: "44px", transition: "transform 100ms ease-out" }}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
            >
              <span className="relative flex items-center justify-center w-12 h-7 rounded-full">
                {active && (
                  <motion.span
                    layoutId="tab-active-bg"
                    className="absolute inset-0 rounded-full bg-indigo-100 dark:bg-indigo-900/70"
                    transition={reduce ? { duration: 0 } : springs.snappy}
                    aria-hidden="true"
                  />
                )}
                <span className="relative">
                  <TabIcon href={tab.href} active={active} />
                </span>
              </span>
              <span
                className={`text-[11px] leading-none transition-colors ${
                  active
                    ? "font-bold text-indigo-700 dark:text-indigo-300"
                    : "font-semibold text-gray-600 dark:text-gray-300"
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
