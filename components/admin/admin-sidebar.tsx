"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The admin shell's navigation (Toggl-style eyebrow groups). The current
// page is unmistakable: indigo fill + bold. Wheel setup links out of the
// (protected) group — it deliberately lives on its own bare layout (2.4).

type NavLink = { label: string; href: string; exact?: boolean };
type NavGroup = { eyebrow: string; links: NavLink[] };

const GROUPS: NavGroup[] = [
  {
    eyebrow: "Overview",
    links: [{ label: "Dashboard", href: "/admin", exact: true }],
  },
  {
    eyebrow: "Money",
    links: [
      { label: "Payments", href: "/admin/payments" },
      { label: "Collections", href: "/admin/collections" },
      { label: "Who is waiting", href: "/admin/waiting" },
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
      { label: "Cycle", href: "/admin/cycle" },
      { label: "Messages", href: "/admin/messages" },
    ],
  },
  {
    eyebrow: "System",
    links: [
      { label: "New cycle", href: "/admin/cycles/new" },
      { label: "Settings", href: "/admin/settings" },
      { label: "Audit log", href: "/admin/audit" },
    ],
  },
];

function NavIcon({ href }: { href: string }) {
  const cls = "h-4 w-4 shrink-0";
  const common = {
    className: cls,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true as const,
  };
  switch (href) {
    case "/admin":
      return (
        <svg {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
        </svg>
      );
    case "/admin/payments":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </svg>
      );
    case "/admin/collections":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      );
    case "/admin/waiting":
      // A clock: the group owes this money and time is passing.
      return (
        <svg {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
        </svg>
      );
    case "/admin/wheel/setup":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "/admin/wheel":
      return (
        <svg {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
        </svg>
      );
    case "/admin/people":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      );
    case "/admin/cycle":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      );
    case "/admin/messages":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
      );
    case "/admin/cycles/new":
      return (
        <svg {...common}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      );
    case "/admin/settings":
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      );
  }
}

export function AdminSidebar() {
  const pathname = usePathname();

  function isActive(link: NavLink) {
    return link.exact ? pathname === link.href : pathname.startsWith(link.href);
  }

  return (
    // min-h-0 is load-bearing: a flex child will not shrink below its content
    // without it, so overflow-y-auto never engages and the last nav groups are
    // simply unreachable on a short laptop screen.
    <nav
      className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4"
      aria-label="Admin navigation"
    >
      {GROUPS.map((group) => (
        <div key={group.eyebrow}>
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400">
            {group.eyebrow}
          </p>
          <div className="space-y-0.5">
            {group.links.map((link) => {
              const active = isActive(link);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] ${
                    active
                      ? "bg-indigo-50 dark:bg-indigo-950/50 font-bold text-indigo-700 dark:text-indigo-300"
                      : "font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
                  }`}
                >
                  <span className={active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-500 dark:text-gray-400"}>
                    <NavIcon href={link.href} />
                  </span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
