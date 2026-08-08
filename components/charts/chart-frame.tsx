// THE SHELL EVERY CHART SHARES.
//
// Three things are non-negotiable on this platform and none of them are
// visual, so they live here rather than being re-remembered per chart:
//
//   1. A chart is a <figure> with a real caption, not a decorated div.
//   2. Every chart carries its figures as a TABLE for a screen reader. The
//      SVG is aria-hidden; the table is the accessible chart. A chart nobody
//      can read is a chart that lies by omission.
//   3. Wide plots scroll INSIDE their own container (UI_STANDARDS rule 11).
//      The page never scrolls sideways at 390px.

import type { ReactNode } from "react";

export function ChartFrame({
  title,
  sub,
  right,
  summary,
  children,
  table,
  footnote,
  className = "",
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  /** One sentence from `chartSummary` — read before the table is opened. */
  summary: string;
  /** The plot. Wrapped in the scroll container by this component. */
  children: ReactNode;
  /** The same figures as a real table. Required, never optional. */
  table: ReactNode;
  /** What the chart refuses to claim — drawn under the plot, not hidden. */
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#141414] ${className}`}
    >
      <figcaption className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{sub}</p>}
        </div>
        {right}
      </figcaption>

      {/* The plot scrolls inside itself. `touch-pan-x` keeps a sideways drag on
          the chart from fighting the page's vertical scroll on a phone. */}
      <div className="overflow-x-auto px-5 pb-1 touch-pan-x">{children}</div>

      <p className="sr-only">{summary}</p>
      <div className="sr-only">{table}</div>

      {footnote && (
        <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-600 dark:border-gray-800/60 dark:text-gray-400">
          {footnote}
        </p>
      )}
    </figure>
  );
}

/**
 * A legend row. Swatches carry a SHAPE as well as a colour — filled, outlined,
 * ringed — because rule 4 forbids colour as the only carrier of meaning, and a
 * legend is exactly where that rule gets broken.
 */
export function ChartLegend({ items }: { items: readonly { swatch: ReactNode; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pb-4 pt-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.swatch}
          <span className="text-xs text-gray-600 dark:text-gray-400">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
