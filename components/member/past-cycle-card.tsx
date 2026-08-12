import type { PastCycle } from "@/lib/member-history";
import { formatMoney } from "@/lib/format";

// ONE FINISHED CYCLE, UNMISTAKEABLY FINISHED.
//
// Every signal on this card says "this is over": the dates are spelled out in
// full and sit directly under the name, the tense is past throughout, and
// there is no progress ring, no "next due", no week grid — nothing that any
// live screen also shows. A member glancing at it can tell in one second that
// it is not the cycle they are in.
//
// The figures are the frozen ones from the archive (2.9), so this and the
// organizer's copy of the same cycle read identically.

export function PastCycleCard({ cycle, className = "" }: { cycle: PastCycle; className?: string }) {
  const settled = cycle.outstanding === 0;

  return (
    <article
      className={`rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#141414] ${className}`}
    >
      <header className="border-b border-gray-100 px-5 py-4 dark:border-gray-800/60">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-base font-black tracking-tight text-gray-900 dark:text-white">
            {cycle.cycleName}
          </h3>
          <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:border-gray-700 dark:text-gray-400">
            Finished
          </span>
        </div>
        {/* Full dates, not week numbers. "Week 20" means nothing to someone
            reading this two years later. */}
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {cycle.startLabel} to {cycle.finishLabel}
        </p>
      </header>

      {cycle.unreadable ? (
        <p className="px-5 py-4 text-sm text-amber-900 dark:text-amber-300">{cycle.closing}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                You paid in
              </dt>
              <dd className="mt-0.5 text-xl font-black tabular-nums text-gray-900 dark:text-white">
                {formatMoney(cycle.totalPaid)}
              </dd>
              <dd className="text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                {cycle.weeksPaid} of {cycle.weeksCommitted} weeks
              </dd>
            </div>

            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                You received
              </dt>
              <dd className="mt-0.5 text-xl font-black tabular-nums text-gray-900 dark:text-white">
                {cycle.receivedNet > 0 ? formatMoney(cycle.receivedNet) : "—"}
              </dd>
              <dd className="text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                {/* The archive snapshot stores the cycle WEEK a number came
                    up, not its date — and a closed cycle's week 14 means
                    nothing to the person reading it, exactly as the note at
                    the top of this file says. So the fact is stated without
                    the coordinate; the card's own header carries the dates.
                    Putting a date here would need the archive to record one,
                    and a frozen archive is not rewritten for wording. */}
                {cycle.drawnWeek !== null
                  ? "your number came up"
                  : "your number was never drawn"}
              </dd>
            </div>
          </dl>

          {/* The closing balance, worded — never a bare figure. */}
          <p
            className={`mx-5 mb-5 rounded-xl border px-3.5 py-2.5 text-sm text-pretty ${
              settled
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            }`}
          >
            {settled ? (
              <>
                <strong className="font-bold">{cycle.closing}</strong>
                {cycle.pendingNet === 0 && " You owed nothing when this cycle ended."}
              </>
            ) : (
              cycle.closing
            )}
          </p>
        </>
      )}
    </article>
  );
}
