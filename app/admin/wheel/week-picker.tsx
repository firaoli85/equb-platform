"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// WHICH WEEK THIS PAYOUT IS AWARDED TO — chosen on the draw screen itself.
//
// The screen auto-picked the earliest undrawn week and showed the number as a
// heading, so the one decision the organizer actually makes at the draw was the
// one thing he could not touch. Money is held across weeks when members are
// late, and the slot that comes out is awarded to whichever week the cash has
// finally covered — "week 1 already out, I can still select it".
//
// §2.4 — THIS SCREEN IS PROJECTED ON A CALL, and that shapes every choice here:
//
//   ONE CONTROL, NOT A PANEL. A select and nothing else. No slot grid, no
//   winner list, no plan counts, no eligibility markers — those live on
//   /admin/wheel/setup, which is not shared.
//
//   NUMBERS ONLY IN THE OPTIONS. "Week 5" and, where it is true, "drawn". A
//   drawn week is already public — the room watched it happen. What the setup
//   screen says, "Week 5 (2 winners)", would tell the room how many payouts are
//   lined up, so it is not said here.
//
//   IT LOOKS LIKE THE HEADING IT REPLACED. Same size and weight as the old
//   "Week 10" title, so the screen gained a choice without gaining furniture.
//
// A URL, NOT CLIENT STATE. The week rides in `?week=`, so the server re-derives
// the eligible slots for the chosen week and the wheel is never showing one
// week's segments under another week's number.

export function WeekPicker({
  weeks,
  selectedWeekId,
}: {
  weeks: readonly { id: string; weekNumber: number; hasDraw: boolean }[];
  selectedWeekId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Which week this draw is for</span>
      <select
        value={selectedWeekId}
        disabled={pending}
        onChange={(e) => {
          const weekId = e.target.value;
          startTransition(() => router.push(`/admin/wheel?week=${weekId}`));
        }}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-2xl font-semibold text-gray-900 disabled:opacity-60 dark:border-gray-700 dark:bg-[#141414] dark:text-white"
      >
        {weeks.map((w) => (
          <option key={w.id} value={w.id}>
            Week {w.weekNumber}
            {w.hasDraw ? " (drawn)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
