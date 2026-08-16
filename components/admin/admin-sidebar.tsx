"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// THE ADMIN NAVIGATION — grouped by the organizer's JOB, not by entity.
//
// See docs/ADMIN_IA.md for the reasoning. The short version: the old groups
// were nouns (Money / People / System), so "Cycle" sat under People and "New
// cycle" sat under System next to a toggle, and nothing about a cycle's LIFE —
// set it up, run it, close it, archive it — was in one place. Eight screens had
// no navigation at all: `this-week`, `held`, `paid-out` and `received` were
// reachable only by clicking a dashboard stat card, and `cycle/close` — which
// writes a ledger debt onto every short member and freezes the books — was
// linked from another cycle's archive page.
//
// Settings deliberately does NOT appear here. It is in the account menu at the
// foot of the rail, because settings are somewhere you GO, not somewhere you
// work (2.1: this rail is the working surface).

export type NavLink = {
  label: string;
  href: string;
  exact?: boolean;
  /** Shown under the label when the row needs to say what it is for. */
  hint?: string;
};
type NavGroup = { eyebrow: string; links: NavLink[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    eyebrow: "Today",
    links: [
      { label: "Dashboard", href: "/admin", exact: true },
      { label: "This week", href: "/admin/this-week" },
    ],
  },
  {
    eyebrow: "Money",
    links: [
      { label: "Payments", href: "/admin/payments" },
      { label: "Collections", href: "/admin/collections" },
      { label: "Who is waiting", href: "/admin/waiting" },
      { label: "Cash position", href: "/admin/cash" },
      { label: "Carried balances", href: "/admin/balances" },
    ],
  },
  {
    eyebrow: "The draw",
    links: [
      { label: "Wheel setup", href: "/admin/wheel/setup" },
      { label: "Draw screen", href: "/admin/wheel", exact: true },
    ],
  },
  {
    eyebrow: "People",
    links: [
      { label: "Members", href: "/admin/people" },
      // In the rail for the same reason "Close the cycle" is: adding a member
      // creates a person, a participation and their lucky numbers, and can
      // surface a balance carried in from an earlier cycle. An action with
      // that much behind it is not a form at the bottom of a list.
      { label: "Add a member", href: "/admin/cycle/add" },
      { label: "Messages", href: "/admin/messages" },
    ],
  },
  {
    // The cycle's LIFE, in order. Closing is last because that is where it
    // falls, and it is in the rail at all because an action that writes 25
    // ledger debts is not a link on an archive page.
    eyebrow: "The cycle",
    links: [
      { label: "This cycle", href: "/admin/cycle", exact: true },
      { label: "Where this cycle stands", href: "/admin/cycle/position" },
      { label: "Draws", href: "/admin/cycle/draws" },
      { label: "Close the cycle", href: "/admin/cycle/close" },
      { label: "Start a new cycle", href: "/admin/cycles/new" },
    ],
  },
  {
    eyebrow: "Record",
    links: [
      { label: "Audit log", href: "/admin/audit" },
      { label: "Archives", href: "/admin/cycles", exact: true },
    ],
  },
];

/** Every destination in the rail, flat. */
export const ALL_NAV_LINKS: NavLink[] = NAV_GROUPS.flatMap((g) => g.links);

/**
 * The rail's own entry for a route — label, icon key and `exact` included.
 *
 * THE PHONE'S BOTTOM BAR LOOKS ITS TABS UP THROUGH HERE rather than restating
 * them, so a label edited above changes in both places and neither can drift.
 * A route that is not in the rail throws: the bar may only point at
 * destinations the rail already carries, and a typo should be loud in
 * development rather than a tab that quietly goes nowhere.
 */
export function navLink(href: string): NavLink {
  const found = ALL_NAV_LINKS.find((l) => l.href === href);
  if (!found) throw new Error(`${href} is not a destination in NAV_GROUPS`);
  return found;
}

export const SETTINGS_LINKS: NavLink[] = [
  {
    label: "Access and security",
    href: "/admin/settings/access",
    hint: "Who can sign in, and for how long",
  },
  {
    label: "Messaging",
    href: "/admin/settings/messaging",
    hint: "Which channels work, and what they say",
  },
  {
    label: "Cycle rules",
    href: "/admin/settings/cycle",
    hint: "How long to wait before closing",
  },
  {
    label: "Member agreement",
    href: "/admin/settings/agreement",
    hint: "The wording members sign, versioned",
  },
  {
    label: "Your account",
    href: "/admin/settings/account",
    hint: "Your own devices and sessions",
  },
];

