// CASH POSITION OVER TIME — docs/ADMIN_IA.md §5.2.
//
// The headline is a single running value — HELD — which is received minus paid
// out at every point in time. One continuous series, so it is an area. The two
// movements that produce it are events, so they are bars on a shared axis
// beneath it.
//
// REFUSED: three overlaid lines. Received and paid out are not positions;
// drawing them as lines invites reading a slope that means nothing.
// REFUSED: a stacked area. Stacking implies the parts sum to the whole, and
// paid out REDUCES held.
//
// The Monarch shape (bars carrying a running value), read with Mercury's
// restraint: money in and money out named plainly, figures tabular, no
// gradient anywhere.

import Link from "next/link";
import { areaPath, bandScale, chartSummary, linePath, linearScale } from "@/lib/chart";
import type { CashPoint } from "@/lib/dashboard";
import { formatMoney } from "@/lib/format";

// Geometry in viewBox units. The plot is given a minimum width per week so a
// 20-week cycle scrolls rather than compressing into an unreadable smear.
const PER_WEEK = 34;
const MIN_PLOT = 300;
const PAD_L = 60;
const PAD_R = 14;
const AREA_TOP = 10;
const AREA_H = 116;
const MOVE_TOP = AREA_H + AREA_TOP + 24;
const MOVE_H = 56;
const AXIS_Y = MOVE_TOP + MOVE_H + 16;
const HEIGHT = AXIS_Y + 10;

/** Compact axis money: $12.4k rather than $12,400.00, which will not fit. */
function axisMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

