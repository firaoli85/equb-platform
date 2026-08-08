// MONEY COLLECTED VS EXPECTED, PER WEEK — docs/ADMIN_IA.md §5.1.
//
// Expected is structural: weeks × unit amount, fixed the moment the cycle
// exists and adjusted only by who is in window. Collected is a fact. Two
// series over an ordered categorical axis is a bar chart; there is no
// argument to have.
//
// The part that carries the meaning is the DIVIDER — a rule between weeks
// whose payment window has closed and weeks still open, borrowing Xero's
// Actuals | Projected split. Without it this week always looks like a
// shortfall, which is the exact false alarm the stored-week-date rule exists
// to prevent. Bars right of the divider are outlined, not filled.
//
// REFUSED: a line chart. Weekly collection is not continuous, and a line
// implies values between weeks that were never measured.

import Link from "next/link";
import { bandScale, chartSummary, linearScale } from "@/lib/chart";
import type { WeekReceipts } from "@/lib/dashboard";
import { formatMoney } from "@/lib/format";

const PER_WEEK = 30;
const MIN_PLOT = 280;
const PAD_L = 58;
const PAD_R = 14;
const TOP = 10;
const PLOT_H = 128;
const AXIS_Y = TOP + PLOT_H + 16;
const HEIGHT = AXIS_Y + 10;

function axisMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

