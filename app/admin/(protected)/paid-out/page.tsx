import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, EmptyState, Table, Td, Th, trHoverCls } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateUTC, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Drill-down: who received the paid-out money, and when. Same surfaces as
// Collections and Received, so the three read as one product in both themes.
export default async function PaidOutBreakdownPage() {
  const result = await getDashboard();
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-red-800 dark:text-red-400">{result.error}</p>
      </main>
    );
  }
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="Paid out to date" />;

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Dashboard
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Paid out to date
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Money that has actually crossed the table — collected payouts only. Anything drawn but
          not yet handed over is on{" "}
          <Link href="/admin/waiting" className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">
            Who is waiting
          </Link>
          .
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Paid out" cents={d.position.totalPaidOut} sub="handed over and collected" emphasis />
        <StatCard
          label="Still committed"
          cents={d.position.committedPending}
          sub={`${d.position.pendingPayoutCount} pending payout${d.position.pendingPayoutCount === 1 ? "" : "s"}`}
          href="/admin/waiting"
          delayClass="animate-fade-in-up-1"
        />
        <StatCard
          label="Payouts collected"
          figure={String(d.paidOutDetail.length)}
          sub="across the whole cycle"
          delayClass="animate-fade-in-up-2"
        />
      </div>

      <Card className="animate-fade-in-up-2">
        <CardHeader title="Every collected payout" sub="newest weeks first" />
        {d.paidOutDetail.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="Nothing has been paid out."
              hint="A payout appears here once it is marked collected in Collections."
            />
          </div>
        ) : (
          <Table className="!rounded-none !border-0 !shadow-none">
            <thead>
              <tr>
                <Th>Winner</Th>
                <Th align="right">Week won</Th>
                <Th align="right">Net paid</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {d.paidOutDetail.map((p) => (
                <tr key={p.id} className={trHoverCls}>
                  <Td>
                    <Link
                      href="/admin/collections"
                      className="font-semibold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                    >
                      {p.who}
                    </Link>
                  </Td>
                  <Td numeric align="right" className="!text-gray-600 dark:!text-gray-400">
                    {p.weekNumber ?? "—"}
                  </Td>
                  <Td numeric align="right" className="font-bold">
                    {formatMoney(p.netAmount)}
                  </Td>
                  <Td numeric align="right" className="!text-gray-600 dark:!text-gray-400">
                    {p.paidAt ? formatDateUTC(p.paidAt) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </main>
  );
}