export function CashPositionChart({
  points,
  className = "",
}: {
  points: readonly CashPoint[];
  className?: string;
}) {
  if (points.length === 0) {
    return (
      <div
        className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-[#141414] ${className}`}
      >
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Cash position</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          No weeks yet. The position appears once the cycle has its first week.
        </p>
      </div>
    );
  }

  const plotW = Math.max(MIN_PLOT, points.length * PER_WEEK);
  const width = PAD_L + plotW + PAD_R;
  const band = bandScale(points.length, plotW, 0.34);
  const centre = (i: number) => PAD_L + band.at(i) + band.bandWidth / 2;

  // A position below zero cannot be drawn on a 0-based axis without lying
  // about it, so it is clamped AND said out loud in the footnote.
  const lowest = points.reduce((m, p) => Math.min(m, p.held), 0);
  const heldScale = linearScale(
    points.reduce((m, p) => Math.max(m, p.held), 0),
    AREA_H,
  );
  const heldY = (v: number) => AREA_TOP + AREA_H - heldScale(Math.max(0, v));

  const moveMax = points.reduce((m, p) => Math.max(m, p.received, p.paidOut + p.pendingOut), 0);
  const moveScale = linearScale(moveMax, MOVE_H / 2, 2);
  const midline = MOVE_TOP + MOVE_H / 2;

  const elapsedCount = points.filter((p) => p.elapsed).length;
  const hasToCome = elapsedCount > 0 && elapsedCount < points.length;
  // The divider sits in the GAP between the last closed week and the first
  // open one — the Xero Actuals | Projected split. Without it the current
  // week always reads as a collapse in the position, because its money is
  // still arriving.
  const dividerX = hasToCome ? PAD_L + band.at(elapsedCount) - (band.step - band.bandWidth) / 2 : 0;

  const actual = points.slice(0, elapsedCount || points.length);
  const actualPts = actual.map((p, i) => ({ x: centre(i), y: heldY(p.held) }));
  // The projected leg starts at the last ACTUAL point so the two join, rather
  // than the dashed line beginning in mid-air a week later.
  const aheadPts = hasToCome
    ? points.slice(elapsedCount - 1).map((p, i) => ({ x: centre(elapsedCount - 1 + i), y: heldY(p.held) }))
    : [];

  const now = points[Math.max(0, elapsedCount - 1)];
  const everyNth = points.length > 26 ? 2 : 1;

  return (
    <figure
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#141414] ${className}`}
    >
      <figcaption className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Cash position</h2>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            What the group is holding, week by week
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xl font-black tabular-nums text-gray-900 dark:text-white">
            {formatMoney(now.held)}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            held after week {now.weekNumber}
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
          {/* Gridlines and the money axis. Drawn first so nothing sits on top
              of a real figure. */}
          {heldScale.ticks.map((t) => {
            const y = AREA_TOP + AREA_H - heldScale(t);
            return (
              <g key={t}>
                <line
                  x1={PAD_L}
                  x2={width - PAD_R}
                  y1={y}
                  y2={y}
                  className="stroke-gray-200 dark:stroke-gray-800"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-gray-500 dark:fill-gray-500"
                  style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
                >
                  {axisMoney(t)}
                </text>
              </g>
            );
          })}

          {/* The held position: filled where it happened, dashed where the
              week is still open and its money still arriving. */}
          {actualPts.length > 0 && (
            <>
              <path
                d={areaPath(actualPts, AREA_TOP + AREA_H)}
                className="fill-indigo-500/12 dark:fill-indigo-400/12"
              />
              <path
                d={linePath(actualPts)}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-indigo-600 dark:stroke-indigo-400"
              />
            </>
          )}
          {aheadPts.length > 1 && (
            <path
              d={linePath(aheadPts)}
              fill="none"
              strokeWidth={2}
              strokeDasharray="3 4"
              strokeLinejoin="round"
              className="stroke-indigo-400/70 dark:stroke-indigo-500/70"
            />
          )}

          {/* The elapsed | still open divider. */}
          {hasToCome && (
            <>
              <line
                x1={dividerX}
                x2={dividerX}
                y1={AREA_TOP - 4}
                y2={AXIS_Y - 12}
                strokeWidth={1}
                strokeDasharray="2 3"
                className="stroke-gray-400 dark:stroke-gray-600"
              />
              <text
                x={dividerX + 4}
                y={AREA_TOP + 4}
                className="fill-gray-500 dark:fill-gray-500"
                style={{ fontSize: 9 }}
              >
                still open
              </text>
            </>
          )}

          {/* The two movements, on their own axis beneath: received rises from
              the midline, paid out falls from it. Same scale both ways, so a
              week that took in exactly what it paid out is symmetrical. */}
          <line
            x1={PAD_L}
            x2={width - PAD_R}
            y1={midline}
            y2={midline}
            className="stroke-gray-300 dark:stroke-gray-700"
            strokeWidth={1}
          />
          {points.map((p, i) => {
            const x = PAD_L + band.at(i);
            const w = band.bandWidth;
            const inH = moveScale(p.received);
            const outH = moveScale(p.paidOut);
            const pendH = moveScale(p.pendingOut);
            return (
              <g key={p.weekNumber}>
                {p.received > 0 && (
                  <rect
                    x={x}
                    y={midline - inH}
                    width={w}
                    height={Math.max(1, inH)}
                    rx={1.5}
                    className={
                      p.elapsed
                        ? "fill-emerald-600/80 dark:fill-emerald-500/80"
                        : "fill-none stroke-emerald-600/70 dark:stroke-emerald-500/70"
                    }
                    strokeWidth={p.elapsed ? 0 : 1}
                  />
                )}
                {p.paidOut > 0 && (
                  <rect
                    x={x}
                    y={midline}
                    width={w}
                    height={Math.max(1, outH)}
                    rx={1.5}
                    className="fill-gray-700/80 dark:fill-gray-400/70"
                  />
                )}
                {/* Drawn but not collected: outlined, below the line, stacked
                    under what HAS gone — the money is owed but still in hand,
                    so it must not read as cash that left. */}
                {p.pendingOut > 0 && (
                  <rect
                    x={x}
                    y={midline + outH}
                    width={w}
                    height={Math.max(1, pendH)}
                    rx={1.5}
                    fill="none"
                    strokeDasharray="2 2"
                    strokeWidth={1}
                    className="stroke-gray-600 dark:stroke-gray-400"
                  />
                )}
              </g>
            );
          })}

          {/* Week labels. Thinned on a long cycle rather than overlapped. */}
          {points.map((p, i) =>
            i % everyNth === 0 || i === points.length - 1 ? (
              <text
                key={p.weekNumber}
                x={centre(i)}
                y={AXIS_Y}
                textAnchor="middle"
                className={
                  p.elapsed ? "fill-gray-600 dark:fill-gray-400" : "fill-gray-400 dark:fill-gray-600"
                }
                style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
              >
                {p.weekNumber}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* Drill-down: one link per week, keyboard-reachable in week order.
          §8 — every figure on screen is a link to the thing it is about. */}
      <ul className="flex flex-wrap gap-1 px-5 pb-3 pt-1">
        {points.map((p) => (
          <li key={p.weekNumber}>
            <Link
              href={`/admin/payments?week=${p.weekNumber}`}
              className="flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums text-gray-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-gray-500 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-300"
              title={`Week ${p.weekNumber}: ${formatMoney(p.received)} in, ${formatMoney(p.paidOut)} out, ${formatMoney(p.held)} held`}
            >
              {p.weekNumber}
            </Link>
          </li>
        ))}
      </ul>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 px-5 py-3 dark:border-gray-800/60">
        {[
          {
            key: "held",
            label: "Held (received − paid out)",
            swatch: (
              <span className="h-2.5 w-4 rounded-sm bg-indigo-500/25 ring-1 ring-indigo-600 dark:ring-indigo-400" />
            ),
          },
          {
            key: "in",
            label: "Money in",
            swatch: <span className="h-2.5 w-3 rounded-sm bg-emerald-600 dark:bg-emerald-500" />,
          },
          {
            key: "out",
            label: "Money out",
            swatch: <span className="h-2.5 w-3 rounded-sm bg-gray-700 dark:bg-gray-400" />,
          },
          {
            key: "pending",
            label: "Drawn, not collected",
            swatch: (
              <span className="h-2.5 w-3 rounded-sm border border-dashed border-gray-600 dark:border-gray-400" />
            ),
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
          what: "Cash position by week",
          points: points.length,
          from: `week ${points[0].weekNumber}`,
          to: `week ${points[points.length - 1].weekNumber}`,
          highest: {
            label: `week ${points.reduce((a, b) => (a.held >= b.held ? a : b)).weekNumber}`,
            value: formatMoney(points.reduce((a, b) => (a.held >= b.held ? a : b)).held),
          },
        })}
      </p>
      <table className="sr-only">
        <caption>Cash position by week</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Money in</th>
            <th scope="col">Money out</th>
            <th scope="col">Drawn, not collected</th>
            <th scope="col">Held</th>
            <th scope="col">Week status</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.weekNumber}>
              <th scope="row">{p.weekNumber}</th>
              <td>{formatMoney(p.received)}</td>
              <td>{formatMoney(p.paidOut)}</td>
              <td>{formatMoney(p.pendingOut)}</td>
              <td>{formatMoney(p.held)}</td>
              <td>{p.elapsed ? "closed" : "still open"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-600 dark:border-gray-800/60 dark:text-gray-400">
        Money is counted against the week it is <em>for</em>, not the day it arrived — so a
        catch-up payment for week 3 sits in week 3, where the payments grid also shows it.
        {hasToCome && " Weeks right of the divider are still open; their money is still coming in."}
        {lowest < 0 &&
          ` The position went below zero (lowest ${formatMoney(lowest)}) — more was handed out than had been received at that point.`}
      </p>
    </figure>
  );
}
