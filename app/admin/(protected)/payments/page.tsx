import { getPaymentsGrid } from "@/app/actions/payments-view";
import { focusedWeek } from "@/lib/week-focus";
import { PaymentsScreen } from "./payments-screen";

export const dynamic = "force-dynamic";

// PAYMENTS — money coming IN. ONE screen with two representations: the
// MEMBERS list (default, where recording happens) and the GRID (the map).
// The old "Record week" view is gone — its job is done by clicking any week
// in either representation, which opens the same per-week panel.
// "Collections" elsewhere means payouts to winners, never this.
//
// `?week=N` — ELEVEN LINKS ALREADY POINTED HERE. Every week number on the
// cash page and on all three charts is written as `/admin/payments?week=N`,
// and this route ignored the parameter entirely: the organizer clicked week 7
// on a chart and landed on the unfocused default, having to find week 7 again
// by eye. The links were guarded; the destination was not (§8).
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const result = await getPaymentsGrid();
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-gray-700 dark:text-gray-300">{result.error}</p>
      </main>
    );
  }
  // Bounded by the cycle's OWN weeks, so `?week=99` shows the ordinary screen
  // rather than a highlight pointing at nothing.
  const week = focusedWeek((await searchParams).week, result.data.grid.rows.length);
  return (
    <main>
      <PaymentsScreen data={result.data} focusWeek={week} />
    </main>
  );
}
