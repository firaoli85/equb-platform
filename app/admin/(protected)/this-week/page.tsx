import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { WeekPicker } from "@/components/admin/week-picker";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, EmptyState, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/status-labels";

export const dynamic = "force-dynamic";

// Drill-down: this week's payments — who has paid and who has not. The
// groups use THE shared status vocabulary, so "deferred" means the same
// thing here as on the grid, the members list and the member's own page.
const GROUPS = [
  // FIRST, because it is the only group here the organizer put someone in by
  // hand (2.2). The current week's window is still open, so the calendar
  // cannot produce a LATE on this screen — every name in this group is one he
  // marked, and burying it under "have not paid" would hide his own decision
  // from him.
  { key: "LATE", title: "Marked late" },
  { key: "UNPAID", title: "Have not paid" },
  { key: "PARTIAL", title: "Partially paid" },
  { key: "PAID", title: "Paid" },
  { key: "DEFERRED", title: STATUS_LABELS.DEFERRED.text },
  { key: "SKIPPED", title: STATUS_LABELS.SKIPPED.text },
] as const;

export default async function ThisWeekBreakdownPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // The chosen week rides in the URL, so the answer stays server-derived and
  // the page can be reloaded or shared. An unparseable value is simply absent
  // and the current week answers, which is the default anyway.
  const { week } = await searchParams;
  const requested = Number.parseInt(week ?? "", 10);
  const result = await getDashboard(
    Number.isSafeInteger(requested) ? { weekNumber: requested } : undefined,
  );
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-red-800 dark:text-red-400">{result.error}</p>
      </main>
    );
  }
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="This week" />;

  const members = (key: string) => d.selectedWeekMembers.filter((m) => m.status === key);
  const isCurrent = d.selectedWeek === d.currentWeek;
  const totals = d.selectedWeekTotals;

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Dashboard
          </Link>
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
              Week {d.selectedWeek}
              {!isCurrent && (
                <span className="ml-2 align-middle text-sm font-semibold text-gray-500 dark:text-gray-400">
                  (this week is {d.currentWeek})
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {isCurrent
                ? "Who has paid for this week and who has not."
                : `Who had paid for week ${d.selectedWeek} and who had not.`}
            </p>
          </div>
          {/* Any week, not only the current one. Everything else on this page
              is unchanged — this is an addition, not a redesign. */}
          <WeekPicker
            weeks={d.selectableWeeks.map((w) => ({
              weekNumber: w.weekNumber,
              date: w.date.toISOString(),
            }))}
            selected={d.selectedWeek}
            currentWeek={d.currentWeek}
          />
        </div>
      </header>

      {totals && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Expected"
            cents={totals.expected}
            sub="from members in their window"
          />
          <StatCard
            label="Received"
            cents={totals.received}
            sub={`${totals.membersPaid} of ${totals.membersExpected} members paid`}
            emphasis
            delayClass="animate-fade-in-up-1"
          />
          <StatCard
            label="Short"
            cents={Math.max(0, totals.expected - totals.received)}
            sub={
              totals.expected <= totals.received
                ? "the week is fully collected"
                : isCurrent
                  ? "still to come in for this week"
                  : "never came in for that week"
            }
            emphasis={totals.expected > totals.received}
            delayClass="animate-fade-in-up-2"
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 animate-fade-in-up-2">
        {GROUPS.map(({ key, title }) => {
          const list = members(key);
          // SKIPPED is rare — an empty "Skipped" card every week would read
          // as a missing feature rather than a deliberate state.
          if (key === "SKIPPED" && list.length === 0) return null;
          return (
            <Card key={key}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {title}
                    <span className="rounded-md bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-gray-700 dark:text-gray-300">
                      {list.length}
                    </span>
                  </span>
                }
                sub={
                  key === "DEFERRED"
                    ? STATUS_LABELS.DEFERRED.meaning
                    : key === "SKIPPED"
                      ? STATUS_LABELS.SKIPPED.meaning
                      : undefined
                }
              />
              {list.length === 0 ? (
                <p className="px-5 pb-4 text-sm text-gray-600 dark:text-gray-400">Nobody.</p>
              ) : (
                <ul className="border-t border-gray-100 dark:border-gray-800/60">
                  {list.map((m) => (
                    <li
                      key={m.participationId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 dark:border-gray-800/60 px-5 py-2.5 last:border-b-0"
                    >
                      <Link
                        href={`/admin/participations/${m.participationId}`}
                        className="text-sm font-semibold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                      >
                        {m.name}
                      </Link>
                      {key === "DEFERRED" && <Pill tone="attention">not chased, still owed</Pill>}
                      <span className="ml-auto text-sm tabular-nums text-gray-700 dark:text-gray-300">
                        {formatMoney(m.amountPaid)}{" "}
                        <span className="text-gray-500 dark:text-gray-400">
                          of {formatMoney(m.weeklyAmount)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {d.selectedWeekMembers.length === 0 && (
        <EmptyState
          title="Nobody is in their window this week."
          hint="Members appear here from the week they join until the week they finish."
        />
      )}
    </main>
  );
}
