"use client";

import { feePreview, feeSentence, splitSentence } from "@/lib/fee-preview";
import { formatMoney } from "@/lib/format";

// THE ANSWER HE READS OFF THE SCREEN.
//
// The organizer is on the phone with someone deciding whether to join, and
// they ask "if I put in $750 a week, what's your fee?". He should read the
// answer, not calculate it — and people propose irregular figures ($800, $325,
// $1,250, $1,875), so there is no tier list to look it up in.
//
// A SENTENCE, NOT A TABLE OF LABELS. He is going to say this out loud. A grid
// of "Gross / Fee / Net" cells makes him assemble the sentence himself while
// someone waits on the line.
//
// PREVIEW ONLY. Nothing here writes; it recomputes as he types and disappears
// when the figures cannot describe a contribution.
//
// The arithmetic is lib/fee-preview.ts, which sums PER LUCKY NUMBER through
// the same `calculatePayout` the member portal uses — so the figure he quotes
// and the figure the member later reads on their own screen are the same one.

export function FeeCalculator({
  weeklyAmount,
  weeksCommitted,
  unitAmount,
  feePercent,
  className = "",
}: {
  /** Cents, or null while the field is empty or half-typed. */
  weeklyAmount: number | null;
  weeksCommitted: number | null;
  /** The cycle's real values — never hardcoded (2.6). */
  unitAmount: number;
  feePercent: number;
  className?: string;
}) {
  const preview =
    weeklyAmount === null || weeksCommitted === null
      ? null
      : feePreview({ weeklyAmount, weeksCommitted, unitAmount, feePercent });

  if (!preview) {
    return (
      <p
        data-testid="fee-calculator-empty"
        className={
          "rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 " +
          "text-sm text-gray-600 dark:text-gray-400 " +
          className
        }
      >
        Enter a weekly amount and a number of weeks to see what they receive and what the fee is.
      </p>
    );
  }

  return (
    <div
      data-testid="fee-calculator"
      aria-live="polite"
      className={
        "rounded-xl border border-emerald-300 dark:border-emerald-800 " +
        "bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 " +
        className
      }
    >
      <p className="text-base font-bold leading-snug text-emerald-950 dark:text-emerald-100">
        {feeSentence(preview, formatMoney)}
      </p>
      {preview.splits && (
        <p className="mt-1.5 text-xs text-emerald-900/80 dark:text-emerald-200/80">
          {splitSentence(preview, formatMoney)}
        </p>
      )}
      {/* The figures again as columns, for reading rather than saying — the
          same numbers, never a second calculation. */}
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums text-emerald-900 dark:text-emerald-200">
        <div>
          <dt className="inline font-semibold">They receive </dt>
          <dd className="inline">{formatMoney(preview.gross)}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Fee ({feePercent}%) </dt>
          <dd className="inline">{formatMoney(preview.fee)}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">They get </dt>
          <dd className="inline">{formatMoney(preview.net)}</dd>
        </div>
      </dl>
      <p className="mt-1.5 text-[11px] text-emerald-900/70 dark:text-emerald-200/70">
        Nothing is saved until you press save.
      </p>
    </div>
  );
}