export function CollectedVsExpectedChart({
  weeks,
  className = "",
}: {
  weeks: readonly WeekReceipts[];
  className?: string;
}) {
  if (weeks.length === 0) {
    return (
      <div
        className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-[#141414] ${className}`}
      >
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Collected vs expected</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          No weeks yet. This appears once the cycle has its first week.
        </p>
      </div>
    );
  }

  const plotW = Math.max(MIN_PLOT, weeks.length * PER_WEEK);
  const width = PAD_L + plotW + PAD_R;
  const band = bandScale(weeks.length, plotW, 0.3);
  const scale = linearScale(
    weeks.reduce((m, w) => Math.max(m, w.expected, w.received), 0),
    PLOT_H,
  );
  const y = (v: number) => TOP + PLOT_H - scale(v);

  const elapsedCount = weeks.filter((w) => w.elapsed).length;
  const hasToCome = elapsedCount > 0 && elapsedCount < weeks.length;
  const dividerX = hasToCome ? PAD_L + band.at(elapsedCount) - (band.step - band.bandWidth) / 2 : 0;

  // The headline is about CLOSED weeks only. A shortfall that includes the
  // week still being collected is not a shortfall, it is impatience.
  const closed = weeks.filter((w) => w.elapsed);
  const closedExpected = closed.reduce((s, w) => s + w.expected, 0);
  const closedReceived = closed.reduce((s, w) => s + w.received, 0);
  const behind = Math.max(0, closedExpected - closedReceived);

  const everyNth = weeks.length > 26 ? 2 : 1;
  // Two bars per week: expected behind, received in front and narrower, so the
  // gap between them is readable as a gap rather than as a third bar.
  const expW = band.bandWidth;
  const recW = band.bandWidth * 0.56;

  return (
    <figure
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#141414] ${className}`}
    >
      <figcaption className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Collected vs expected</h2>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            Week by week, across the {closed.length} week{closed.length === 1 ? "" : "s"} that have
            closed
          </p>
        </div>
        <p className="text-right">
          <span
            className={`block text-xl font-black tabular-nums ${
              behind > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {behind > 0 ? formatMoney(behind) : "All in"}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {behind > 0 ? "overdue across closed weeks" : "closed weeks are fully collected"}
          </span>
        </p>
      </figcaption>

      <div className="overflow-x-auto px-5 pb-1 touch-pan-x">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          className="max-w-none"
          aria-hidden="true"
          focusable="false"
        >
          {scale.ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={width - PAD_R}
                y1={y(t)}
                y2={y(t)}
                className="stroke-gray-200 dark:stroke-gray-800"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 8}
                y={y(t) + 3.5}
                textAnchor="end"
                className="fill-gray-500 dark:fill-gray-500"
                style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
              >
                {axisMoney(t)}
              </text>
            </g>
          ))}

          {weeks.map((w, i) => {
            const x = PAD_L + band.at(i);
            const expH = Math.max(w.expected > 0 ? 1 : 0, scale(w.expected));
            const recH = Math.max(w.received > 0 ? 1 : 0, scale(w.received));
            return (
              <g key={w.weekNumber}>
                {/* Expected: a quiet backdrop. It is a claim about the future,
                    so it never out-weighs the fact drawn in front of it. */}
                {w.expected > 0 && (
                  <rect
                    x={x}
                    y={y(w.expected)}
                    width={expW}
                    height={expH}
                    rx={2}
                    className="fill-gray-200/90 dark:fill-gray-800"
                  />
                )}
                {/* Received: filled once the week has closed, outlined while it
                    is still open — money still arriving is not a result. */}
                {w.received > 0 &&
                  (w.elapsed ? (
                    <rect
                      x={x + (expW - recW) / 2}
                      y={y(w.received)}
                      width={recW}
                      height={recH}
                      rx={2}
                      className={
                        w.received >= w.expected
                          ? "fill-emerald-600 dark:fill-emerald-500"
                          : "fill-indigo-600 dark:fill-indigo-400"
                      }
                    />
                  ) : (
                    <rect
                      x={x + (expW - recW) / 2}
                      y={y(w.received)}
                      width={recW}
                      height={recH}
                      rx={2}
                      fill="none"
                      strokeWidth={1.5}
                      className="stroke-indigo-600 dark:stroke-indigo-400"
                    />
                  ))}
                {/* A closed week that came up short is MARKED, not just
                    coloured — rule 4 forbids colour as the only carrier. */}
                {w.elapsed && w.expected > 0 && w.received < w.expected && (
                  <circle
                    cx={x + expW / 2}
                    cy={TOP - 4}
                    r={2}
                    className="fill-red-600 dark:fill-red-400"
                  />
                )}
              </g>
            );
          })}

          {hasToCome && (
            <>
              <line
                x1={dividerX}
                x2={dividerX}
                y1={TOP - 8}
                y2={TOP + PLOT_H}
                strokeWidth={1}
                strokeDasharray="2 3"
                className="stroke-gray-400 dark:stroke-gray-600"
              />
              <text
                x={dividerX + 4}
                y={TOP - 1}
                className="fill-gray-500 dark:fill-gray-500"
                style={{ fontSize: 9 }}
              >
                still open
              </text>
            </>
          )}

          <line
            x1={PAD_L}
            x2={width - PAD_R}
            y1={TOP + PLOT_H}
            y2={TOP + PLOT_H}
            className="stroke-gray-300 dark:stroke-gray-700"
            strokeWidth={1}
          />

          {weeks.map((w, i) =>
            i % everyNth === 0 || i === weeks.length - 1 ? (
              <text
                key={w.weekNumber}
                x={PAD_L + band.at(i) + expW / 2}
                y={AXIS_Y}
                textAnchor="middle"
                className={
                  w.elapsed ? "fill-gray-600 dark:fill-gray-400" : "fill-gray-400 dark:fill-gray-600"
                }
                style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
              >
                {w.weekNumber}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <ul className="flex flex-wrap gap-1 px-5 pb-3 pt-1">
        {weeks.map((w) => (
          <li key={w.weekNumber}>
            <Link
              href={`/admin/payments?week=${w.weekNumber}`}
              className="flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-gray-500 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300"
              title={`Week ${w.weekNumber}: ${formatMoney(w.received)} of ${formatMoney(w.expected)} — ${w.membersPaid} of ${w.membersExpected} paid`}
            >
              {w.weekNumber}
            </Link>
          </li>
        ))}
      </ul>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 px-5 py-3 dark:border-gray-800/60">
        {[
          {
            key: "expected",
            label: "Expected",
            swatch: <span className="h-2.5 w-4 rounded-sm bg-gray-200 dark:bg-gray-800" />,
          },
          {
            key: "full",
            label: "Fully collected",
            swatch: <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-500" />,
          },
          {
            key: "part",
            label: "Partly collected",
            swatch: <span className="h-2.5 w-2.5 rounded-sm bg-indigo-600 dark:bg-indigo-400" />,
          },
          {
            key: "open",
            label: "Still open",
            swatch: (
              <span className="h-2.5 w-2.5 rounded-sm border-[1.5px] border-indigo-600 dark:border-indigo-400" />
            ),
          },
          {
            key: "short",
            label: "Closed short",
            swatch: <span className="h-1.5 w-1.5 rounded-full bg-red-600 dark:bg-red-400" />,
          },
        ].map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            {item.swatch}
            <span className="text-xs text-gray-600 dark:text-gray-400">{item.label}</span>
          </li>
        ))}
      </ul>

      <p className="sr-only">
        {chartSummary({
          what: "Money collected against expected, by week",
          points: weeks.length,
          from: `week ${weeks[0].weekNumber}`,
          to: `week ${weeks[weeks.length - 1].weekNumber}`,
        })}
      </p>
      <table className="sr-only">
        <caption>Collected against expected, by week</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Collected</th>
            <th scope="col">Expected</th>
            <th scope="col">Overdue</th>
            <th scope="col">Members paid</th>
            <th scope="col">Week status</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekNumber}>
              <th scope="row">{w.weekNumber}</th>
              <td>{formatMoney(w.received)}</td>
              <td>{formatMoney(w.expected)}</td>
              <td>{w.elapsed && w.shortfall > 0 ? formatMoney(w.shortfall) : "none"}</td>
              <td>
                {w.membersPaid} of {w.membersExpected}
              </td>
              <td>{w.elapsed ? "closed" : "still open"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-600 dark:border-gray-800/60 dark:text-gray-400">
        Expected counts only members whose commitment covers the week, and drops anyone whose week
        was deferred or skipped.
        {hasToCome
          ? " Weeks right of the divider are still open, so nothing there is overdue yet."
          : " Every week here has closed."}
      </p>
    </figure>
  );
}
