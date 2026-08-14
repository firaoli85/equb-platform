import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyPortal } from "@/app/actions/member";
import { EqubCalendar, type CalendarWeek } from "@/components/member/equb-calendar";
import { formatDateLongUTC } from "@/lib/format";
import { memberWindowSentence } from "@/lib/member-window";
import { NotInCycle } from "@/components/member/not-in-cycle";
import { notInCurrentCycleLine } from "@/lib/member-history";

export const dynamic = "force-dynamic";

// Their schedule on a real calendar — THEIR weeks only (2.22).
export default async function SchedulePage() {
  const result = await getMyPortal();
  if (!result.ok) {
    if (result.error === "signed-out") redirect("/login");
    return (
      <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-300">{result.error}</p>
    );
  }
  const p = result.data.participation;

  if (!p) {
    // The same card home shows for the same state (14 Aug 2026) — this was a
    // bare centred paragraph, one of three voices for one fact.
    return <NotInCycle line={notInCurrentCycleLine(false)} />;
  }

  const weeks: CalendarWeek[] = p.weeks.map((w) => ({
    // THEIR OWN numbering, exactly as the home page converts it
    // (UI_STANDARDS 8c) — a mid-cycle joiner read "week 14" of their ten in
    // the calendar tooltips while home said week 1.
    weekNumber: w.ownWeek ?? w.weekNumber,
    date: w.date.toISOString().slice(0, 10),
    status: w.status,
  }));

  // Open on the current week's month when it's theirs, else their first.
  const current = p.weeks.find((w) => w.weekNumber >= p.cycleWeek) ?? p.weeks[0];
  const defaultMonth = current.date.toISOString().slice(0, 7);

  return (
    <div className="space-y-4">
      {/* The back link sits ABOVE the title with a real hit area — the same
          control History uses, rather than a 20px text link floated into the
          heading row. */}
      <div>
        <p className="mb-1 text-sm">
          <Link
            href="/me"
            className="inline-flex min-h-11 items-center text-gray-600 hover:underline dark:text-gray-400"
          >
            ← Home
          </Link>
        </p>
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Schedule</h1>
      </div>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums -mt-2">
        {memberWindowSentence({
          startDate: p.startDate === null ? null : new Date(p.startDate),
          weeksCommitted: p.weeksCommitted,
          finishDate: p.finishDate === null ? null : new Date(p.finishDate),
          formatDate: formatDateLongUTC,
        })}
      </p>
      <EqubCalendar weeks={weeks} defaultMonth={defaultMonth} totalWeeks={p.weeksCommitted} />
    </div>
  );
}