export function NavIcon({ href }: { href: string }) {
  const common = {
    className: "h-4 w-4 shrink-0",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (href) {
    case "/admin":
      return (
        <svg {...common}>
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <path d="M9 22V12h6v10" />
        </svg>
      );
    case "/admin/this-week":
      // A calendar with today marked — the week we are actually in.
      return (
        <svg {...common}>
          <path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
          <path d="M8 3v4M16 3v4M4 11h16" />
          <path d="M9 15h2v2H9z" />
        </svg>
      );
    case "/admin/payments":
      return (
        <svg {...common}>
          <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      );
    case "/admin/collections":
      return (
        <svg {...common}>
          <path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      );
    case "/admin/cash":
      // Money in and money out — two arrows crossing a line.
      return (
        <svg {...common}>
          <path d="M3 20h18" />
          <path d="M7 16V9m0 0L4 12m3-3l3 3" />
          <path d="M17 4v7m0 0l3-3m-3 3l-3-3" />
        </svg>
      );
    case "/admin/balances":
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 012-2h11a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
          <path d="M8 7h7M8 11h7M8 15h4" />
        </svg>
      );
    case "/admin/waiting":
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "/admin/wheel/setup":
      return (
        <svg {...common}>
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "/admin/wheel":
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
          <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
        </svg>
      );
    case "/admin/people":
      return (
        <svg {...common}>
          <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    // A person with a plus — the same figure as the directory above it, so the
    // pair reads as "the people" and "add one" rather than two unrelated ideas.
    case "/admin/cycle/add":
      return (
        <svg {...common}>
          <path d="M13 20H2v-2a5 5 0 019.288-2.572M13 20h-2M9 7a3 3 0 11-6 0 3 3 0 016 0z" />
          <path d="M18 13v6M15 16h6" />
        </svg>
      );
    case "/admin/cycle":
      return (
        <svg {...common}>
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    case "/admin/cycle/position":
      return (
        <svg {...common}>
          <path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
          <path d="M8 3v4M16 3v4M4 11h16M9 15h6" />
        </svg>
      );
    case "/admin/cycle/draws":
      // A ticket drawn from the pool.
      return (
        <svg {...common}>
          <path d="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4z" />
          <path d="M12 6v12" strokeDasharray="2 3" />
        </svg>
      );
    case "/admin/cycle/close":
      // A closed book. Deliberately not a padlock: closing is an ending, not a
      // security state, and the padlock reads as "you are locked out".
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 012-2h11a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
          <path d="M8 3v18" />
          <path d="M12 10l2 2 4-4" />
        </svg>
      );
    case "/admin/cycles/new":
      return (
        <svg {...common}>
          <path d="M12 4v16m8-8H4" />
        </svg>
      );
    case "/admin/cycles":
      // An archive box.
      return (
        <svg {...common}>
          <path d="M3 7h18v3H3z" />
          <path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9" />
          <path d="M10 14h4" />
        </svg>
      );
    case "/admin/messages":
      return (
        <svg {...common}>
          <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      );
    case "/admin/audit":
      return (
        <svg {...common}>
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "/admin/settings/access":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6z" />
          <path d="M9.5 12l1.8 1.8 3.2-3.6" />
        </svg>
      );
    case "/admin/settings/messaging":
      return (
        <svg {...common}>
          <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4z" />
        </svg>
      );
    case "/admin/settings/cycle":
      return (
        <svg {...common}>
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    case "/admin/settings/account":
      return (
        <svg {...common}>
          <path d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
          <path d="M5 21a7 7 0 0114 0" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
  }
}

/** Is this route the one on screen? */
export function navIsActive(pathname: string, link: NavLink): boolean {
  return link.exact ? pathname === link.href : pathname.startsWith(link.href);
}

export function AdminSidebar({
  /**
   * Messages waiting to be sent, for the badge on the Messages row.
   *
   * PASSED IN, because this is a client component and the count is a database
   * read. The layout is a server component and already renders on every admin
   * page, so the rail carries the number everywhere without this file learning
   * about Prisma.
   */
  queuedCount = 0,
}: {
  queuedCount?: number;
} = {}) {
  const pathname = usePathname();

  return (
    // min-h-0 is load-bearing: a flex child will not shrink below its content
    // without it, so overflow-y-auto never engages and the last nav groups are
    // simply unreachable on a short laptop screen.
    <nav
      className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4"
      aria-label="Admin navigation"
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.eyebrow}>
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400">
            {group.eyebrow}
          </p>
          <div className="space-y-0.5">
            {group.links.map((link) => {
              const active = navIsActive(pathname, link);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  // Three signals for the active row, never colour alone
                  // (UI_STANDARDS rule 9): surface, font weight, icon colour.
                  //
                  // py-3 BELOW md, py-2 above: this same list is now the phone
                  // drawer, where a 36px row is a miss waiting to happen. 12px
                  // of padding either side of a 20px line clears the 44px touch
                  // floor; the mouse-driven rail keeps its tighter rhythm.
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-3 text-sm transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] md:py-2 ${
                    active
                      ? "bg-indigo-50 dark:bg-indigo-950/50 font-bold text-indigo-700 dark:text-indigo-300"
                      : "font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
                  }`}
                >
                  <span
                    className={
                      active
                        ? "text-indigo-600 dark:text-indigo-400"
                        : "text-gray-500 dark:text-gray-400"
                    }
                  >
                    <NavIcon href={link.href} />
                  </span>
                  {link.label}
                  {/* WAITING TO BE SENT — the one number the rail carries.
                      A queued message used to be visible only on the page it
                      lives on, so a message correctly held back looked exactly
                      like one that was never created. It renders only when
                      there is something to say: a persistent "0" is furniture,
                      and the eye stops reading furniture. */}
                  {link.href === "/admin/messages" && queuedCount > 0 && (
                    <span
                      data-testid="queued-badge"
                      className="ml-auto min-w-5 rounded-full bg-amber-500 px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums text-white dark:bg-amber-600"
                    >
                      {queuedCount}
                      {/* A bare number reads as "Messages 3" to a screen
                          reader, which is a quantity of nothing. */}
                      <span className="sr-only"> waiting to be sent</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
