import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, EmptyState, Table, Td, Th, trHoverCls } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Drill-down: what "received to date" is made of — by week and by member.
// ("Collections" means payouts to winners; money coming in is "received".)
// Uses the shared surfaces so a table here reads exactly like a table on
// Payments or Collections, in both themes.
export default async function ReceivedBreakdownPage() {
  const result = await getDashboard();
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-red-800 dark:text-red-400">{result.error}</p>
      </main>
    );
  }
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="Received to date" />;

  const expectedTotal = d.series.reduce((s, w) => s + w.expected, 0);
  const shortfall = Math.max(0, expectedTotal - d.position.totalReceived);

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Dashboard
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Received to date
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Every cent that has come in, by week and by member.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Received" cents={d.position.totalReceived} sub="money in, to date" emphasis />
        <StatCard
          label="Expected by now"
          cents={expectedTotal}
          sub="across the weeks that have elapsed"
          delayClass="animate-fade-in-up-1"
        />
        <StatCard
          label="Short"
          cents={shortfall}
          sub={shortfall === 0 ? "the group is fully current" : "still to collect for elapsed weeks"}
          emphasis={shortfall > 0}
          delayClass="animate-fade-in-up-2"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 animate-fade-in-up-2">
        <Card>
          <CardHeader title="By week" sub="what each week brought in against what it asked for" />
          {d.series.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="No weeks yet." hint="Weeks appear once the cycle starts." />
            </div>
          ) : (
            <Table className="!rounded-none !border-0 !shadow-none">
              <thead>
                <tr>
                  <Th>Week</Th>
                  <Th align="right">Received</Th>
                  <Th align="right">Expected</Th>
                  <Th align="right">Short</Th>
                </tr>
              </thead>
              <tbody>
                {d.series.map((w) => {
                  const gap = Math.max(0, w.expected - w.received);
                  return (
                    <tr key={w.weekNumber} className={trHoverCls}>
                      <Td numeric>{w.weekNumber}</Td>
                      <Td numeric align="right">
                        {formatMoney(w.received)}
                      </Td>
                      <Td numeric align="right" className="!text-gray-600 dark:!text-gray-400">
                        {formatMoney(w.expected)}
                      </Td>
                      <Td
                        numeric
                        align="right"
                        className={
                          gap > 0 ? "!text-red-700 dark:!text-red-400 font-semibold" : "!text-gray-500 dark:!text-gray-400"
                        }
                      >
                        {gap > 0 ? formatMoney(gap) : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="By member" sub="total contributed across the whole cycle" />
          {d.receivedByMember.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="Nothing received yet." hint="Record a payment on the Payments screen." />
            </div>
          ) : (
            <Table className="!rounded-none !border-0 !shadow-none">
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th align="right">Total received</Th>
                </tr>
              </thead>
              <tbody>
                {d.receivedByMember.map((m) => (
                  <tr key={m.participationId} className={trHoverCls}>
                    <Td>
                      <Link
                        href={`/admin/participations/${m.participationId}`}
                        className="font-semibold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                      >
                        {m.name}
                      </Link>
                    </Td>
                    <Td numeric align="right" className="font-bold">
                      {formatMoney(m.total)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </main>
  );
}
