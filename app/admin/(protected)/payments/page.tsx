import Link from "next/link";
import { getPaymentsGrid, getWeekBoard } from "@/app/actions/payments-view";
import { PaymentsBoard } from "./payments-board";
import { PaymentsGrid } from "./payments-grid";

export const dynamic = "force-dynamic";

// PAYMENTS — money coming IN. Defaults to the GRID (the map, 2.15); the
// single-week action list is the second view. "Collections" elsewhere means
// payouts to winners, never this.
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; week?: string | string[] }>;
}) {
  const params = await searchParams;
  const view = (Array.isArray(params.view) ? params.view[0] : params.view) === "week" ? "week" : "grid";
  const rawWeek = Array.isArray(params.week) ? params.week[0] : params.week;
  const parsedWeek = rawWeek !== undefined ? Number.parseInt(rawWeek, 10) : Number.NaN;

  const toggle = (
    <p className="mb-4 flex items-center gap-4 text-sm">
      <span className="ml-auto inline-flex items-center gap-0.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-white/5 p-0.5">
        <Link
          href="/admin/payments"
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
            view === "grid"
              ? "bg-white dark:bg-[#1f1f1f] text-indigo-700 dark:text-indigo-300 shadow-sm"
              : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          The map
        </Link>
        <Link
          href="/admin/payments?view=week"
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
            view === "week"
              ? "bg-white dark:bg-[#1f1f1f] text-indigo-700 dark:text-indigo-300 shadow-sm"
              : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Record week
        </Link>
      </span>
    </p>
  );

  if (view === "week") {
    const result = await getWeekBoard(
      Number.isSafeInteger(parsedWeek) ? { weekNumber: parsedWeek } : undefined,
    );
    if (!result.ok) {
      return (
        <main>
          {toggle}
          <p className="text-sm text-gray-700">{result.error}</p>
        </main>
      );
    }
    return (
      <main>
        {toggle}
        {/* Keyed by week so switching weeks remounts the board and recaptures
            its frozen row order. */}
        <PaymentsBoard key={result.data.weekNumber} board={result.data} />
      </main>
    );
  }

  const result = await getPaymentsGrid();
  if (!result.ok) {
    return (
      <main>
        {toggle}
        <p className="text-sm text-gray-700">{result.error}</p>
      </main>
    );
  }
  return (
    <main>
      {toggle}
      <PaymentsGrid data={result.data} />
    </main>
  );
}
