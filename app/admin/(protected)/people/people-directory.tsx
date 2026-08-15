"use client";

import Link from "next/link";
import { useState } from "react";
import { SigningChip } from "@/components/admin/agreement-signing";
import { Pill, type PillTone } from "@/components/ui/primitives";
import type { SigningState } from "@/lib/agreement-view";
import { formatMoney } from "@/lib/format";
import { usePersistedChoice, useViewMode, ViewToggle } from "@/components/ui/view-toggle";
import {
  countSigning,
  filterBySigning,
  SIGNING_FILTERS,
  type SigningFilter,
} from "@/lib/signing-monitor";
import { DIRECTORY_SORTS, sortDirectory, type DirectorySortKey } from "@/lib/people-sort";
import { Select } from "@/components/ui/controls";
import { InitialAvatar } from "@/components/ui/initial-avatar";

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
  const [view, setView] = useViewMode("admin-people-view", "grid");
  // Persisted like the view choice (the localStorage pattern this screen
  // already uses) — alphabetical until the organizer picks otherwise.
  const [sort, setSort] = usePersistedChoice<DirectorySortKey>(
    "admin-people-sort",
    DIRECTORY_SORTS.map((s) => s.key),
    "name",
  );
  // The filter is not persisted: narrowing to "waiting" is something he does
  // for a minute, not a preference. The sort and the view are preferences and
  // stay persisted, as they were.
  const [signing, setSigning] = useState<SigningFilter>("all");
  const counts = countSigning(unsorted);
  const rows = sortDirectory(filterBySigning(unsorted, signing), sort);

  return (
    <div className="space-y-3">
      {/* WHO HAS SIGNED, IN ONE LINE. Every figure is already on the rows —
          this queries nothing.

          THE TONES CARRY THE MEANING, and they are not the same: "not asked"
          is the ORDINARY state (no welcome was ever sent, nothing is owed by
          anyone), so it reads neutral. Only "waiting" is work. Painting them
          alike would report problems on a group that has none. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {SIGNING_FILTERS.map((f) => {
          const n =
            f.key === "all"
              ? counts.total
              : f.key === "signed"
                ? counts.signed
                : f.key === "waiting"
                  ? counts.waiting
                  : counts.notAsked;
          const active = signing === f.key;
          // Waiting is the only bucket that means work; it keeps the amber
          // reading even when it is not the active chip.
          const attention = f.key === "waiting" && n > 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setSigning(f.key)}
              aria-pressed={active}
              className={`min-h-11 md:min-h-8 rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] ${
                active
                  ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300"
                  : attention
                    ? "border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
              }`}
            >
              {n} {f.label.toLowerCase()}
            </button>
          );
        })}
        {signing !== "all" && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            showing {rows.length} of {counts.total}
          </span>
        )}
      </div>

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
                    <Link href={`/admin/people/${p.id}`} className="flex items-center gap-2.5 hover:underline">
                      {/* THE SAME DISC AS THE CARDS. A member is one colour
                          everywhere, so the eye finds the row it found on the
                          other view. */}
                      <InitialAvatar name={p.nameEnglish} size="sm" />
                      <span className="min-w-0">
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
                      </span>
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
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p, idx) => (
            <Link
              key={p.id}
              href={`/admin/people/${p.id}`}
              className={`block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-150 ease-out hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-700 active:scale-[0.99]${idx < 9 ? " animate-fade-in-up" : ""}`}
              style={idx < 9 ? { animationDelay: `${idx * 0.05}s` } : undefined}
            >
              <div className="flex items-start gap-3">
                <InitialAvatar name={p.nameEnglish} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-gray-900 dark:text-white">
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
              {/* THEIR YEAR, ON THE CARD. The directory offers sorting by
                  weekly amount, weeks committed and weeks paid — and until
                  now displayed NONE of the three, so "sort by weeks paid"
                  reordered the page on a figure the reader could not see.
                  A card that carries them is also the difference between a
                  row of names and a member you can take in at a glance. */}
              {p.inActiveCycle && p.weeksCommitted > 0 && (
                <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-white/[0.03]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                      {p.weeksPaid} of {p.weeksCommitted} weeks
                    </span>
                    <span className="text-[11px] font-bold tabular-nums text-gray-900 dark:text-white">
                      {formatMoney(p.contributedThisCycle)}
                    </span>
                  </div>
                  {/* The same bar the waiting screen uses. Rounded-full inside
                      a rounded-xl panel: a pill in a box, not two competing
                      radii. */}
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
                    role="progressbar"
                    aria-valuenow={p.weeksPaid}
                    aria-valuemin={0}
                    aria-valuemax={p.weeksCommitted}
                    aria-label={`${p.weeksPaid} of ${p.weeksCommitted} weeks paid`}
                  >
                    <span
                      className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400"
                      style={{
                        width: `${Math.min(100, Math.round((p.weeksPaid / p.weeksCommitted) * 100))}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                    {formatMoney(p.weeklyAmount)} a week
                  </p>
                </div>
              )}

              {/* The quiet facts last — a phone number is looked up, not read. */}
              <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-600 dark:text-gray-400">
                <span className="tabular-nums">{p.phone ?? "no phone"}</span>
                <span aria-hidden="true" className="opacity-40">
                  ·
                </span>
                <span className="min-w-0 truncate">
                  {p.inActiveCycle ? "In the current cycle" : p.cycles}
                </span>
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
