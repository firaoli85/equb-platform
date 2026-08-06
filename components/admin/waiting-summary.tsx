import Link from "next/link";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import type { WaitingData } from "@/app/actions/waiting";
import { mostUrgent, runwayLabel, waitedLabel } from "@/lib/waiting";

// The dashboard's window onto WHO IS WAITING (2.1): both totals, the most
// urgent few of each group, and a way through to the full lists. Server
// component — nothing here is interactive, so nothing ships to the client.

export function WaitingSummary({ data }: { data: WaitingData }) {
  const t = data.totals;
  const urgent = mostUrgent({
    awaitingPayment: data.awaitingPayment,
    awaitingTurn: data.awaitingTurn,
    limit: 3,
  });
  const nothing = t.owedNowCount === 0 && t.eventualCount === 0;

  return (
    <Card className="animate-fade-in-up-3">
      <CardHeader
        title={
          <Link href="/admin/waiting" className="hover:underline">
            Who is waiting
          </Link>
        }
        sub="What the group owes its members"
        right={
          <Link
            href="/admin/waiting"
            className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
          >
            See everyone →
          </Link>
        }
      />

      <div className="grid gap-px border-y border-gray-200 dark:border-gray-800 bg-gray-200 dark:bg-gray-800 sm:grid-cols-2">
        {/* Owed NOW — the committed money. */}
        <div className="bg-white dark:bg-[#141414] px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Awaiting payment
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums leading-none text-gray-900 dark:text-white">
            {formatMoney(t.owedNow)}
          </p>
          <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
            {t.owedNowCount === 0
              ? "nobody is waiting to be paid"
              : `${t.owedNowCount} drawn payout${t.owedNowCount === 1 ? "" : "s"} owed now` +
                (t.longestWaitDays !== null ? ` · longest ${waitedLabel(t.longestWaitDays)}` : "")}
          </p>
          {urgent.awaitingPayment.length === 0 ? (
            // An empty half must read as deliberate, not as a panel that
            // failed to load — and it must not leave the card lopsided.
            <p className="mt-3 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 px-3 py-4 text-xs text-gray-500 dark:text-gray-400">
              Every drawn payout has been handed over. New ones appear here the moment a week is
              drawn.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {urgent.awaitingPayment.map((r) => (
                <li
                  key={r.payoutId}
                  className="flex items-baseline gap-2 text-sm text-gray-800 dark:text-gray-200"
                >
                  <Link
                    href={`/admin/people/${r.personId}`}
                    className="truncate font-semibold hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                    #{r.number}
                    {r.weekNumber !== null ? ` · wk ${r.weekNumber}` : ""} ·{" "}
                    {waitedLabel(r.daysWaiting)}
                  </span>
                  <span className="ml-auto font-bold tabular-nums">
                    {formatMoney(r.netAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Awaiting their turn — not owed yet, but it will be. */}
        <div className="bg-white dark:bg-[#141414] px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Awaiting their turn
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums leading-none text-gray-900 dark:text-white">
            {t.eventualCount}
            <span className="ml-2 text-sm font-bold text-gray-600 dark:text-gray-400">
              {t.eventualCount === 1 ? "member" : "members"}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
            {t.eventualCount === 0
              ? "everyone has been drawn"
              : `will eventually receive ${formatMoney(t.eventualTotal)}`}
            {t.atRiskCount > 0 ? ` · ${t.atRiskCount} at risk` : ""}
          </p>
          {urgent.awaitingTurn.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {urgent.awaitingTurn.map((r) => (
                <li
                  key={r.participationId}
                  className="flex items-baseline gap-2 text-sm text-gray-800 dark:text-gray-200"
                >
                  <Link
                    href={`/admin/people/${r.personId}`}
                    className="truncate font-semibold hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                  >
                    {r.name}
                  </Link>
                  {r.atRisk ? (
                    <Pill tone="attention">{runwayLabel(r.weeksLeft)}</Pill>
                  ) : (
                    <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {runwayLabel(r.weeksLeft)}
                    </span>
                  )}
                  <span className="ml-auto font-bold tabular-nums">
                    {formatMoney(r.netAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="px-5 py-3 text-xs text-gray-600 dark:text-gray-400 text-pretty">
        {nothing
          ? "Nobody is waiting — every number has been drawn and every payout collected."
          : t.atRiskCount > 0
            ? `${t.atRiskCount} member${t.atRiskCount === 1 ? "" : "s"} could finish paying in without ever being drawn (2.27). They are first in the full list.`
            : "The two figures are separate on purpose: one is owed today, the other will be owed later."}
      </p>
    </Card>
  );
}
