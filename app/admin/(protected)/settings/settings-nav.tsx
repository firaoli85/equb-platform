"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, SETTINGS_LINKS } from "@/components/admin/admin-sidebar";

// The settings rail — Shopify's shape: icon and label per row, detail on the
// right. Four pages, not four tabs: tabs suggest they are variations of one
// thing, and these are four unrelated decisions (who can sign in, how we talk
// to members, when a cycle may close, and the organizer's own account).
//
// Each row carries a HINT. The four names alone leave "Cycle rules" ambiguous,
// and a settings page nobody can find is the problem this rework exists to fix.

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="lg:w-64 lg:shrink-0">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
        {SETTINGS_LINKS.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <li key={link.href} className="shrink-0 lg:shrink">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-start gap-3 rounded-xl px-3 py-2.5 transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] ${
                  active
                    ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
                }`}
              >
                <span
                  className={`mt-0.5 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-500 dark:text-gray-400"}`}
                >
                  <NavIcon href={link.href} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm ${active ? "font-bold" : "font-medium"}`}>
                    {link.label}
                  </span>
                  {link.hint && (
                    <span className="mt-0.5 hidden text-xs text-gray-600 dark:text-gray-400 lg:block">
                      {link.hint}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
