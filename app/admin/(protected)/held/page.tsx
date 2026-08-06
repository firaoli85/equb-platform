import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, EmptyState, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Drill-down: what "currently held" is made of (2.1 — no dead figures). The
// split that matters is committed vs uncommitted: one is already spoken for,
// the other is the only money genuinely free.
export default async function HeldBreakdownPage() {
  const result = await getDashboard();
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-red-800 dark:text-red-400">{result.error}</p>
      </main>
    );
  }
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="Currently held" />;

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Dashboard
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Currently held
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
          {formatMoney(d.position.totalReceived)} received − {formatMoney(d.position.totalPaidOut)}{" "}
          paid out.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Held" cents={d.position.currentlyHeld} sub="in hand right now" emphasis />
        <StatCard
          label="Committed"
          cents={d.position.committedPending}
          sub={`owed to ${d.position.pendingPayoutCount} pending payout${d.position.pendingPayoutCount === 1 ? "" : "s"}`}
          href="/admin/waiting"
          delayClass="animate-fade-in-up-1"
        />
        <StatCard
          label="Uncommitted"
          cents={d.position.uncommitted}
          sub="held money not yet owed to anyone"
          emphasis={d.position.uncommitted > 0}
          delayClass="animate-fade-in-up-2"
        />
      </div>

      <Card className="animate-fade-in-up-2">
        <CardHeader
          title={`Committed to pending payouts — ${formatMoney(d.position.committedPending)}`}
          sub="drawn, not yet handed over"
          right={
            <Link
              href="/admin/waiting"
              className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
            >
              Who is waiting →
            </Link>
          }
        />
        {d.pendingPayouts.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="No pending payouts."
              hint="Every drawn payout has been handed over, so all held money is uncommitted."
            />
          </div>
        ) : (
          <ul className="border-t border-gray-100 dark:border-gray-800/60">
            {d.pendingPayouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 dark:border-gray-800/60 px-5 py-3 last:border-b-0"
              >
                <Link
                  href="/admin/collections"
                  className="text-sm font-bold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                >
                  {p.who}
                </Link>
                {p.weekNumber !== null && <Pill tone="neutral">won week {p.weekNumber}</Pill>}
                <span className="ml-auto text-sm font-black tabular-nums text-gray-900 dark:text-white">
                  {formatMoney(p.netAmount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="animate-fade-in-up-3 px-5 py-4">
        <p className="text-sm text-gray-800 dark:text-gray-200">
          <strong className="tabular-nums">{formatMoney(d.position.uncommitted)} uncommitted</strong>{" "}
          — held money not yet owed to anyone. Everything else in hand already belongs to a winner.
        </p>
      </Card>
    </main>
  );
}
