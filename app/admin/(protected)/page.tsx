import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { getWaiting } from "@/app/actions/waiting";
import { WaitingSummary } from "@/components/admin/waiting-summary";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { CollectedVsExpectedChart } from "@/components/charts/collected-vs-expected-chart";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";
import { InitialAvatar } from "@/components/ui/initial-avatar";

export const dynamic = "force-dynamic";

// The Financial Command Center (2.1): the complete state of the organizer's
// financial world, in front of him, without hunting. The wheel is a tool
// inside the platform — this page is the platform.
export default async function CommandCenterPage() {
  // Both reads in parallel — the obligations section is part of the command
  // center (2.1), not a page the organizer has to go looking for.
  const [result, waiting] = await Promise.all([getDashboard(), getWaiting()]);

  if (!result.ok) {
    return (
      <main>
        <h1 className="mb-2 text-xl font-black text-gray-900 dark:text-white">Command center</h1>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {result.error}{" "}
          {result.error === "No active cycle." && (
            <Link href="/admin/cycles/new" className="font-semibold text-indigo-700 dark:text-indigo-300 underline">
              Start a cycle
            </Link>
          )}
        </p>
      </main>
    );
  }
  const d = result.data;

  // Presentation mode (2.4): the server sent no money and no names — render
  // the cycle's shape, the 2.27 warnings (numbers only), and calm notices
  // where the figures usually live.
  if (d.presentation) {
    return (
      <main className="space-y-6">
        <header className="animate-fade-in-up">
          <h1 className="text-xl font-black text-gray-900 dark:text-white">{d.cycle.name}</h1>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            {d.currentWeek === 0
              ? "Not started yet"
              : `Week ${d.currentWeek} of ${d.cycle.plannedWeeks}${d.currentWeek > d.cycle.plannedWeeks ? " (past planned)" : ""}`}
            {" · "}
            {d.weeksRemaining} week{d.weeksRemaining === 1 ? "" : "s"} remaining · {d.memberCount}{" "}
            members · {d.drawsCount} week{d.drawsCount === 1 ? "" : "s"} drawn
            {d.window &&
              ` · payment window ${
                d.window.daysLeft > 0
                  ? `closes ${d.window.lastOpenDayName} — ${d.window.daysLeft} day${d.window.daysLeft === 1 ? "" : "s"} left`
                  : `closed (${d.window.lastOpenDayName} was the last day)`
              }`}
          </p>
        </header>

        {d.undrawnWarnings.length > 0 && (
          <Card tone="danger" className="animate-fade-in-up-1 px-5 py-4">
            <h2 className="mb-1 text-sm font-bold text-red-900 dark:text-red-300">
              Windows ending undrawn (2.27)
            </h2>
            <ul className="space-y-0.5 text-sm text-red-900 dark:text-red-300">
              {d.undrawnWarnings.map((w) => (
                <li key={w.participationId}>
                  <Link href="/admin/wheel/setup" className="font-bold underline">
                    {w.name}
                  </Link>{" "}
                  — window ends week {w.finishWeek}
                  {w.weeksLeft > 0
                    ? ` (${w.weeksLeft} week${w.weeksLeft === 1 ? "" : "s"} left)`
                    : " (ALREADY CLOSING)"}{" "}
                  and they have not been drawn.
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="animate-fade-in-up-2 px-5 py-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Cash position</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Hidden in presentation mode.</p>
        </Card>
        <Card className="animate-fade-in-up-3 px-5 py-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Members and payments</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Hidden in presentation mode. The{" "}
            <Link href="/admin/payments" className="font-semibold text-indigo-700 dark:text-indigo-300 underline">
              payments grid
            </Link>{" "}
            still shows week-by-number status, and the{" "}
            <Link href="/admin/wheel/setup" className="font-semibold text-indigo-700 dark:text-indigo-300 underline">
              wheel setup
            </Link>{" "}
            is ready for the draw.
          </p>
        </Card>
      </main>
    );
  }

  const needsYouEmpty =
    d.attention.length === 0 &&
    d.issues.length === 0 &&
    d.pendingPayouts.length === 0 &&
    d.closedShortfalls.length === 0 &&
    d.stopped.length === 0 &&
    d.lockedMembers.length === 0 &&
    // 2.27 warnings render INSIDE this card — omitted from the test, a red
    // "windows ending undrawn" box stacked straight on top of "Nothing —
    // every member is current".
    d.undrawnWarnings.length === 0;

  return (
    <main className="space-y-6">
      {/* ————— Top line ————— */}
      <header className="animate-fade-in-up">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">{d.cycle.name}</h1>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          {d.currentWeek === 0
            ? "Not started yet"
            : `Week ${d.currentWeek} of ${d.cycle.plannedWeeks}${d.currentWeek > d.cycle.plannedWeeks ? " (past planned)" : ""}`}
          {" · "}
          {d.weeksRemaining} week{d.weeksRemaining === 1 ? "" : "s"} remaining · {d.memberCount}{" "}
          members
          {d.window &&
            ` · payment window ${
              d.window.daysLeft > 0
                ? `closes ${d.window.lastOpenDayName} — ${d.window.daysLeft} day${d.window.daysLeft === 1 ? "" : "s"} left`
                : `closed (${d.window.lastOpenDayName} was the last day)`
            }`}
        </p>
      </header>

      {/* ————— Cash position — the hero (2.1) ————— */}
      <section aria-label="Cash position">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Received to date"
            cents={d.position.totalReceived}
            sub="Everyone's contributions, added up"
            href="/admin/cash?view=received"
            emphasis
          />
          <StatCard
            label="Paid out to date"
            cents={d.position.totalPaidOut}
            sub="Who received it and when"
            href="/admin/cash?view=paid-out"
            emphasis
            delayClass="animate-fade-in-up-1"
          />
          <StatCard
            label="Currently held"
            cents={d.position.currentlyHeld}
            sub="What is promised, and what is not"
            href="/admin/cash?view=held"
            emphasis
            delayClass="animate-fade-in-up-2"
          />
        </div>
        {/* The plain-English truth sentence */}
        <p className="mt-3 px-1 text-sm text-gray-700 dark:text-gray-300 animate-fade-in-up-2">
          {d.drawsCount} week{d.drawsCount === 1 ? "" : "s"} drawn, {d.paidOutCount} paid out.{" "}
          {d.position.pendingPayoutCount > 0 ? (
            <>
              <Link href="/admin/cash?view=held" className="font-bold text-gray-900 dark:text-white underline decoration-indigo-400 tabular-nums">
                {formatMoney(d.position.committedPending)}
              </Link>{" "}
              is promised to {d.position.pendingPayoutCount}{" "}
              {d.position.pendingPayoutCount === 1 ? "winner" : "winners"} who{" "}
              {d.position.pendingPayoutCount === 1 ? "has" : "have"} not been handed it yet.{" "}
              <strong className="tabular-nums">{formatMoney(d.position.uncommitted)}</strong> is not
              promised to anyone.
            </>
          ) : (
            <>Nobody is waiting — every payout that has been drawn is already handed out.</>
          )}
        </p>
      </section>

      {/* ————— Who is waiting — the money the group OWES (2.1) ————— */}
      {waiting.ok && <WaitingSummary data={waiting.data} />}

      {/* ————— This week ————— */}
      <Card className="animate-fade-in-up-2">
        <CardHeader
          title={
            <Link href="/admin/this-week" className="inline-flex min-h-11 md:min-h-8 items-center hover:underline">
              This week
            </Link>
          }
          right={
            d.thisWeek && (
              <Pill tone={d.thisWeek.shortfall > 0 ? "attention" : "good"}>
                {d.thisWeek.membersPaid} of {d.thisWeek.membersExpected} paid
              </Pill>
            )
          }
        />
        <div className="px-5 pb-4">
          {d.thisWeek ? (
            <p className="text-sm text-gray-700 dark:text-gray-300 tabular-nums">
              Expected {formatMoney(d.thisWeek.expected)} · received{" "}
              <strong className="text-gray-900 dark:text-white">
                {formatMoney(d.thisWeek.received)}
              </strong>
              {d.thisWeek.shortfall > 0 && <> · short {formatMoney(d.thisWeek.shortfall)}</>}
              {d.thisWeek.membersExpected - d.thisWeek.membersPaid > 0 &&
                ` — ${d.thisWeek.membersExpected - d.thisWeek.membersPaid} have not paid`}
              .
            </p>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              The calendar is outside the cycle's weeks.
            </p>
          )}
        </div>
      </Card>

      {/* ————— Needs you — scannable action rows ————— */}
      <Card className="animate-fade-in-up-3">
        <CardHeader title="Needs you" />
        <div className="px-2 pb-3">
          {d.undrawnWarnings.length > 0 && (
            <div className="mx-3 mb-3 rounded-xl border-2 border-red-500 bg-red-50 dark:border-red-800 dark:bg-red-950/30 px-4 py-3 text-sm text-red-900 dark:text-red-300">
              <h3 className="mb-1 font-bold">Windows ending undrawn (2.27)</h3>
              <ul className="space-y-0.5">
                {d.undrawnWarnings.map((w) => (
                  <li key={w.participationId}>
                    <Link href="/admin/wheel/setup" className="font-bold underline">
                      {w.name}
                    </Link>{" "}
                    — window ends week {w.finishWeek}
                    {w.weeksLeft > 0
                      ? ` (${w.weeksLeft} week${w.weeksLeft === 1 ? "" : "s"} left)`
                      : " (ALREADY CLOSING)"}{" "}
                    and they have not been drawn.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {needsYouEmpty ? (
            <p className="px-3 pb-2 text-sm text-gray-600 dark:text-gray-400">
              Nothing — every member is current and every drawn payout is settled.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800/60">
              {d.lockedMembers.map((m) => (
                <li key={`locked-${m.personId}`}>
                  <Link
                    href={`/admin/people/${m.personId}`}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
                    <InitialAvatar name={m.name} size="sm" />
                    <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {m.name}
                    </span>
                    <Pill tone="problem">PIN locked · {m.minutesLeft} min left — unlock?</Pill>
                    <svg className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              ))}
              {d.attention.map((m) => (
                <li key={m.participationId}>
                  <Link
                    href={`/admin/participations/${m.participationId}`}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
                    <InitialAvatar name={m.name} size="sm" />
                    <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {m.name}
                    </span>
                    <Pill tone="attention">
                      {m.weeksBehind} behind · {formatMoney(m.amountOwed)} owed
                    </Pill>
                    <svg className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              ))}
              {/* NOT MONEY-LATE, STILL WAITING ON SOMEBODY: welcomed and
                  unsigned (waiting on the member), or never paid a cent
                  (waiting on the organizer — either to chase the first
                  payment or to record one that arrived off the books). The
                  pill says which, because the next move is different. */}
              {d.issues.map((m) => (
                <li key={`issue-${m.participationId}`}>
                  <Link
                    href={`/admin/people/${m.personId}`}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
                    <InitialAvatar name={m.name} size="sm" />
                    <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {m.name}
                    </span>
                    <Pill tone="attention">
                      {m.kind === "unsigned"
                        ? `agreement not signed${m.daysWaiting !== null ? ` · ${m.daysWaiting}d` : ""}`
                        : `no payment yet · ${formatMoney(m.commitment)} committed`}
                    </Pill>
                    <svg className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              ))}
              {/* MEMBERS WHO HAVE STOPPED — listed after the ones who are
                  behind, and never mixed into them. Behind means the money is
                  late; stopped means it is not coming. They read as the same
                  row until you say which is which. */}
              {d.stopped.map((m) => (
                <li key={`stopped-${m.participationId}`}>
                  <Link
                    href={`/admin/people/${m.personId}`}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
                    <InitialAvatar name={m.name} size="sm" />
                    <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {m.name}
                      <span className="ml-1.5 font-normal text-gray-600 dark:text-gray-400">
                        stopped at week {m.closedAtWeek}
                      </span>
                    </span>
                    <Pill tone={m.shortfallToCover > 0 ? "problem" : "neutral"}>
                      {m.shortfallToCover > 0
                        ? `${formatMoney(m.shortfallToCover)} for you to cover`
                        : "not coming back this cycle"}
                    </Pill>
                    <svg className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              ))}
              {d.pendingPayouts.map((p) => (
                <li key={p.id}>
                  <Link
                    href="/admin/collections"
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
                    <InitialAvatar name={p.who} size="sm" />
                    <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {p.who}
                      {p.weekNumber !== null && (
                        <span className="ml-1.5 font-normal text-gray-600 dark:text-gray-400">
                          won week {p.weekNumber}
                        </span>
                      )}
                    </span>
                    <Pill tone="accent">{formatMoney(p.netAmount)} pending</Pill>
                    <svg className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              ))}
              {d.closedShortfalls.map((w) => (
                <li key={w.weekNumber}>
                  <Link
                    href="/admin/cycle/position"
                    className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
                    <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">
                      {/* "overdue", not "outstanding" — one word per concept
                          (UI_STANDARDS rule 8). This week's window has closed
                          unpaid, which is exactly what overdue means
                          everywhere else on the platform. */}
                      Week {w.weekNumber} closed with money overdue
                    </span>
                    <Pill tone="problem">{formatMoney(w.shortfall)} overdue</Pill>
                    <svg className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ————— Collected vs expected (ADMIN_IA §5.1) —————

          This replaced a 20-row list of CSS bars. The list was honest but it
          could not carry the one thing that makes the figure safe to read: the
          divider between weeks whose window has CLOSED and weeks still
          collecting. Without it the current week reads as a shortfall every
          single time, which is the false alarm the stored-week-date rule
          exists to prevent. */}
      <CollectedVsExpectedChart weeks={d.series} className="animate-fade-in-up-4" />
    </main>
  );
}
