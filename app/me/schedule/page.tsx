import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyPortal } from "@/app/actions/member";
import { EqubCalendar, type CalendarWeek } from "@/components/member/equb-calendar";

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
    return (
      <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-300">
        You are not in the current cycle.
      </p>
    );
  }

  const weeks: CalendarWeek[] = p.weeks.map((w) => ({
    weekNumber: w.weekNumber,
    date: w.date.toISOString().slice(0, 10),
    status: w.status,
  }));

  // Open on the current week's month when it's theirs, else their first.
  const current = p.weeks.find((w) => w.weekNumber >= p.cycleWeek) ?? p.weeks[0];
  const defaultMonth = current.date.toISOString().slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Schedule</h1>
        <Link href="/me" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          ← Home
        </Link>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums -mt-2">
        Your weeks run from week {p.startWeek} to week {p.finishWeek}.
      </p>
      <EqubCalendar weeks={weeks} defaultMonth={defaultMonth} />
    </div>
  );
}
