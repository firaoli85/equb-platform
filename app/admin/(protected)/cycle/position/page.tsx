import Link from "next/link";
import { getCyclePosition } from "@/app/actions/cycle-position";
import { CashReadingPanel } from "./cash-reading-panel";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateUTC, formatMoney } from "@/lib/format";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";

export const dynamic = "force-dynamic";

// THE CYCLE POSITION — the number the organizer has calculated by hand for
// six years. Replaces the old /admin/cycle/weeks, whose only purpose was
// skipping weeks: there are no skipped weeks in an Equb, every week is a
// commitment.
//
// "Am I in negative, am I using someone else's money, or am I on track."
//
// Every figure is derived (2.14) and drills down to who makes it up. The one
// stored fact on the page is the cash reading he enters himself.

export default async function CyclePositionPage() {
  const result = await getCyclePosition();
  if (!result.ok) {
    if (result.error === PRESENTATION_HIDDEN) {
      return <PresentationHidden what="The cycle position" />;
    }
    return (
      <main>
        <p className="text-sm text-red-800 dark:text-red-400">{result.error}</p>
      </main>
    );
  }
  const d = result.data;
  const c = d.collection;
  const h = d.holding;

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin/cycle" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Cycle
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Where this cycle stands
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {d.cycleName} · week {d.currentWeek} of {d.plannedWeeks}
        </p>
      </header>

      {/* THE SENTENCE FIRST — the same register as the dashboard's cash line. */}
      <p className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-5 py-4 text-base font-bold leading-snug text-indigo-950 dark:text-indigo-100 animate-fade-in-up-1">
        {d.collectionSentence}
      </p>

      {/* ————— Collection: should vs actual ————— */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 animate-fade-in-up-1">
        <StatCard
          label="Should have come in"
          cents={c.shouldHaveCollected}
          sub={`every week through week ${c.elapsedThroughWeek}`}
        />
        <StatCard
          label="Actually collected"
          cents={c.collected}
          sub="for those same weeks"
          emphasis
        />
        <StatCard
          label="Outstanding"
          cents={c.shortfall}
          sub={
            c.shortfall === 0
              ? "nothing is owed for elapsed weeks"
              : `${c.owedBy.length} member${c.owedBy.length === 1 ? "" : "s"} owe it`
          }
          emphasis={c.shortfall > 0}
        />
      </div>

      {/* ————— PAID AHEAD — the piece he could not see ————— */}
      <Card className="animate-fade-in-up-2">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Paid ahead
              <Pill tone={c.paidAhead > 0 ? "attention" : "neutral"}>owed forward, not collected</Pill>
            </span>
          }
          sub="Money received for weeks that have NOT happened yet. It is in your hands, but it belongs to those weeks — spending it is spending someone else's money."
        />
        <div className="px-5 pb-4">
          <p className="text-2xl font-black tabular-nums text-gray-900 dark:text-white">
            {formatMoney(c.paidAhead)}
          </p>
          {c.aheadBy.length === 0 ? (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Nobody has paid ahead. Everything received belongs to weeks that have happened.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
              {c.aheadBy.map((m) => (
                <li key={m.participationId} className="flex items-center gap-3 py-2 text-sm">
                  <Link
                    href={`/admin/participations/${m.participationId}`}
                    className="font-semibold text-gray-900 dark:text-white hover:underline"
                  >
                    {m.name}
                  </Link>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {m.weeks} week{m.weeks === 1 ? "" : "s"} ahead
                  </span>
                  <span className="ml-auto tabular-nums text-gray-800 dark:text-gray-200">
                    {formatMoney(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* ————— Who makes up the shortfall ————— */}
      {c.owedBy.length > 0 && (
        <Card className="animate-fade-in-up-2">
          <CardHeader
            title="Who the outstanding money is with"
            sub="Elapsed weeks only — money whose payment window has closed unpaid. Not what is still to save."
          />
          <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
            {c.owedBy.map((m) => (
              <li key={m.participationId} className="flex items-center gap-3 px-5 py-2 text-sm">
                <Link
                  href={`/admin/participations/${m.participationId}`}
                  className="font-semibold text-gray-900 dark:text-white hover:underline"
                >
                  {m.name}
                </Link>
                <span className="ml-auto tabular-nums text-gray-800 dark:text-gray-200">
                  {formatMoney(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ————— What he SHOULD be holding, decomposed ————— */}
      <Card className="animate-fade-in-up-2">
        <CardHeader
          title="What you should be holding"
          sub="Received minus paid out — and what of it is actually yours. A positive balance may simply be your fee accumulating rather than slack."
        />
        <div className="px-5 pb-4">
          <p className="text-3xl font-black tabular-nums text-gray-900 dark:text-white">
            {formatMoney(h.expected)}
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Owed forward (paid ahead)" cents={h.owedForward} tone="warn" note="not yours to spend" />
            <Row
              label="Committed to pending payouts"
              cents={h.committedToPayouts}
              tone="warn"
              note="already promised to winners drawn"
            />
            <Row label="Your fee, earned" cents={h.feeEarned} tone="good" note="genuinely yours" />
            <Row
              label="Uncommitted"
              cents={h.uncommitted}
              tone={h.uncommitted < 0 ? "bad" : "neutral"}
              note={
                h.uncommitted < 0
                  ? "NEGATIVE — you are holding less than you owe"
                  : "free after everything above"
              }
            />
          </dl>
          {h.feeCommitted > 0 && (
            <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
              A further {formatMoney(h.feeCommitted)} of fee is committed on payouts drawn but not
              yet collected — yours once they are handed over.
            </p>
          )}
        </div>
      </Card>

      {/* ————— What he ACTUALLY holds, and the verdict ————— */}
      <div className="animate-fade-in-up-2">
        <CashReadingPanel
          expected={h.expected}
          verdict={d.verdict}
          latest={
            d.latestReading
              ? {
                  totalAmount: d.latestReading.totalAmount,
                  readAt: d.latestReading.readAt.toISOString(),
                }
              : null
          }
          readings={d.readings.map((r) => ({
            id: r.id,
            readAt: r.readAt.toISOString(),
            totalAmount: r.totalAmount,
            bankAmount: r.bankAmount,
            cashAmount: r.cashAmount,
            note: r.note,
            differenceVsExpectedToday: r.differenceVsExpectedToday,
          }))}
        />
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Every figure above except your entered reading is derived from the money already
        recorded — nothing here is stored, so it can never drift from the dashboard
        {c.elapsedThroughWeek > 0 && ` or from week ${c.elapsedThroughWeek}'s own records`}.
      </p>
    </main>
  );
}

function Row({
  label,
  cents,
  note,
  tone,
}: {
  label: string;
  cents: number;
  note: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const colour =
    tone === "bad"
      ? "text-red-800 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-800 dark:text-amber-400"
        : tone === "good"
          ? "text-emerald-800 dark:text-emerald-400"
          : "text-gray-900 dark:text-white";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 border-b border-gray-100 dark:border-gray-800/60 pb-1.5 last:border-b-0">
      <dt className="font-semibold text-gray-800 dark:text-gray-200">{label}</dt>
      <dd className={`ml-auto tabular-nums font-bold ${colour}`}>{formatMoney(cents)}</dd>
      <span className="basis-full text-xs text-gray-500 dark:text-gray-400">{note}</span>
    </div>
  );
}
