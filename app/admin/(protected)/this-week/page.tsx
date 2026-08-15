import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { WeekPicker } from "@/components/admin/week-picker";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, EmptyState, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/status-labels";
import { InitialAvatar } from "@/components/ui/initial-avatar";

export const dynamic = "force-dynamic";

// Drill-down: this week's payments — who has paid and who has not. The
// groups use THE shared status vocabulary, so "deferred" means the same
// thing here as on the grid, the members list and the member's own page.
// THE SECTIONS ARE THE DERIVED STATUSES. Nothing here re-decides one.
//
// THE DEFECT, from live use. Week 12's window closed on 7 August; on the 13th
// this screen said "Marked late 0 — Nobody" and listed all seven unpaid
// members under "Have not paid". They were LATE. The heading said "Marked
// late", so the section counted only the organizer's own mark — and the
// comment that stood here asserted the calendar could not produce a LATE on
// this screen, which was simply false: the week SELECTOR shows any week, and
// most of them have closed.
//
// A MARK IS ONE ROUTE TO LATE, NOT A CATEGORY BESIDE IT. The row says how it
// became late; the section says only that it is.
const GROUPS = [
  // Late first — the only group that needs acting on.
  { key: "LATE", title: STATUS_LABELS.LATE.text },
  // "Have not paid yet" — the WINDOW IS STILL OPEN. The old title was "Have
  // not paid", which reads as a verdict and is exactly how seven late members
  // sat under it without looking wrong.
  { key: "UNPAID", title: "Have not paid yet" },
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

      {/* THE ANSWER BEFORE THE BREAKDOWN. This used to render BELOW the six
          cards, so a week with nobody in it said "Nobody." six times and then
          explained why. It states the reason first, and the buckets below it
          are then simply absent rather than six denials. */}
      {d.selectedWeekMembers.length === 0 && (
        <EmptyState
          title="Nobody is in their window this week."
          hint="Members appear here from the week they join until the week they finish."
        />
      )}

      {/* SPACE GOES TO THE BUCKETS THAT HAVE PEOPLE IN THEM.
          Every group used to get a full card whether or not anyone was in it,
          so a normal week — nobody partially paid, nobody unpaid — spent two
          tall boxes saying "Nobody." twice. Partially paid happens perhaps
          five times in a cycle and was costing a permanent panel.

          The empty ones are NOT dropped: dropping a bucket makes the reader
          wonder whether it was checked. They collapse to one line below,
          which is the honest size of "nothing here". */}
      <div className="grid items-start gap-4 md:grid-cols-2 animate-fade-in-up-2">
        {GROUPS.filter(({ key }) => members(key).length > 0).map(({ key, title }) => {
          const list = members(key);
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
                      : // The two that were being confused. Saying what each
                        // means is what stops "have not paid" reading as a
                        // verdict on a week that is still open.
                        key === "LATE"
                        ? STATUS_LABELS.LATE.meaning
                        : key === "UNPAID"
                          ? "the payment window for this week is still open"
                          : undefined
                }
              />
              <ul className="border-t border-gray-100 dark:border-gray-800/60">
                  {list.map((m) => (
                    <li
                      key={m.participationId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 dark:border-gray-800/60 px-5 py-2.5 last:border-b-0"
                    >
                      {/* The same disc as every other member list, so a face
                          found on the directory is found here too. */}
                      <InitialAvatar name={m.name} size="sm" />
                      <Link
                        href={`/admin/participations/${m.participationId}`}
                        className="text-sm font-semibold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                      >
                        {m.name}
                      </Link>
                      {key === "DEFERRED" && <Pill tone="attention">not chased, still owed</Pill>}
                      {/* HOW it became late, not a separate section. Without
                          this the organizer cannot tell his own decision from
                          the calendar's — with it, he never has to look in two
                          places for late members. */}
                      {m.markedLate && <Pill tone="attention">you marked this</Pill>}
                      <span className="ml-auto text-sm tabular-nums text-gray-700 dark:text-gray-300">
                        {formatMoney(m.amountPaid)}{" "}
                        <span className="text-gray-500 dark:text-gray-400">
                          of {formatMoney(m.weeklyAmount)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
            </Card>
          );
        })}
      </div>

      {/* THE EMPTY BUCKETS, IN ONE LINE. Named so the reader knows they were
          checked, sized so they cost nothing. */}
      {d.selectedWeekMembers.length > 0 && GROUPS.some(({ key }) => members(key).length === 0) && (
        <EmptyState
          variant="dashed"
          title={`Nobody this week in ${GROUPS.filter(({ key }) => members(key).length === 0)
            .map(({ title }) => title.toLowerCase())
            .join(" · ")}.`}
        />
      )}

    </main>
  );
}
