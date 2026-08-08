"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/controls";
import { formatDateUTC } from "@/lib/format";

// CHOOSE ANY WEEK, not only the current one.
//
// The page it sits on is one the organizer likes as it is — paid / not paid /
// partial, split into sections. This adds a way to ask the same question about
// a different week and changes nothing else.
//
// It drives a SEARCH PARAM rather than client state, so the answer is still
// rendered on the server from the same derivation: a past week's page cannot
// drift from what that week actually looked like, presentation mode still
// applies, and the URL can be shared or reloaded.

export function WeekPicker({
  weeks,
  selected,
  currentWeek,
  label = "Week",
}: {
  weeks: { weekNumber: number; date: string }[];
  selected: number;
  /** Marked in the list, so "today" is never ambiguous on a past week. */
  currentWeek: number;
  label?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{label}</span>
      <Select
        value={String(selected)}
        disabled={pending}
        ariaLabel="Choose which week to show"
        className="w-64"
        onChange={(value) => {
          const next = new URLSearchParams(params.toString());
          // The current week is the default, so it needs no parameter — the
          // bare URL keeps meaning "this week".
          if (Number(value) === currentWeek) next.delete("week");
          else next.set("week", value);
          const query = next.toString();
          startTransition(() => router.push(query ? `?${query}` : "?", { scroll: false }));
        }}
        options={weeks.map((w) => ({
          value: String(w.weekNumber),
          label:
            `Week ${w.weekNumber} — ${formatDateUTC(new Date(w.date))}` +
            (w.weekNumber === currentWeek ? " (this week)" : ""),
        }))}
      />
    </label>
  );
}
