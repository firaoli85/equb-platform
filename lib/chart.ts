// CHART GEOMETRY — pure, tested, and deliberately not a charting library.
//
// WHY NO LIBRARY. Every figure on this platform is integer CENTS formatted once
// through formatMoney (UI_STANDARDS rule 8), every axis label has to be
// tabular, and every chart has to carry a table for screen readers. A charting
// library gives none of that for free and takes the layout decisions away — and
// the layout decisions are the whole argument (see docs/ADMIN_IA.md §5).
//
// So the maths lives here, pure and unit-tested, and the components are thin
// SVG over it. The scales are the part that goes wrong silently — a bar drawn
// 3px tall for a real $340 reads as zero — so they are the part that is tested.

/** A value scaled into a pixel band. */
export type Scale = {
  /** Value → pixel offset from the band's start. */
  (value: number): number;
  /** The value the axis tops out at, after rounding up to a readable step. */
  max: number;
  /** The tick values, in ascending order, including 0 and max. */
  ticks: number[];
};

/**
 * A linear scale from [0, niceMax] onto [0, length] pixels.
 *
 * The maximum is rounded UP to a readable step (1, 2 or 5 × a power of ten) so
 * the axis reads "$0 / $10,000 / $20,000" rather than "$0 / $8,432 / $16,864".
 * An axis nobody can read is decoration.
 */
export function linearScale(maxValue: number, length: number, tickCount = 4): Scale {
  const max = niceCeiling(maxValue);
  const fn = ((value: number) => (max === 0 ? 0 : (value / max) * length)) as Scale;
  fn.max = max;
  fn.ticks = Array.from({ length: tickCount + 1 }, (_, i) => (max / tickCount) * i);
  return fn;
}

/**
 * Round up to a "nice" number: 1, 2 or 5 times a power of ten.
 *
 * Zero stays zero — an all-zero chart must not invent a $10 axis, because a
 * chart claiming a scale it does not have is worse than an empty one.
 */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Evenly spaced band positions — one per category, e.g. one per week. */
export function bandScale(count: number, length: number, paddingRatio = 0.25) {
  const step = count === 0 ? 0 : length / count;
  const bandWidth = step * (1 - paddingRatio);
  return {
    step,
    bandWidth,
    /** Pixel offset of band i's left edge, inside its slot. */
    at: (i: number) => i * step + (step - bandWidth) / 2,
  };
}

/**
 * An SVG path through a series of points, as a step-free polyline.
 *
 * Deliberately straight segments, not a spline: a smoothed cash-position line
 * invents values between weeks that were never measured, and on a money chart
 * that is a lie with a curve on it.
 */
export function linePath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/** The same line closed down to a baseline, for a filled area. */
export function areaPath(
  points: readonly { x: number; y: number }[],
  baselineY: number,
): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return (
    `${linePath(points)} L${last.x.toFixed(2)},${baselineY.toFixed(2)} ` +
    `L${first.x.toFixed(2)},${baselineY.toFixed(2)} Z`
  );
}

/**
 * A description of a chart for a screen reader, in one sentence.
 *
 * Every chart also renders a real <table> in a visually-hidden block — this is
 * the summary that goes on the figure itself, so the reader knows whether the
 * table is worth opening.
 */
export function chartSummary(input: {
  what: string;
  points: number;
  from: string;
  to: string;
  highest?: { label: string; value: string };
}): string {
  const range = input.points === 0 ? "no data yet" : `${input.from} to ${input.to}`;
  return (
    `${input.what}, ${input.points} point${input.points === 1 ? "" : "s"}, ${range}.` +
    (input.highest ? ` Highest: ${input.highest.label}, ${input.highest.value}.` : "")
  );
}

// ————————————————— The segmented bar (ADMIN_IA §5.3) —————————————————

export type Segment = {
  key: string;
  label: string;
  value: number;
};

/**
 * Segment widths as percentages of a KNOWN total.
 *
 * The denominator is passed in rather than summed, because the point of this
 * chart is that the total is known in advance — everyone receives exactly once
 * per cycle — and the gap between the segments and the total is itself the
 * information ("15 still to come").
 *
 * A segment with a real, non-zero value never renders narrower than
 * `minPercent`: one payout out of 25 is 4% of the bar, which at 600px is 24px
 * and fine, but at 320px is 12px and reads as nothing.
 */
export function segmentWidths(
  segments: readonly Segment[],
  total: number,
  minPercent = 2,
): { key: string; percent: number }[] {
  if (total <= 0) return segments.map((s) => ({ key: s.key, percent: 0 }));
  const raw = segments.map((s) => ({
    key: s.key,
    percent: (Math.max(0, s.value) / total) * 100,
  }));
  // Lift the tiny-but-real ones to the floor, then take the difference back
  // from the largest segment that was NOT lifted — taking it from the lifted
  // one undoes the lift, which is exactly the bug the test caught. When every
  // segment was lifted (a single tiny segment, say) the lift simply stands: a
  // bar 2% full is honest, and 0.5% is invisible.
  const wasLifted = new Set<string>();
  const lifted = raw.map((r) => {
    if (r.percent > 0 && r.percent < minPercent) {
      wasLifted.add(r.key);
      return { ...r, percent: minPercent };
    }
    return { ...r };
  });
  const debt = lifted.reduce((s, r) => s + r.percent, 0) - raw.reduce((s, r) => s + r.percent, 0);
  if (debt > 0) {
    const donors = lifted.filter((r) => !wasLifted.has(r.key) && r.percent > 0);
    if (donors.length > 0) {
      const largest = donors.reduce((a, b) => (a.percent >= b.percent ? a : b));
      largest.percent = Math.max(0, largest.percent - debt);
    }
  }
  return lifted;
}

// ————————————— Per-member consistency strip (ADMIN_IA §5.4) —————————————

/**
 * What one dot in a member's strip says.
 *
 * `not-due` exists so a member's strip is always the full length of their
 * window — a strip that stops at the current week makes a late joiner look like
 * they dropped out.
 */
export type ConsistencyState = "paid" | "partial" | "deferred" | "overdue" | "not-due";

export function consistencyState(input: {
  amountDue: number;
  amountPaid: number;
  isDeferred: boolean;
  /** The payment window has closed — from the calendar, never a stored flag. */
  windowClosed: boolean;
}): ConsistencyState {
  if (input.isDeferred) return "deferred";
  if (input.amountPaid >= input.amountDue && input.amountDue > 0) return "paid";
  if (!input.windowClosed) return input.amountPaid > 0 ? "partial" : "not-due";
  if (input.amountPaid > 0) return "partial";
  return "overdue";
}

/** The longest run of consecutive overdue weeks — the thing worth spotting. */
export function longestOverdueRun(states: readonly ConsistencyState[]): number {
  let best = 0;
  let run = 0;
  for (const s of states) {
    if (s === "overdue") {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}
