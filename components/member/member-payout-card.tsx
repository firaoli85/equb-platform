"use client";

import { formatDateUTC, formatMoney } from "@/lib/format";

export type PayoutNumber = {
  id: string;
  number: number;
  amount: number;
  drawnWeekNumber: number | null;
  payoutStatus: "PENDING" | "COLLECTED" | null;
  netAmount: number;
  grossAmount: number;
};

// "Your payout" — the member's own money only (2.8): net payout, their
// lucky number(s) as gold badges, draw status, and what's next.
export function MemberPayoutCard({
  numbers,
  paidCount,
  totalWeeks,
  nextDue,
}: {
  numbers: PayoutNumber[];
  paidCount: number;
  totalWeeks: number;
  nextDue: { weekNumber: number; date: Date } | null;
}) {
  const totalNet = numbers.reduce((sum, n) => sum + n.netAmount, 0);

  return (
    <div className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm px-5 py-4 animate-fade-in-up-1">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Your payout</h2>
          <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums leading-tight mt-0.5">
            {formatMoney(totalNet)}
          </p>
          <p className="text-[11px] text-gray-600 dark:text-gray-400">
            after the fee{numbers.length > 1 ? " · all numbers together" : ""}
          </p>
        </div>

        {/* Lucky numbers — gold badges (theirs to see) */}
        <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
          {numbers.map((n) => (
            <span
              key={n.id}
              className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full border tabular-nums select-none"
              style={{
                background: "var(--gold-badge-bg)",
                borderColor: "var(--gold-badge-border)",
                color: "var(--gold-badge-text)",
              }}
            >
              #{n.number}
              <span className="font-semibold opacity-75">{formatMoney(n.amount)}/wk</span>
            </span>
          ))}
        </div>
      </div>

      {/* Draw status per number */}
      <div className="space-y-1.5 mb-3">
        {numbers.map((n) => (
          <div key={n.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-600 dark:text-gray-400 tabular-nums">#{n.number}</span>
            {n.payoutStatus === "COLLECTED" ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                </svg>
                Collected{n.drawnWeekNumber !== null ? ` · won week ${n.drawnWeekNumber}` : ""}
              </span>
            ) : n.drawnWeekNumber !== null ? (
              <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full border tabular-nums text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900">
                Won week {n.drawnWeekNumber} · payout on its way
              </span>
            ) : (
              <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full border text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800">
                Still in the draw
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Bottom line: progress + next due */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400">
        <span className="tabular-nums">
          <span className="font-bold text-gray-900 dark:text-white">{paidCount}</span> of{" "}
          <span className="font-bold text-gray-900 dark:text-white">{totalWeeks}</span> weeks paid
        </span>
        {nextDue ? (
          <span className="tabular-nums">
            Next due: week {nextDue.weekNumber} · {formatDateUTC(nextDue.date)}
          </span>
        ) : (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">All paid up</span>
        )}
      </div>
    </div>
  );
}
