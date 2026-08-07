import type { ReactNode } from "react";

// THE MEMBER'S DESTINATIONS — defined once, rendered by both the mobile tab
// bar and the desktop sidebar.
//
// UI_STANDARDS rule 3: one component, one appearance. Two nav components that
// each held their own list is exactly how "Where you are signed in" ended up
// reachable from a tile on the home screen and from nowhere else.
//
// THE ACTIVE-STATE SIGNALS (UI_STANDARDS rule 9). Colour alone is never
// enough — it disappears in bright sun and for a colour-blind member — so the
// active item carries THREE:
//
//   1. SURFACE   the item sits on a filled capsule that is the INVERSION of
//                its bar (near-black on white; white on near-black). This is
//                the highest-contrast treatment available, and it is the one
//                the old tint-on-tint indigo could not reach.
//   2. ICON      solid fill when active, outline when not — the komoot
//                signal, readable with no colour perception at all.
//   3. WEIGHT    bold when active, semibold when not.
//
// Inactive labels are FULL-STRENGTH text, not decoration. The previous app set
// them at gray-400/10px, members could not see the other tabs, and they phoned
// the organizer. That is the failure this file exists to prevent.

export type MemberNavItem = {
  label: string;
  href: string;
  /** Longer wording for the sidebar, where there is room for it. */
  sidebarHint?: string;
};

/**
 * The bottom bar's items. Four, deliberately under the five-item ceiling —
 * past five a bottom nav stops being navigable on a phone.
 */
export const MEMBER_TABS: readonly MemberNavItem[] = [
  { label: "Home", href: "/me", sidebarHint: "Your savings and weeks" },
  { label: "Group", href: "/me/group", sidebarHint: "Everyone's progress" },
  { label: "Collections", href: "/me/collections", sidebarHint: "Who has been paid out" },
  { label: "Account", href: "/me/security", sidebarHint: "Where you are signed in" },
];

/** Secondary destinations — desktop sidebar only; tiles on the home screen. */
export const MEMBER_SECONDARY: readonly MemberNavItem[] = [
  { label: "Schedule", href: "/me/schedule", sidebarHint: "Week by week" },
  { label: "Documents", href: "/me/documents", sidebarHint: "Statements to keep" },
];

/** `/me` must match exactly, or it would light up on every child route. */
export function isNavActive(href: string, pathname: string): boolean {
  return href === "/me" ? pathname === "/me" : pathname.startsWith(href);
}

/**
 * One icon, two weights. `solid` is the second active signal; without it the
 * active state would rest on colour and surface alone.
 */
export function MemberNavIcon({
  href,
  solid,
  className = "h-5 w-5",
}: {
  href: string;
  solid: boolean;
  className?: string;
}): ReactNode {
  const outline = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.9,
    "aria-hidden": true as const,
  };
  const filled = {
    className,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true as const,
  };

  switch (href) {
    case "/me":
      return solid ? (
        <svg {...filled}>
          <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 11-1.06 1.06l-.16-.16v6.19A2.38 2.38 0 0117.62 22H14.5a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-2a.75.75 0 00-.75.75v4.5A.75.75 0 019.5 22H6.38A2.38 2.38 0 014 19.62v-6.19l-.16.16a.75.75 0 01-1.06-1.06l8.69-8.69z" />
        </svg>
      ) : (
        <svg {...outline}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L12 2l9 7.5V20a2 2 0 01-2 2h-3.5v-6h-7v6H5a2 2 0 01-2-2z" />
        </svg>
      );

    case "/me/group":
      return solid ? (
        <svg {...filled}>
          <path d="M8.25 6.75a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM15.75 9.75a3 3 0 116 0 3 3 0 01-6 0zM2.25 9.75a3 3 0 116 0 3 3 0 01-6 0zM6.31 15.12a5.99 5.99 0 0111.38 0 .75.75 0 01-.41.94 13.4 13.4 0 01-10.56 0 .75.75 0 01-.41-.94zM5.08 14.4a6.5 6.5 0 00-.72 1.62.75.75 0 01-.94.5 9.3 9.3 0 01-1.9-.83.75.75 0 01-.37-.65 4.5 4.5 0 013.93-4.46zM18.92 14.4a4.5 4.5 0 013.93 4.46.75.75 0 01-.37.65 9.3 9.3 0 01-1.9.83.75.75 0 01-.94-.5 6.5 6.5 0 00-.72-1.62z" />
        </svg>
      ) : (
        <svg {...outline}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 20h5v-2a3 3 0 00-5.36-1.86M17 20H7m10 0v-2c0-.66-.13-1.28-.36-1.86M7 20H2v-2a3 3 0 015.36-1.86M7 20v-2c0-.66.13-1.28.36-1.86m0 0a5 5 0 019.28 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      );

    case "/me/collections":
      return solid ? (
        <svg {...filled}>
          <path d="M12 8.25a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" />
          <path
            fillRule="evenodd"
            d="M1.5 5.63c0-1.04.84-1.88 1.88-1.88h17.25c1.03 0 1.87.84 1.87 1.88v9.74c0 1.04-.84 1.88-1.88 1.88H3.38a1.88 1.88 0 01-1.88-1.88V5.63zm6.75 4.87a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zm10.5-.75a.75.75 0 00-.75.75v.01c0 .41.34.75.75.75h.01a.75.75 0 00.75-.75v-.01a.75.75 0 00-.75-.75h-.01zm-14.25.75a.75.75 0 01.75-.75h.01a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75H5.25a.75.75 0 01-.75-.75v-.01z"
            clipRule="evenodd"
          />
          <path d="M2.25 18.75a.75.75 0 000 1.5c5.4 0 10.63.72 15.6 2.07 1.19.33 2.4-.55 2.4-1.82v-1a.75.75 0 00-.75-.75H2.25z" />
        </svg>
      ) : (
        <svg {...outline}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      );

    default: // /me/security — Account
      return solid ? (
        <svg {...filled}>
          <path
            fillRule="evenodd"
            d="M12.52 2.17a.75.75 0 00-1.04 0 11.21 11.21 0 01-7.88 3.08.75.75 0 00-.72.52A12.74 12.74 0 002.25 9.75c0 5.94 4.07 10.93 9.56 12.35a.75.75 0 00.38 0c5.5-1.42 9.56-6.41 9.56-12.35 0-1.39-.22-2.73-.63-3.98a.75.75 0 00-.72-.52h-.15c-3 0-5.72-1.17-7.73-3.08zm3.09 8.02a.75.75 0 10-1.22-.88l-3.24 4.53-1.62-1.62a.75.75 0 10-1.06 1.06l2.25 2.25a.75.75 0 001.14-.09l3.75-5.25z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg {...outline}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
  }
}
