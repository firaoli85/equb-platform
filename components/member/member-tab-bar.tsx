"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { isNavActive, MEMBER_TABS, MemberNavIcon } from "./member-nav";
import { springs } from "@/lib/motion-tokens";

// THE MEMBER'S BOTTOM NAVIGATION.
//
// Designed toward Truecaller (a capsule behind the active item, with EVERY
// label legible rather than only the active one), komoot (the icon changes
// fill weight), and Ladder (the dark treatment gives the active item a light
// surface instead of a tint). See docs/UI_STANDARDS.md rule 9.
//
// THE ACTIVE ITEM IS THE INVERSION OF THE BAR — near-black on a white bar,
// white on a near-black one. That is the whole colour idea, and it is why the
// palette here is navy (#0F172A, "Banking / Traditional Finance") rather than
// a hue: an inverted surface is 17.9:1 in light and comparable in dark, where
// the previous indigo-100/indigo-700 tint-on-tint could not get close.
//
// Indigo is untouched elsewhere. It means MONEY in this product — the savings
// figure, the primary actions — and chrome competing with it was part of why
// the old bar read as noise.
//
// The sliding capsule (layoutId) is kept: it is the one piece of the old bar
// that was right, and it makes the current position legible even mid-tap.

export function MemberTabBar() {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  return (
    <nav
      className={
        "md:hidden fixed bottom-0 inset-x-0 z-40 " +
        "border-t border-gray-200 dark:border-gray-800 " +
        "bg-white/92 dark:bg-[#0a0a0b]/92 backdrop-blur-md"
      }
      // UI_STANDARDS rule 2: without this, labels sit under the iOS home
      // indicator on every modern iPhone.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary navigation"
    >
      <ul className="mx-auto flex max-w-md items-stretch gap-1 px-2 py-1.5">
        {MEMBER_TABS.map((tab) => {
          const active = isNavActive(tab.href, pathname);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 select-none active:scale-[0.96]"
                style={{
                  touchAction: "manipulation",
                  // 56px: comfortably over the 44px floor, and the labels get
                  // room to sit on their own line rather than being cropped.
                  minHeight: "56px",
                  transition: "transform 120ms ease-out",
                }}
              >
                {active && (
                  <motion.span
                    layoutId="member-tab-capsule"
                    className="absolute inset-0 rounded-2xl bg-[#0F172A] dark:bg-white"
                    transition={reduce ? { duration: 0 } : springs.snappy}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={
                    "relative " +
                    (active
                      ? "text-white dark:text-[#0F172A]"
                      : "text-slate-600 dark:text-slate-300")
                  }
                >
                  <MemberNavIcon href={tab.href} solid={active} />
                </span>
                <span
                  className={
                    "relative text-[11px] leading-none tracking-tight " +
                    (active
                      ? "font-bold text-white dark:text-[#0F172A]"
                      : "font-semibold text-slate-700 dark:text-slate-200")
                  }
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
