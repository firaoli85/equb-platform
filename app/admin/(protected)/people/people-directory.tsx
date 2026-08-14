"use client";

import Link from "next/link";
import { SigningChip } from "@/components/admin/agreement-signing";
import { Pill, type PillTone } from "@/components/ui/primitives";
import type { SigningState } from "@/lib/agreement-view";
import { formatMoney } from "@/lib/format";
import { usePersistedChoice, useViewMode, ViewToggle } from "@/components/ui/view-toggle";
import { DIRECTORY_SORTS, sortDirectory, type DirectorySortKey } from "@/lib/people-sort";
import { Select } from "@/components/ui/controls";

// Display-only rows, computed server-side — no raw person records cross to
// the client, just what the directory renders.
export type DirectoryRow = {
  id: string;
  nameAmharic: string;
  nameEnglish: string;
  phone: string | null;
  pinState: "own" | "default" | "none";
  /** Minutes left on an active PIN lock; null = not locked (2.23). */
  lockedMinutesLeft: number | null;
  cycles: string;
  inActiveCycle: boolean;
  /** Where they stand on the member agreement — derived, never stored. */
  signing: SigningState;
  /** Cents contributed to the active cycle (2.1) — 0 when not a member. */
  contributedThisCycle: number;
  /** Sort facts (14 Aug 2026): the ACTIVE participation's figures, 0 outside one. */
  weeklyAmount: number;
  weeksCommitted: number;
  /** Weeks their money covers — the same quotient weeksCredited derives from. */
  weeksPaid: number;
};

const PIN_LABEL: Record<DirectoryRow["pinState"], { tone: PillTone; text: string }> = {
  own: { tone: "good", text: "Own PIN" },
  default: { tone: "attention", text: "Default (last 4)" },
  none: { tone: "neutral", text: "OTP only" },
};

export function PeopleDirectory({ rows: unsorted }: { rows: DirectoryRow[] }) {
  const [view, setView] = useViewMode("admin-people-view", "list");
  // Persisted like the view choice (the localStorage pattern this screen
  // already uses) — alphabetical until the organizer picks otherwise.
  const [sort, setSort] = usePersistedChoice<DirectorySortKey>(
    "admin-people-sort",
    DIRECTORY_SORTS.map((s) => s.key),
    "name",
  );
  const rows = sortDirectory(unsorted, sort);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Sort</span>
          <Select
            value={sort}
            onChange={(v) => setSort(v as DirectorySortKey)}
            ariaLabel="Sort the directory"
            className="w-44"
            options={DIRECTORY_SORTS.map((s) => ({ value: s.key, label: s.label }))}
          />
        </span>
        <ViewToggle mode={view} onChange={setView} labels={{ list: "List", grid: "Cards" }} />
      </div>

      {view === "list" ? (
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm animate-fade-in-up">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Member", "Phone", "Sign-in PIN", "Agreement", "Cycles"].map((h) => (
                  <th
                    key={h}
                    className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-white/[0.03] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className="transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                >
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5">
                    <Link href={`/admin/people/${p.id}`} className="block hover:underline">
                      {/* LATIN PRIMARY (14 Aug 2026): the Amharic renders
                          after, smaller — and not at all where absent. */}
                      <span className="block font-semibold text-gray-900 dark:text-white">
                        {p.nameEnglish}
                      </span>
                      {p.nameAmharic && (
                        <span className="block text-xs text-gray-600 dark:text-gray-400">
                          {p.nameAmharic}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {p.phone ?? "—"}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5">
                    <span className="inline-flex flex-wrap gap-1.5">
                      <Pill tone={PIN_LABEL[p.pinState].tone}>{PIN_LABEL[p.pinState].text}</Pill>
                      {p.lockedMinutesLeft !== null && (
                        <Pill tone="problem">Locked · {p.lockedMinutesLeft} min</Pill>
                      )}
                    </span>
                  </td>
                  {/* ONE CHIP, SCANNABLE DOWN THE COLUMN. Beside the PIN
                      because both answer "can they get in", and the agreement
                      is the outer of the two doors. */}
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5">
                    <SigningChip state={p.signing} />
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5 text-gray-700 dark:text-gray-300">
                    {p.cycles}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p, idx) => (
            <Link
              key={p.id}
              href={`/admin/people/${p.id}`}
              className={`block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] px-4 py-3.5 shadow-sm transition-[border-color,transform] duration-150 ease-out hover:border-indigo-300 dark:hover:border-indigo-700 active:scale-[0.99]${idx < 9 ? " animate-fade-in-up" : ""}`}
              style={idx < 9 ? { animationDelay: `${idx * 0.05}s` } : undefined}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-sm font-bold text-indigo-700 dark:text-indigo-300"
                  aria-hidden="true"
                >
                  {([...p.nameEnglish][0] ?? [...p.nameAmharic][0] ?? "?").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {p.nameEnglish}
                  </span>
                  {p.nameAmharic && (
                    <span className="block truncate text-xs text-gray-600 dark:text-gray-400">
                      {p.nameAmharic}
                    </span>
                  )}
                </span>
                {/* Stacked, not side by side: two chips on one line squeeze
                    the name they sit beside. The cards must carry the same
                    signing state as the list — a view toggle that changes
                    which facts exist is how one view starts being trusted
                    over the other. */}
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {/* BOTH, as the list shows them: a lock is a state ON TOP
                      of a PIN, not a replacement for it. */}
                  <Pill tone={PIN_LABEL[p.pinState].tone}>{PIN_LABEL[p.pinState].text}</Pill>
                  {p.lockedMinutesLeft !== null && (
                    <Pill tone="problem">Locked · {p.lockedMinutesLeft} min</Pill>
                  )}
                  <SigningChip state={p.signing} />
                </span>
              </div>
              <p className="mt-2.5 flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-400">
                <span className="tabular-nums">{p.phone ?? "no phone"}</span>
                <span>{p.inActiveCycle ? "In the current cycle" : p.cycles}</span>
                {p.inActiveCycle && (
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                    {formatMoney(p.contributedThisCycle)} paid in
                  </span>
                )}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
