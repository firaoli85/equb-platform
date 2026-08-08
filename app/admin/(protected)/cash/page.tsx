import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { CashPositionChart } from "@/components/charts/cash-position-chart";
import { PresentationHidden } from "@/components/presentation-hidden";
import {
  Card,
  CardHeader,
  EmptyState,
  Pill,
  Table,
  Td,
  Th,
  trHoverCls,
} from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// CASH POSITION — docs/ADMIN_IA.md §4.2.
//
// This screen replaces three orphan routes. `received`, `paid-out` and `held`
// were three lists of the same ledger seen from three angles, each reachable
// only by clicking a dashboard stat card, and none of them answered the
// question ground truth 2.1 actually names:
//
//     "the group is holding 2 weeks' worth of money that has not gone out yet"
//
// That is a POSITION OVER TIME, and no screen showed it. So: the chart first,
// then the three figures as tabs over the same ledger. The old routes redirect
// to the matching tab, so every existing link and every dashboard stat card
// still lands where it should.

const VIEWS = [
  { key: "held", label: "Held" },
  { key: "received", label: "Received" },
  { key: "paid-out", label: "Paid out" },
] as const;

type View = (typeof VIEWS)[number]["key"];

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: View = VIEWS.some((v) => v.key === raw) ? (raw as View) : "held";

  const result = await getDashboard();
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-red-800 dark:text-red-400">{result.error}</p>
      </main>
    );
  }
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="Cash position" />;

  const expectedTotal = d.series.reduce((s, w) => s + w.expected, 0);
  const shortfall = Math.max(0, expectedTotal - d.position.totalReceived);

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Cash position
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
          {formatMoney(d.position.totalReceived)} in − {formatMoney(d.position.totalPaidOut)} out ={" "}
          <strong className="font-bold text-gray-900 dark:text-white">
            {formatMoney(d.position.currentlyHeld)}
          </strong>{" "}
          in hand.
        </p>
      </header>

      {/* The three figures. Each is also the tab that opens its breakdown, so
          the number and the way into it are the same object. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Held"
          cents={d.position.currentlyHeld}
          sub="in hand right now"
          href="/admin/cash?view=held"
          emphasis
        />
        <StatCard
          label="Received"
          cents={d.position.totalReceived}
          sub="money in, to date"
          href="/admin/cash?view=received"
          delayClass="animate-fade-in-up-1"
        />
        <StatCard
          label="Paid out"
          cents={d.position.totalPaidOut}
          sub={`${d.paidOutCount} collection${d.paidOutCount === 1 ? "" : "s"} handed over`}
          href="/admin/cash?view=paid-out"
          delayClass="animate-fade-in-up-2"
        />
      </div>

      <CashPositionChart points={d.cash} className="animate-fade-in-up-2" />

      {/* Tabs over the same ledger. Real links, not client state: each view is
          a URL the organizer can bookmark, and the back button works. */}
      <nav aria-label="Cash breakdown" className="animate-fade-in-up-3">
        <ul className="inline-flex items-center gap-0.5 rounded-xl border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-white/5">
          {VIEWS.map((v) => (
            <li key={v.key}>
              <Link
                href={`/admin/cash?view=${v.key}`}
                aria-current={view === v.key ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg px-4 text-xs font-semibold transition-[background-color,color] duration-150 ease-out md:min-h-9 ${
                  view === v.key
                    ? "bg-white text-indigo-700 shadow-sm dark:bg-[#1f1f1f] dark:text-indigo-300"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                }`}
              >
                {v.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="animate-fade-in-up-3">
        {view === "held" && <HeldView d={d} />}
        {view === "received" && <ReceivedView d={d} expectedTotal={expectedTotal} shortfall={shortfall} />}
        {view === "paid-out" && <PaidOutView d={d} />}
      </div>
    </main>
  );
}

// The non-redacted shape. Presentation mode (2.4) drops every money field
// server-side, so the views below can only ever be reached with the full one.
type Data = Extract<
  Extract<Awaited<ReturnType<typeof getDashboard>>, { ok: true }>["data"],
  { presentation: false }
>;

// ————————————————————————— Held —————————————————————————

function HeldView({ d }: { d: Data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Committed"
          cents={d.position.committedPending}
          sub={`owed to ${d.position.pendingPayoutCount} pending payout${d.position.pendingPayoutCount === 1 ? "" : "s"}`}
          href="/admin/waiting"
        />
        <StatCard
          label="Uncommitted"
          cents={d.position.uncommitted}
          sub="held money not yet owed to anyone"
          emphasis={d.position.uncommitted > 0}
        />
      </div>

      <Card>
        <CardHeader
          title={`Committed to pending payouts — ${formatMoney(d.position.committedPending)}`}
          sub="drawn, not yet handed over"
          right={
            <Link
              href="/admin/waiting"
              className="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
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
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-5 py-3 last:border-b-0 dark:border-gray-800/60"
              >
                <Link
                  href="/admin/collections"
                  className="text-sm font-bold text-gray-900 hover:text-indigo-700 hover:underline dark:text-white dark:hover:text-indigo-300"
                >
                  {p.who}
                </Link>
                {p.weekNumber !== null && (
                  <Link href={`/admin/payments?week=${p.weekNumber}`}>
                    <Pill tone="neutral">won week {p.weekNumber}</Pill>
                  </Link>
                )}
                <span className="ml-auto text-sm font-black tabular-nums text-gray-900 dark:text-white">
                  {formatMoney(p.netAmount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-5 py-4">
        <p className="text-sm text-gray-800 dark:text-gray-200">
          <strong className="tabular-nums">{formatMoney(d.position.uncommitted)} uncommitted</strong>{" "}
          — held money not yet owed to anyone. Everything else in hand already belongs to a winner.
        </p>
      </Card>
    </div>
  );
}

// ——————————————————————— Received ———————————————————————

function ReceivedView({
  d,
  expectedTotal,
  shortfall,
}: {
  d: Data;
  expectedTotal: number;
  shortfall: number;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="Expected by now" cents={expectedTotal} sub="across the weeks that have elapsed" />
        <StatCard
          label="Short"
          cents={shortfall}
          sub={shortfall === 0 ? "the group is fully current" : "still to collect for elapsed weeks"}
          emphasis={shortfall > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
                      <Td numeric>
                        <Link
                          href={`/admin/payments?week=${w.weekNumber}`}
                          className="font-semibold hover:text-indigo-700 hover:underline dark:hover:text-indigo-300"
                        >
                          {w.weekNumber}
                        </Link>
                      </Td>
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
                          gap > 0
                            ? "!text-red-700 font-semibold dark:!text-red-400"
                            : "!text-gray-500 dark:!text-gray-400"
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
              <EmptyState
                title="Nothing received yet."
                hint="Record a payment on the Payments screen."
              />
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
                        className="font-semibold text-gray-900 hover:text-indigo-700 hover:underline dark:text-white dark:hover:text-indigo-300"
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
    </div>
  );
}

// ——————————————————————— Paid out ———————————————————————

function PaidOutView({ d }: { d: Data }) {
  return (
    <Card>
      <CardHeader
        title="Collections handed over"
        sub="money that has actually left — pending payouts are still held"
        right={
          <Link
            href="/admin/collections"
            className="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
          >
            Collections →
          </Link>
        }
      />
      {d.paidOutDetail.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState
            title="Nothing has been paid out yet."
            hint="A collection is recorded on the Collections screen once the winner takes the money."
          />
        </div>
      ) : (
        <Table className="!rounded-none !border-0 !shadow-none">
          <thead>
            <tr>
              <Th>Who</Th>
              <Th>Week won</Th>
              <Th>Handed over</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {d.paidOutDetail.map((p) => (
              <tr key={p.id} className={trHoverCls}>
                <Td>
                  <Link
                    href="/admin/collections"
                    className="font-semibold text-gray-900 hover:text-indigo-700 hover:underline dark:text-white dark:hover:text-indigo-300"
                  >
                    {p.who}
                  </Link>
                </Td>
                <Td numeric>
                  {p.weekNumber === null ? (
                    <span className="text-gray-500 dark:text-gray-400">—</span>
                  ) : (
                    <Link
                      href={`/admin/payments?week=${p.weekNumber}`}
                      className="hover:text-indigo-700 hover:underline dark:hover:text-indigo-300"
                    >
                      {p.weekNumber}
                    </Link>
                  )}
                </Td>
                <Td className="!text-gray-600 dark:!text-gray-400">
                  {p.paidAt
                    ? new Date(p.paidAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })
                    : "—"}
                </Td>
                <Td numeric align="right" className="font-bold">
                  {formatMoney(p.netAmount)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
