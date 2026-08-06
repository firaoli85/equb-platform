import Link from "next/link";
import { getCloseReview } from "@/app/actions/cycle-close";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { formatDateUTC } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { CloseFlow, DeleteCycleCard } from "./close-flow";

export const dynamic = "force-dynamic";

// THE SEPTEMBER 27 FLOW (2.9): review everything unfinished → statements →
// close → archive → clean delete. Deliberate and reviewable, not a button.
export default async function CycleClosePage() {
  // The review is every member's money by name (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Cycle close" />;

  const review = await getCloseReview();
  const closedCycles = await prisma.cycle.findMany({
    where: { status: "CLOSED" },
    orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, closedAt: true },
  });
  const archives = await prisma.cycleArchive.findMany({
    orderBy: { closedAt: "desc" },
    select: { cycleId: true, cycleName: true, closedAt: true },
  });
  const closedIds = new Set(closedCycles.map((c) => c.id));

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin/cycle" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Cycle
          </Link>
        </p>
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">Closing a cycle</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
          Review everything unfinished, send the closing statements, then close. Closing writes
          each shortfall to the person&apos;s carried ledger (2.18) and freezes a readable archive
          (2.9). Only a closed, archived cycle can be deleted — and deleting never touches
          people, their ledgers, or the archive.
        </p>
      </header>

      {review.ok ? (
        <div className="animate-fade-in-up-1">
          <CloseFlow review={review.data} />
        </div>
      ) : (
        <Card className="animate-fade-in-up-1 px-5 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">{review.error}</p>
        </Card>
      )}

      {/* ————— Past cycles: closed (deletable) and archived (permanent) ————— */}
      {closedCycles.length > 0 && (
        <section className="space-y-3 animate-fade-in-up-2">
          <h2 className="text-base font-black text-gray-900 dark:text-white">Closed cycles</h2>
          {closedCycles.map((c) => (
            <DeleteCycleCard
              key={c.id}
              cycle={{
                id: c.id,
                name: c.name,
                closedAt: c.closedAt ? formatDateUTC(c.closedAt) : "—",
                archived: archives.some((a) => a.cycleId === c.id),
              }}
            />
          ))}
        </section>
      )}

      {archives.length > 0 && (
        <Card className="animate-fade-in-up-3">
          <CardHeader
            title="The archive"
            sub="Readable records of every closed cycle — they outlive the cycles themselves (2.9)."
          />
          <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
            {archives.map((a) => (
              <li key={a.cycleId} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Link
                  href={`/admin/cycles/${a.cycleId}/archive`}
                  className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
                >
                  {a.cycleName}
                </Link>
                <span className="tabular-nums text-gray-600 dark:text-gray-400">
                  closed {formatDateUTC(a.closedAt)}
                </span>
                {!closedIds.has(a.cycleId) && <Pill tone="neutral">cycle deleted — archive kept</Pill>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
