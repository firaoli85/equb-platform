import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { getWaiting } from "@/app/actions/waiting";
import { WaitingSummary } from "@/components/admin/waiting-summary";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatMoney } from "@/lib/format";

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

  const maxWeekly = Math.max(1, ...d.series.map((w) => Math.max(w.expected, w.received)));
  const needsYouEmpty =
    d.attention.length === 0 &&
    d.pendingPayouts.length === 0 &&
    d.closedShortfalls.length === 0 &&
    d.lockedMembers.length === 0;

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
            sub="By week and by member"
            href="/admin/received"
            emphasis
          />
          <StatCard
            label="Paid out to date"
            cents={d.position.totalPaidOut}
            sub="Who received it and when"
            href="/admin/paid-out"
            emphasis
            delayClass="animate-fade-in-up-1"
          />
          <StatCard
            label="Currently held"
            cents={d.position.currentlyHeld}
            sub="Committed vs uncommitted"
            href="/admin/held"
            emphasis
            delayClass="animate-fade-in-up-2"
          />
        </div>
        {/* The plain-English truth sentence */}
        <p className="mt-3 px-1 text-sm text-gray-700 dark:text-gray-300 animate-fade-in-up-2">
          {d.drawsCount} week{d.drawsCount === 1 ? "" : "s"} drawn, {d.paidOutCount} paid out.{" "}
          {d.position.pendingPayoutCount > 0 ? (
            <>
              <Link href="/admin/held" className="font-bold text-gray-900 dark:text-white underline decoration-indigo-400 tabular-nums">
                {formatMoney(d.position.committedPending)}
              </Link>{" "}
              is already owed to {d.position.pendingPayoutCount} pending payout
              {d.position.pendingPayoutCount === 1 ? "" : "s"}.{" "}
              <strong className="tabular-nums">{formatMoney(d.position.uncommitted)}</strong> is
              uncommitted.
            </>
          ) : (
            <>Nothing is pending — every drawn payout has been settled.</>
          )}
        </p>
      </section>

      {/* ————— Who is waiting — the money the group OWES (2.1) ————— */}
      {waiting.ok && <WaitingSummary data={waiting.data} />}

      {/* ————— This week ————— */}
      <Card className="animate-fade-in-up-2">
        <CardHeader
          title={
            <Link href="/admin/this-week" className="hover:underline">
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
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
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
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
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
              {d.pendingPayouts.map((p) => (
                <li key={p.id}>
                  <Link
                    href="/admin/collections"
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
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
                    href="/admin/cycle/weeks"
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                  >
                    <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white">
                      Week {w.weekNumber} closed with money outstanding
                    </span>
                    <Pill tone="problem">{formatMoney(w.shortfall)} outstanding</Pill>
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

      {/* ————— Received by week ————— */}
      <Card className="animate-fade-in-up-4">
        <CardHeader
          title="Received by week"
          sub="Track = expected (window-aware) · indigo = received"
        />
        <div className="space-y-1.5 px-5 pb-5 text-xs">
          {d.series.map((w) => (
            <div key={w.weekNumber} className="flex items-center gap-3">
              <span
                className={`w-6 text-right tabular-nums ${
                  w.weekNumber === d.currentWeek
                    ? "font-black text-indigo-700 dark:text-indigo-300"
                    : "text-gray-600 dark:text-gray-400"
                }`}
              >
                {w.weekNumber}
              </span>
              <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-indigo-200 dark:bg-indigo-900/60"
                  style={{ width: `${(w.expected / maxWeekly) * 100}%` }}
                  title={`expected ${formatMoney(w.expected)}`}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-indigo-600 dark:bg-indigo-400"
                  style={{ width: `${(w.received / maxWeekly) * 100}%` }}
                  title={`received ${formatMoney(w.received)}`}
                />
              </div>
              <span className="w-44 whitespace-nowrap text-right tabular-nums text-gray-600 dark:text-gray-400">
                {formatMoney(w.received)} / {formatMoney(w.expected)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}
