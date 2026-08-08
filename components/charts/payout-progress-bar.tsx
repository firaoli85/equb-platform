// PAYOUTS MADE VS PENDING — docs/ADMIN_IA.md §5.3.
//
// One segmented horizontal bar, of a KNOWN total.
//
// Every lucky number wins exactly once per cycle, so the denominator is the
// number of lucky numbers and it is known the day the cycle starts. That makes
// this part-to-whole with a fixed denominator — a single stacked bar reading
// collected · waiting · still to come, with the counts as text.
//
// The denominator is LUCKY NUMBERS, not members: four of the twenty-seven hold
// two numbers each, so a member-count denominator would report the cycle
// finished with four payouts still to make.
//
// REFUSED: a donut. Three segments of a known total is a bar. A donut makes
// the counts harder to compare and adds nothing but a hole.

import Link from "next/link";
import { segmentWidths } from "@/lib/chart";
import { formatMoney } from "@/lib/format";

export function PayoutProgressBar({
  collectedCount,
  pendingCount,
  totalNumbers,
  collectedTotal,
  pendingTotal,
  className = "",
}: {
  collectedCount: number;
  pendingCount: number;
  /** Every lucky number in the cycle — the fixed denominator. */
  totalNumbers: number;
  collectedTotal: number;
  pendingTotal: number;
  className?: string;
}) {
  const drawn = collectedCount + pendingCount;
  const toCome = Math.max(0, totalNumbers - drawn);
  // More payouts than lucky numbers means a number has been paid twice. The
  // bar cannot show it — every part is scaled to fit — so the screen says it
  // in words rather than letting a clipped segment stand as the only clue.
  const overdrawn = drawn > totalNumbers;
  const widths = new Map(
    segmentWidths(
      [
        { key: "collected", label: "Collected", value: collectedCount },
        { key: "pending", label: "Waiting", value: pendingCount },
        { key: "toCome", label: "Still to come", value: toCome },
      ],
      totalNumbers,
    ).map((s) => [s.key, s.percent]),
  );

  const SEGMENTS = [
    {
      key: "collected",
      label: "Collected",
      count: collectedCount,
      money: collectedTotal,
      href: "/admin/cash?view=paid-out",
      // Solid, hatched, and empty: three states told three ways, so the bar
      // survives being read in greyscale or by someone colour-blind (rule 4).
      bar: "bg-emerald-600 dark:bg-emerald-500",
      dot: "bg-emerald-600 dark:bg-emerald-500",
    },
    {
      key: "pending",
      label: "Waiting to collect",
      count: pendingCount,
      money: pendingTotal,
      href: "/admin/waiting",
      bar: "bg-amber-500/80 dark:bg-amber-500/70 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,0.45)_3px,rgba(255,255,255,0.45)_6px)]",
      dot: "bg-amber-500 dark:bg-amber-500/80",
    },
    {
      key: "toCome",
      label: "Still to come",
      count: toCome,
      money: null,
      href: "/admin/wheel/setup",
      bar: "bg-gray-200 dark:bg-gray-800",
      dot: "bg-gray-300 dark:bg-gray-700",
    },
  ] as const;

  return (
    <figure
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#141414] ${className}`}
    >
      <figcaption className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Payout progress</h2>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            Every number wins once — {totalNumbers} in this cycle
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xl font-black tabular-nums text-gray-900 dark:text-white">
            {collectedCount} of {totalNumbers}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-400">handed over</span>
        </p>
      </figcaption>

      <div className="px-5">
        <div
          className="flex h-4 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5"
          aria-hidden="true"
        >
          {SEGMENTS.map((s) => {
            const percent = widths.get(s.key) ?? 0;
            if (percent <= 0) return null;
            return (
              <span
                key={s.key}
                className={`h-full ${s.bar} ${s.key !== "toCome" ? "border-r border-white dark:border-[#141414]" : ""}`}
                style={{ width: `${percent}%` }}
              />
            );
          })}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-px px-5 pb-4 pt-3 sm:grid-cols-3">
        {SEGMENTS.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className="flex min-h-11 flex-col justify-center rounded-lg px-2 py-1 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.dot}`} />
                <span className="text-xs text-gray-600 dark:text-gray-400">{s.label}</span>
              </span>
              <span className="mt-0.5 pl-4 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                {s.count}
                {s.money !== null && (
                  <span className="ml-1.5 font-medium text-gray-600 dark:text-gray-400">
                    {formatMoney(s.money)}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {overdrawn && (
        <p className="border-t border-red-200 bg-red-50 px-5 py-3 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {drawn} payouts across {totalNumbers} lucky numbers — {drawn - totalNumbers} more than
          there are numbers to win. Every number wins once, so one has been paid twice. Check
          Collections before anything else on this screen is trusted.
        </p>
      )}

      <table className="sr-only">
        <caption>Payout progress across {totalNumbers} lucky numbers</caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Numbers</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {SEGMENTS.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{s.count}</td>
              <td>{s.money === null ? "not drawn yet" : formatMoney(s.money)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
