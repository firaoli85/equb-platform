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
    // A PILL ON THE STAGE, not a form control on a page. It sits on the dark
    // ground the draw screen now uses, reads as chrome rather than as an input,
    // and stays small enough that the wheel keeps the room's attention — which
    // is the whole reason it is on this screen at all.
    //
    // POINTER-EVENTS-AUTO TAKES CLICKS BACK. The strip this sits in is
    // click-through (page.tsx), because as a full-width band pinned to the top
    // it was covering the back arrow and eating its clicks. This label is the
    // only thing in that strip anyone needs to press, so it is the only thing
    // that hears a press. Changing the week mid-draw keeps working; the corner
    // of the screen stops being a dead zone.
    <label className="group pointer-events-auto relative inline-flex items-center">
      <span className="sr-only">Which week this draw is for</span>
      <select
        value={selectedWeekId}
        disabled={pending}
        onChange={(e) => {
          const weekId = e.target.value;
          startTransition(() => router.push(`/admin/wheel?week=${weekId}`));
        }}
        // appearance-none because the native chevron cannot be styled and looks
        // like a spreadsheet on a wall; the caret below is drawn instead.
        className="cursor-pointer appearance-none rounded-full border border-amber-200/25 bg-white/[0.04] py-2 pl-5 pr-10 text-lg font-semibold tracking-wide text-amber-50 outline-none transition-[background-color,border-color] duration-150 ease-out hover:bg-white/[0.08] focus-visible:border-amber-300/70 focus-visible:ring-2 focus-visible:ring-amber-300/40 disabled:opacity-50 motion-reduce:transition-none"
      >
        {weeks.map((w) => (
          // The options themselves render in the OS menu, which cannot be
          // styled — so they are given an explicit dark background rather than
          // flashing white on a projector when the menu opens.
          <option key={w.id} value={w.id} className="bg-[#14121f] text-amber-50">
            Week {w.weekNumber}
            {w.hasDraw ? " · drawn" : ""}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 8"
        className="pointer-events-none absolute right-4 h-2 w-3 text-amber-200/70"
      >
        <path d="M1 1 L6 6 L11 1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}
