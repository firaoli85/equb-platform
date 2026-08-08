import { arcPath, clampFraction } from "@/lib/chart";
import { formatMoney } from "@/lib/format";

// THE MEMBER'S SAVINGS RING — the Revolut shape named in ADMIN_IA §6: a
// three-quarter arc, the LABEL ABOVE THE FIGURE inside it, the remainder in
// grey, and the components as a plain list underneath.
//
// Why an arc and not the flat bar it replaces. The bar was honest and it was
// also furniture — it sat under the figure as a decoration nobody read. A
// member's question is not "what percentage" but "am I nearly there", and a
// dial answers that at a glance in a way a 2px line does not. This is the one
// place in the product where a shape is doing emotional work, and it is the
// member's own money, which is the only place that is warranted.
//
// Three-quarter, not full: the gap at the bottom is where the figure breathes,
// and a closed ring reads as a gauge — something being measured — rather than
// as progress someone is making.

const SIZE = 176;
const STROKE = 12;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = (SIZE - STROKE) / 2;

// Degrees clockwise from twelve o'clock. -135 → 135 is the three-quarter
// sweep, opening at the bottom.
const FROM = -135;
const TO = 135;
const SPAN = TO - FROM;

export function SavingsArc({
  paidIn,
  progress,
  weeksCovered,
  weeksCommitted,
  overdue,
}: {
  /** Cents they have actually paid. */
  paidIn: number;
  /** paidIn ÷ the whole commitment, from lib/contribution. */
  progress: number;
  weeksCovered: number;
  weeksCommitted: number;
  /** Cents whose week has closed unpaid. Marked on the ring only when real. */
  overdue: number;
}) {
  const fraction = clampFraction(progress);
  const pct = Math.round(fraction * 100);
  const ahead = progress > 1;

  const track = arcPath({ cx: CX, cy: CY, radius: R, from: FROM, to: TO });
  const filled = arcPath({ cx: CX, cy: CY, radius: R, from: FROM, to: FROM + SPAN * fraction });

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={track}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className="stroke-gray-200 dark:stroke-white/10"
        />
        {filled && (
          <path
            d={filled}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            className={`animate-arc-draw ${
              overdue > 0
                ? "stroke-amber-500 dark:stroke-amber-400"
                : "stroke-emerald-600 dark:stroke-emerald-500"
            }`}
            // The ring draws itself in on first paint. `pathLength` normalises
            // the dash maths so the same two numbers work at any sweep.
            // A CSS class, not an inline style: the reduced-motion block in
            // globals.css switches animations off by class name, and an inline
            // animation would sail straight past it.
            pathLength={100}
            strokeDasharray={100}
          />
        )}
      </svg>

      {/* Label ABOVE the figure, inside the ring — the Revolut ordering. A
          figure with its label underneath is read as a caption; above, it is
          read as an answer to a question. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400">
          Paid in
        </span>
        <span className="mt-0.5 text-[26px] font-black leading-none tracking-tight tabular-nums text-gray-900 dark:text-white">
          {formatMoney(paidIn)}
        </span>
        <span className="mt-1 text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
          {weeksCovered} of {weeksCommitted} weeks
        </span>
      </div>

      {/* The ring is decoration to a screen reader; this is the chart. */}
      <p className="sr-only">
        You have paid in {formatMoney(paidIn)}, which is {pct}% of your commitment —{" "}
        {weeksCovered} of {weeksCommitted} weeks
        {ahead ? ", and you are paid ahead" : ""}
        {overdue > 0 ? `. ${formatMoney(overdue)} is overdue` : ""}.
      </p>
    </div>
  );
}
