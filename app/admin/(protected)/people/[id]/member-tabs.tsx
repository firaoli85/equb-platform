import Link from "next/link";

// Tab state lives in the URL (?tab=…) so a tab is linkable and survives a
// reload — and, because these are plain links to a server-rendered page, only
// the chosen tab's content is ever built.

export const MEMBER_TABS = ["payments", "payout", "receipts", "settings", "history"] as const;
export type MemberTab = (typeof MEMBER_TABS)[number];

const LABELS: Record<MemberTab, string> = {
  payments: "Payments",
  payout: "Payout",
  receipts: "Receipts",
  settings: "Settings",
  history: "History",
};

export function parseTab(raw: string | string[] | undefined): MemberTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (MEMBER_TABS as readonly string[]).includes(value ?? "")
    ? (value as MemberTab)
    : "payments";
}

// ————————————————— The Settings tab's three jobs —————————————————
//
// Settings was one scroll holding participation, lucky numbers, names, phone,
// PIN, messaging and sign-in history — three unrelated concerns, the first of
// which is a page in its own right. They are separated here rather than in the
// page so the labels and the parser cannot drift apart.
//
// MONEY FIRST. It is the consequential one — saving it replays receipts and
// can re-settle a payout — so it is the default and it is named for what it
// changes, not for the form it contains.

export const MEMBER_SETTINGS_SECTIONS = ["participation", "person", "access"] as const;
export type MemberSettingsSection = (typeof MEMBER_SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION_LABELS: Record<MemberSettingsSection, string> = {
  participation: "Participation and money",
  person: "Name and phone",
  access: "Access and messaging",
};

export function parseSection(raw: string | string[] | undefined): MemberSettingsSection {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (MEMBER_SETTINGS_SECTIONS as readonly string[]).includes(value ?? "")
    ? (value as MemberSettingsSection)
    : "participation";
}

export function MemberTabBar({
  personId,
  active,
  counts,
}: {
  personId: string;
  active: MemberTab;
  counts: { receipts: number; numbers: number; cycles: number };
}) {
  const count: Partial<Record<MemberTab, number>> = {
    payout: counts.numbers,
    receipts: counts.receipts,
    history: counts.cycles,
  };
  return (
    <nav
      aria-label="Member sections"
      className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800"
    >
      {MEMBER_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <Link
            key={tab}
            href={`/admin/people/${personId}?tab=${tab}`}
            aria-current={isActive ? "page" : undefined}
            scroll={false}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors duration-150 ${
              isActive
                ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
                : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {LABELS[tab]}
            {count[tab] !== undefined && (
              <span className="ml-1.5 rounded-full bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-gray-600 dark:text-gray-400">
                {count[tab]}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
