import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { PresentationHidden } from "@/components/presentation-hidden";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Drill-down: what "currently held" is made of (2.1 — no dead figures).
export default async function HeldBreakdownPage() {
  const result = await getDashboard();
  if (!result.ok) return <main className="text-sm text-red-800">{result.error}</main>;
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="Currently held" />;

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/admin" className="underline">← Dashboard</Link>
      </p>
      <h1 className="mb-2 text-xl font-semibold">
        Currently held: {formatMoney(d.position.currentlyHeld)}
      </h1>
      <p className="mb-6 text-sm text-gray-700">
        Received {formatMoney(d.position.totalReceived)} − paid out{" "}
        {formatMoney(d.position.totalPaidOut)}.
      </p>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">
          Committed to pending payouts: {formatMoney(d.position.committedPending)}
        </h2>
        {d.pendingPayouts.length === 0 ? (
          <p className="text-sm text-gray-700">No pending payouts.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.pendingPayouts.map((p) => (
              <li key={p.id}>
                <Link href="/admin/collections" className="underline">
                  {p.who}
                </Link>
                {p.weekNumber !== null && ` (won week ${p.weekNumber})`} —{" "}
                <strong>{formatMoney(p.netAmount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-gray-300 p-3 text-sm">
        <strong>Uncommitted: {formatMoney(d.position.uncommitted)}</strong> — held money not
        yet owed to anyone.
      </section>
    </main>
  );
}
