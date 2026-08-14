import Link from "next/link";
import { listDraftCycles } from "@/app/actions/cycles";
import { Card, EmptyState, Pill } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { DraftCycles } from "./draft-cycles";

export const dynamic = "force-dynamic";

// ARCHIVES — docs/ADMIN_IA.md §4.3.
//
// `/admin/cycles/[id]/archive` existed with NO INDEX. Ground truth 2.9 says
// "past cycles remain viewable", and they were not viewable: you needed the
// id. The only link into an archive was from the closing screen of a
// different cycle, so a record the group may need years later was reachable
// only by accident.
//
// THE ARCHIVE IS THE ROW, NOT THE CYCLE. A closed cycle can be deleted (2.9,
// "clean delete") and its archive survives on purpose — so this page is built
// from CycleArchive and joins the cycle in where one still exists, rather
// than the other way round. Building it from Cycle would make exactly the
// records that outlived their cycle invisible.

type ArchiveShape = {
  totals?: { received?: number; paidOutNet?: number };
  members?: unknown[];
  plannedWeeks?: number;
};

function readTotals(json: string): { received: number | null; paidOut: number | null; members: number | null } {
  try {
    const parsed = JSON.parse(json) as ArchiveShape;
    return {
      received: parsed.totals?.received ?? null,
      paidOut: parsed.totals?.paidOutNet ?? null,
      members: Array.isArray(parsed.members) ? parsed.members.length : null,
    };
  } catch {
    // A snapshot that will not parse is still listed. It is the record of a
    // real cycle, and hiding it here would be the one thing worse than
    // showing it without its totals.
    return { received: null, paidOut: null, members: null };
  }
}

const day = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function CyclesIndexPage() {
  const [archives, cycles, draftsResult] = await Promise.all([
    prisma.cycleArchive.findMany({ orderBy: { closedAt: "desc" } }),
    prisma.cycle.findMany({
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        plannedWeeks: true,
        closedAt: true,
        _count: { select: { participations: true } },
      },
    }),
    // Through the ACTION, not a second query shape — the drafts section and
    // the activate/delete controls must agree on what a draft is.
    listDraftCycles(),
  ]);

  const archivedIds = new Set(archives.map((a) => a.cycleId));
  // Drafts get their own section below, with the controls that act on them —
  // they are no longer folded into "Running now", where a draft linked to
  // /admin/cycle (the ACTIVE cycle's page) and offered nothing a draft needs.
  const live = cycles.filter((c) => c.status === "ACTIVE");
  // A CLOSED cycle with no archive row should not exist — closing writes one —
  // but if it does, it is listed rather than silently dropped.
  const closedWithoutArchive = cycles.filter((c) => c.status === "CLOSED" && !archivedIds.has(c.id));
  const stillExists = new Map(cycles.map((c) => [c.id, c]));

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Cycles
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Every cycle this group has run. A closed cycle&rsquo;s record stays readable even after
          the cycle itself is deleted.
        </p>
      </header>

      {/* ————— Running now ————— */}
      <section className="space-y-3 animate-fade-in-up-1" aria-labelledby="running">
        <h2
          id="running"
          className="px-1 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
        >
          Running now
        </h2>
        {live.length === 0 ? (
          <Card className="px-5 py-4">
            <EmptyState
              title="No cycle is running."
              hint="Start one from “Start a new cycle” in the sidebar."
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {live.map((c) => (
              <li key={c.id}>
                <Card className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href="/admin/cycle"
                      className="text-base font-bold text-gray-900 hover:text-indigo-700 hover:underline dark:text-white dark:hover:text-indigo-300"
                    >
                      {c.name}
                    </Link>
                    <Pill tone="good">active</Pill>
                    <span className="ml-auto text-xs tabular-nums text-gray-600 dark:text-gray-400">
                      {c._count.participations} member{c._count.participations === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-gray-600 dark:text-gray-400">
                    From {day(c.startDate)} · {c.plannedWeeks} weeks
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ————— Drafts — section and header render only when drafts exist ————— */}
      {draftsResult.ok && <DraftCycles drafts={draftsResult.data} />}

      {/* ————— The record ————— */}
      <section className="space-y-3 animate-fade-in-up-2" aria-labelledby="archived">
        <h2
          id="archived"
          className="px-1 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
        >
          Closed — the record
        </h2>
        {archives.length === 0 ? (
          <Card className="px-5 py-4">
            <EmptyState
              title="No cycle has been closed yet."
              hint="Closing a cycle writes a permanent record of who paid what and who was paid out. It appears here."
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {archives.map((a) => {
              const totals = readTotals(a.data);
              const cycle = stillExists.get(a.cycleId);
              return (
                <li key={a.id}>
                  <Card className="px-5 py-4 transition-colors hover:border-gray-300 dark:hover:border-gray-700">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/admin/cycles/${a.cycleId}/archive`}
                        className="text-base font-bold text-gray-900 hover:text-indigo-700 hover:underline dark:text-white dark:hover:text-indigo-300"
                      >
                        {a.cycleName}
                      </Link>
                      {!cycle && (
                        <Pill tone="neutral">cycle deleted — this record is what remains</Pill>
                      )}
                      <span className="ml-auto text-xs tabular-nums text-gray-600 dark:text-gray-400">
                        closed {day(a.closedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-gray-600 dark:text-gray-400">
                      {totals.members !== null && (
                        <>
                          {totals.members} member{totals.members === 1 ? "" : "s"}
                          {" · "}
                        </>
                      )}
                      {totals.received !== null ? (
                        <>
                          {formatMoney(totals.received)} in · {formatMoney(totals.paidOut ?? 0)} out
                        </>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">
                          the snapshot could not be read — open it to see what is there
                        </span>
                      )}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {closedWithoutArchive.length > 0 && (
        <Card tone="danger" className="px-5 py-4 animate-fade-in-up-3">
          <p className="text-sm text-red-900 dark:text-red-200">
            {closedWithoutArchive.length} closed cycle
            {closedWithoutArchive.length === 1 ? " has" : "s have"} no written record:{" "}
            {closedWithoutArchive.map((c) => c.name).join(", ")}. Closing writes one, so this means
            a cycle&rsquo;s status was changed some other way. The money is still in the database;
            the readable record 2.9 promises is not.
          </p>
        </Card>
      )}
    </main>
  );
}
