import Link from "next/link";
import { notFound } from "next/navigation";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import type { ArchiveData } from "@/lib/cycle-close";
import { formatMoney } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { ExportArchiveButton } from "./export-button";

export const dynamic = "force-dynamic";

// THE READABLE ARCHIVE (2.9): who paid what, who was paid out, how much,
// when — rendered from the frozen snapshot, never re-derived. This page
// keeps working after the cycle itself is deleted; that is its whole point.
export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  // The archive is every member's money by name (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Cycle archive" />;
  const { id } = await params;
  const row = await prisma.cycleArchive.findUnique({ where: { cycleId: id } });
  if (!row) notFound();
  const archive = JSON.parse(row.data) as ArchiveData;
  const cycleStillExists = (await prisma.cycle.findUnique({ where: { id }, select: { id: true } })) !== null;

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          {/* THE INDEX THIS CAME FROM. It pointed at /admin/cycle/close —
              the closing screen of whatever cycle is ACTIVE now, which is a
              different cycle than the one being read. */}
          <Link href="/admin/cycles" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Past cycles
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">
            {archive.cycleName} — the record
          </h1>
          {!cycleStillExists && <Pill tone="neutral">cycle deleted — this record is what remains</Pill>}
          <span className="ml-auto">
            <ExportArchiveButton archive={archive} />
          </span>
        </div>
        <p className="mt-1 text-sm tabular-nums text-gray-600 dark:text-gray-400">
          {archive.startDate} to {archive.closedAt.slice(0, 10)} · {archive.plannedWeeks} weeks ·{" "}
          {archive.feePercent}% fee · {archive.members.length} members
        </p>
      </header>

      {/* ————— The cycle in four numbers ————— */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 animate-fade-in-up-1">
        <StatCard label="Received" cents={archive.totals.received} sub="every receipt" />
        <StatCard label="Paid out" cents={archive.totals.paidOutNet} sub="payout nets" delayClass="animate-fade-in-up-1" />
        <StatCard label="Still held at close" cents={archive.totals.stillHeld} sub="received minus paid out" delayClass="animate-fade-in-up-2" />
        <StatCard
          label="Carried forward"
          cents={archive.totals.outstanding}
          sub={`${archive.totals.membersShort} member${archive.totals.membersShort === 1 ? "" : "s"} short — now on their ledgers`}
          emphasis={archive.totals.outstanding > 0}
          delayClass="animate-fade-in-up-3"
        />
      </div>

      {/* ————— Every member ————— */}
      <Card className="animate-fade-in-up-2">
        <CardHeader title="Every member" sub="Contribution, weeks paid, what they received, and how they closed." />
        <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800/60">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Member", "Weekly", "Weeks paid", "Total paid", "Drawn", "Received (net)", "Closing balance", "Statement"].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap bg-gray-50/95 dark:bg-[#1a1a1a] px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {archive.members.map((m) => (
                <tr key={m.participationId}>
                  <td className="whitespace-nowrap border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 font-semibold text-gray-900 dark:text-white">
                    {m.name}
                    {m.nameAmharic ? (
                      <span className="font-normal text-gray-600 dark:text-gray-400"> {m.nameAmharic}</span>
                    ) : null}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {formatMoney(m.weeklyAmount)}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {m.weeksPaid} of {m.weeksCommitted}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {formatMoney(m.totalPaid)}
                  </td>
                  <td className="whitespace-nowrap border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {m.drawnWeek !== null ? `week ${m.drawnWeek}` : "never drawn"}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {m.receivedNet > 0 ? formatMoney(m.receivedNet) : "—"}
                    {m.settledFromPayout > 0 && (
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                        + {formatMoney(m.settledFromPayout)} settled onto their win week
                      </span>
                    )}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5">
                    {m.outstanding > 0 ? (
                      <Pill tone="problem">{formatMoney(m.outstanding)} carried</Pill>
                    ) : (
                      <Pill tone="good">$0</Pill>
                    )}
                  </td>
                  <td className="min-w-64 border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 text-xs text-gray-600 dark:text-gray-400">
                    {m.statement}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ————— Week by week ————— */}
      <Card className="animate-fade-in-up-3">
        <CardHeader title="Week by week" sub="What came in, who was drawn, what went out." />
        <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800/60">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Week", "Date", "Received", "Draw", "Payouts"].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap bg-gray-50/95 dark:bg-[#1a1a1a] px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {archive.weeks.map((w) => (
                <tr key={w.weekNumber} className={w.isSkipped ? "opacity-60" : ""}>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 font-semibold tabular-nums text-gray-900 dark:text-white">
                    {w.weekNumber}
                    {w.isSkipped && <span className="ml-1 font-normal text-gray-500">(skipped)</span>}
                  </td>
                  <td className="whitespace-nowrap border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {w.date}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {w.received > 0 ? formatMoney(w.received) : "—"}
                  </td>
                  <td className="whitespace-nowrap border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 text-gray-700 dark:text-gray-300">
                    {w.draw
                      ? `${w.draw.numbers.map((n) => `#${n}`).join(" + ")} — ${w.draw.winners.join(", ")}`
                      : "—"}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 text-xs tabular-nums text-gray-700 dark:text-gray-300">
                    {w.draw && w.draw.payouts.length > 0
                      ? w.draw.payouts
                          .map(
                            (p) =>
                              `#${p.number} ${p.who}: ${formatMoney(p.net)} ${p.status.toLowerCase()}${p.paidAt ? ` (${p.paidAt})` : ""}`,
                          )
                          .join(" · ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
