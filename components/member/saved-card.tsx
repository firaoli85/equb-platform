import { formatMoney } from "@/lib/format";
import type { Contribution } from "@/lib/contribution";

// THE headline of a member's own page (2.1): this is a SAVINGS group, and the
// number they care about most is what they have put in. It leads; the honest
// debt figures stay, below it, in their own words.
//
// Three figures, never conflated:
//   PAID IN        the big number — their money
//   STILL TO SAVE  the rest of the commitment. NOT a debt.
//   OVERDUE        only weeks whose window has closed. Shown only when real.

export function SavedCard({
  contribution: c,
  weeklyAmount,
  payoutNet,
  payoutReceived,
}: {
  contribution: Contribution;
  weeklyAmount: number;
  /** What their numbers pay out, net of the fee. */
  payoutNet: number;
  /** True once a payout has actually been collected. */
  payoutReceived: boolean;
}) {
  const pct = Math.round(c.progress * 100);

  return (
    <section
      className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#141414] px-5 py-5 shadow-sm animate-fade-in-up"
      aria-labelledby="saved-heading"
    >
      <h2
        id="saved-heading"
        className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400"
      >
        You have paid in
      </h2>

      <p className="mt-1 text-4xl font-black leading-none tracking-tight tabular-nums text-gray-900 dark:text-white">
        {formatMoney(c.paidIn)}
      </p>

      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 tabular-nums">
        {c.weeksCovered} of {c.weeksCommitted} weeks
        <span className="text-gray-600 dark:text-gray-400">
          {" "}
          at {formatMoney(weeklyAmount)} a week
        </span>
        {c.surplus > 0 && (
          <span className="text-emerald-700 dark:text-emerald-400">
            {" "}
            · {formatMoney(c.surplus)} ahead
          </span>
        )}
      </p>

      {/* Saved so far, against the whole commitment. */}
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
        role="img"
        aria-label={`${pct}% of your commitment saved`}
      >
        <div
          className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 dark:border-gray-800 pt-4">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Still to save
          </dt>
          <dd className="mt-0.5 text-lg font-black tabular-nums text-gray-900 dark:text-white">
            {formatMoney(c.stillToSave)}
          </dd>
          <dd className="text-[11px] text-gray-600 dark:text-gray-400">
            {/* The distinction that matters: this is the rest of the plan, not
                money anybody is chasing. */}
            {c.stillToSave === 0 ? "your whole commitment is saved" : "over the rest of your weeks"}
          </dd>
        </div>

        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Your payout
          </dt>
          <dd className="mt-0.5 text-lg font-black tabular-nums text-gray-900 dark:text-white">
            {formatMoney(payoutNet)}
          </dd>
          <dd className="text-[11px] text-gray-600 dark:text-gray-400">
            {payoutReceived ? "you have received it" : "when your number is drawn"}
          </dd>
        </div>
      </dl>

      {/* The honest debt figure — present when it is real, absent when it is
          not. A member who is current must never see a debt-shaped box. */}
      {c.overdue > 0 ? (
        <p className="mt-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-200">
          <strong className="tabular-nums">{formatMoney(c.overdue)} overdue</strong> — weeks that
          have closed without payment. Everything else above is still ahead of you, not owed.
        </p>
      ) : (
        <p className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3.5 py-2.5 text-sm text-emerald-900 dark:text-emerald-300">
          <strong>Nothing overdue.</strong>{" "}
          {c.stillToSave === 0
            ? "You have saved your whole commitment."
            : `The ${formatMoney(c.stillToSave)} above is still to save, not money you owe.`}
        </p>
      )}
    </section>
  );
}
