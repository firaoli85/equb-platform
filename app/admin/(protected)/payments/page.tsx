import { getPaymentsGrid } from "@/app/actions/payments-view";
import { PaymentsScreen } from "./payments-screen";

export const dynamic = "force-dynamic";

// PAYMENTS — money coming IN. ONE screen with two representations: the
// MEMBERS list (default, where recording happens) and the GRID (the map).
// The old "Record week" view is gone — its job is done by clicking any week
// in either representation, which opens the same per-week panel.
// "Collections" elsewhere means payouts to winners, never this.
export default async function PaymentsPage() {
  const result = await getPaymentsGrid();
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-gray-700 dark:text-gray-300">{result.error}</p>
      </main>
    );
  }
  return (
    <main>
      <PaymentsScreen data={result.data} />
    </main>
  );
}
