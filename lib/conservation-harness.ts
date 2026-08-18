// THE SCENARIO HARNESS — invented cycles, run through the real engine.
//
// WHY THIS EXISTS. `scripts/audit-position-figures.mts` proves every figure on
// the money screens against the live rows by a second route, and it is the
// right idea; it just cannot vary the world. It audits ONE cycle in whatever
// state it happens to be in. Both defects shipped in the week this was written
// lived in states that cycle had never been in: a week fell between two clocks
// (needs `currentWeek` ahead of `elapsedThroughWeek`), and a break was
// back-dated over weeks a member had paid (needs removed-then-reactivated with
// no stored closing week).
//
// So: the same philosophy, over SYNTHETIC cycles. Build a world, push it
// through the real functions, and check the conservation laws the governing
// documents state. Nothing here re-implements a rule — that would be marking
// its own homework. It arranges inputs and compares outputs.
//
// PURE, AND DELIBERATELY SO. No Prisma, no fixture database, no clock. Every
// scenario is a value, every run is deterministic, and a failure reproduces
// from its seed alone.
//
// NOTHING IN THE APPLICATION IMPORTS THIS. It is the harness half of
// lib/conservation.test.ts, kept in its own file because a 600-line builder
// inside a test file hides the tests.

import { calculateFee, calculateNet } from "./money";

// ————————————————— Determinism —————————————————

/**
 * mulberry32 — a small seeded PRNG.
 *
 * Deterministic on purpose: `seed 7` must produce the same cycle on every
 * machine and every run, so a failure is reproducible from the seed printed in
 * its message. `Math.random()` here would make a red test un-investigable.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// ————————————————— The world —————————————————

export type ScenarioPayment = {
  weekNumber: number;
  amountPaid: number;
  isDeferred: boolean;
  markedLate: boolean;
};

export type ScenarioBreak = { fromWeek: number; toWeek: number | null };

export type ScenarioPayout = {
  /** Index into the member's `numbers`. */
  numberIndex: number;
  /** The week they were drawn. */
  weekNumber: number;
  status: "PENDING" | "COLLECTED";
};

export type ScenarioMember = {
  id: string;
  name: string;
  weeklyAmount: number;
  startWeek: number;
  weeksCommitted: number;
  /** Lucky-number amounts. More than one is normal for a bigger contributor. */
  numbers: number[];
  status: "ACTIVE" | "CLOSED";
  closedAtWeek: number | null;
  breaks: ScenarioBreak[];
  payments: ScenarioPayment[];
  payouts: ScenarioPayout[];
};

export type Scenario = {
  name: string;
  seed: number;
  startDate: Date;
  /** What the cycle SAID it would be. Rule D-5: the rows may outrun it. */
  plannedWeeks: number;
  unitAmount: number;
  feePercent: number;
  today: Date;
  weeks: { weekNumber: number; date: Date; isSkipped: boolean }[];
  members: ScenarioMember[];
};

const WEEK_MS = 7 * 86_400_000;

/** Week rows at seven-day spacing from the start date. Rule 7: dates are stored. */
export function weekRows(
  startDate: Date,
  count: number,
  skipped: readonly number[] = [],
): { weekNumber: number; date: Date; isSkipped: boolean }[] {
  return Array.from({ length: count }, (_, i) => ({
    weekNumber: i + 1,
    date: new Date(startDate.getTime() + i * WEEK_MS),
    isSkipped: skipped.includes(i + 1),
  }));
}

/**
 * `today`, positioned relative to a week row rather than to the start date.
 *
 * `offsetDays` past week N's own date. The distance between "the week has
 * arrived" and "its payment window has closed" is exactly where the week-14
 * bug lived, so scenarios have to be able to sit inside it: 0-4 days past a
 * week is arrived-but-open, 5+ is closed.
 */
export function todayAt(
  weeks: readonly { weekNumber: number; date: Date }[],
  weekNumber: number,
  offsetDays: number,
): Date {
  const w = weeks.find((x) => x.weekNumber === weekNumber);
  if (!w) throw new Error(`no week ${weekNumber} in this scenario`);
  return new Date(w.date.getTime() + offsetDays * 86_400_000);
}

// ————————————————— Adapters into the real functions —————————————————
//
// Each of these builds the exact input shape one production function takes,
// from the scenario. They are the ONLY place the harness knows those shapes,
// so a change to a signature breaks here rather than in twenty tests.

/** A member's own week rows, in the shape computeStanding/memberTruth take. */
export function windowWeeksOf(s: Scenario, m: ScenarioMember) {
  const finish = m.startWeek + m.weeksCommitted - 1;
  return s.weeks
    .filter((w) => w.weekNumber >= m.startWeek && w.weekNumber <= finish)
    .map((w) => {
      const p = m.payments.find((x) => x.weekNumber === w.weekNumber);
      return {
        weekNumber: w.weekNumber,
        date: w.date,
        amountDue: m.weeklyAmount,
        storedPaid: p?.amountPaid ?? 0,
        isDeferred: p?.isDeferred ?? false,
        isSkipped: w.isSkipped,
        markedLate: p?.markedLate ?? false,
      };
    });
}

export const totalPaidOf = (m: ScenarioMember) =>
  m.payments.reduce((sum, p) => sum + p.amountPaid, 0);

/** The participation shape `receiptsByWeek` and `memberAttention` take. */
export function countedOf(s: Scenario) {
  return s.members.map((m) => ({
    id: m.id,
    name: m.name,
    weeklyAmount: m.weeklyAmount,
    startWeek: m.startWeek,
    weeksCommitted: m.weeksCommitted,
    breaks: m.breaks,
  }));
}

/** Every receipt, flattened — the shape the per-week series takes. */
export function flatPaymentsOf(s: Scenario) {
  return s.members.flatMap((m) =>
    m.payments.map((p) => ({
      participationId: m.id,
      weekNumber: p.weekNumber,
      amountPaid: p.amountPaid,
      isDeferred: p.isDeferred,
      markedLate: p.markedLate,
      isSkipped: s.weeks.find((w) => w.weekNumber === p.weekNumber)?.isSkipped ?? false,
    })),
  );
}

/**
 * Every payout, priced through the SAME rule the draw uses: the number's own
 * amount times THAT member's committed weeks, less the cycle's fee percent.
 *
 * Never a fixed twenty weeks and never a fixed 2% (§2.6, §2.30). A first pass
 * at a real reconciliation assumed both and was $35,000 out.
 */
export function payoutsOf(s: Scenario) {
  return s.members.flatMap((m) =>
    m.payouts.map((po) => {
      const amount = m.numbers[po.numberIndex];
      const gross = amount * m.weeksCommitted;
      const fee = calculateFee(gross, s.feePercent);
      return {
        participationId: m.id,
        weekNumber: po.weekNumber,
        numberIndex: po.numberIndex,
        grossAmount: gross,
        feeAmount: fee,
        netAmount: calculateNet(gross, fee),
        status: po.status,
      };
    }),
  );
}

/** Undrawn numbers of members still in — what is still to go OUT. */
export function undrawnPayoutsOf(s: Scenario) {
  return s.members
    .filter((m) => m.status === "ACTIVE")
    .flatMap((m) =>
      m.numbers
        .map((amount, i) => ({ amount, i }))
        .filter(({ i }) => !m.payouts.some((po) => po.numberIndex === i))
        .map(({ amount }) => {
          const gross = amount * m.weeksCommitted;
          const fee = calculateFee(gross, s.feePercent);
          return { gross, fee, net: calculateNet(gross, fee) };
        }),
    );
}

// ————————————————— Builders —————————————————

export type MemberSpec = Partial<Omit<ScenarioMember, "id" | "name">> & {
  id: string;
  name: string;
};

/** A member with sane defaults, so a scenario states only what it varies. */
export function member(spec: MemberSpec): ScenarioMember {
  return {
    weeklyAmount: 50_000,
    startWeek: 1,
    weeksCommitted: 20,
    numbers: [spec.weeklyAmount ?? 50_000],
    status: "ACTIVE",
    closedAtWeek: null,
    breaks: [],
    payments: [],
    payouts: [],
    ...spec,
  };
}

/** Pay `weeks` in full, at the member's own rate. */
export function paysWeeks(m: ScenarioMember, weeks: readonly number[]): ScenarioMember {
  return {
    ...m,
    payments: [
      ...m.payments,
      ...weeks.map((weekNumber) => ({
        weekNumber,
        amountPaid: m.weeklyAmount,
        isDeferred: false,
        markedLate: false,
      })),
    ],
  };
}

/** Pay part of one week — the PARTIAL case, and PARTIAL+LATE once it closes. */
export function paysPartial(m: ScenarioMember, weekNumber: number, amount: number): ScenarioMember {
  return {
    ...m,
    payments: [...m.payments, { weekNumber, amountPaid: amount, isDeferred: false, markedLate: false }],
  };
}

/** A week the organizer PAUSED. Not chased, still owed (§2.29a). */
export function defers(m: ScenarioMember, weekNumber: number): ScenarioMember {
  const existing = m.payments.find((p) => p.weekNumber === weekNumber);
  return {
    ...m,
    payments: existing
      ? m.payments.map((p) => (p.weekNumber === weekNumber ? { ...p, isDeferred: true } : p))
      : [...m.payments, { weekNumber, amountPaid: 0, isDeferred: true, markedLate: false }],
  };
}

/** The organizer's own late mark, before the window closed (§2.29). */
export function marksLate(m: ScenarioMember, weekNumber: number): ScenarioMember {
  const existing = m.payments.find((p) => p.weekNumber === weekNumber);
  return {
    ...m,
    payments: existing
      ? m.payments.map((p) => (p.weekNumber === weekNumber ? { ...p, markedLate: true } : p))
      : [...m.payments, { weekNumber, amountPaid: 0, isDeferred: false, markedLate: true }],
  };
}

/** Drawn: a payout against one of their numbers. */
export function drawn(
  m: ScenarioMember,
  weekNumber: number,
  numberIndex = 0,
  status: "PENDING" | "COLLECTED" = "COLLECTED",
): ScenarioMember {
  return { ...m, payouts: [...m.payouts, { numberIndex, weekNumber, status }] };
}

/**
 * Stopped at `atWeek` — the break is a HOLE opening the week after (rule 17).
 *
 * Both directions are expressible, and the difference is whether they were
 * drawn first: drawn-then-stopped leaves a hole the organizer must cover;
 * never-drawn-stopped leaves money owed BACK to them (§2.30).
 */
export function stops(m: ScenarioMember, atWeek: number): ScenarioMember {
  return {
    ...m,
    status: "CLOSED",
    closedAtWeek: atWeek,
    breaks: [...m.breaks, { fromWeek: atWeek + 1, toWeek: null }],
  };
}

/** Stopped, brought back, and stopped again — two holes, which is why it is a table. */
export function stopsResumesStops(m: ScenarioMember, first: number, resumeAt: number, second: number) {
  return {
    ...m,
    status: "CLOSED" as const,
    closedAtWeek: second,
    breaks: [
      ...m.breaks,
      { fromWeek: first + 1, toWeek: resumeAt - 1 },
      { fromWeek: second + 1, toWeek: null },
    ],
  };
}

export function scenario(spec: {
  name: string;
  seed: number;
  plannedWeeks: number;
  /** Rows may outrun the plan — rule D-5, and the live cycle already does. */
  weekCount?: number;
  unitAmount?: number;
  feePercent?: number;
  startDate?: Date;
  skippedWeeks?: readonly number[];
  members: ScenarioMember[];
  /** Which week `today` sits in, and how far past its own date. */
  todayWeek: number;
  todayOffsetDays?: number;
}): Scenario {
  const startDate = spec.startDate ?? new Date("2026-01-04T00:00:00.000Z");
  const weeks = weekRows(startDate, spec.weekCount ?? spec.plannedWeeks, spec.skippedWeeks ?? []);
  return {
    name: spec.name,
    seed: spec.seed,
    startDate,
    plannedWeeks: spec.plannedWeeks,
    unitAmount: spec.unitAmount ?? 100_000,
    feePercent: spec.feePercent ?? 2,
    today: todayAt(weeks, spec.todayWeek, spec.todayOffsetDays ?? 6),
    weeks,
    members: spec.members,
  };
}

// ————————————————— Leak reporting (Phase E) —————————————————

/**
 * THE SUNDAY-CHECK VOICE.
 *
 * A bare assertion diff says two numbers differ. The organizer's question is
 * always "where did this number come from" — so a failure here names the
 * figure, both routes, the gap, and WHICH module produced the leaking side.
 * That is the whole point of the suite: it says where the pipe leaked.
 */
export function leak(input: {
  figure: string;
  scenario: Scenario;
  /** The module whose number is under suspicion. */
  module: string;
  /** The independent route — usually plain arithmetic over the receipts. */
  byHand: number;
  /** What the module said. */
  bySystem: number;
  member?: string;
  week?: number;
  note?: string;
}): string {
  const money = (c: number) =>
    (c < 0 ? "-" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  const where = [
    input.member ? `member ${input.member}` : null,
    input.week !== undefined ? `week ${input.week}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    `\n  ${input.module} disagrees with the receipts about ${input.figure}` +
    (where ? ` for ${where}` : "") +
    `.\n` +
    `    by hand (receipts)   ${money(input.byHand)}\n` +
    `    ${input.module.padEnd(20)} ${money(input.bySystem)}\n` +
    `    leak                 ${money(input.bySystem - input.byHand)}\n` +
    `    scenario "${input.scenario.name}" seed ${input.scenario.seed}, ` +
    `${input.scenario.members.length} members, ${input.scenario.weeks.length} week rows, ` +
    `fee ${input.scenario.feePercent}%\n` +
    (input.note ? `    ${input.note}\n` : "")
  );
}

// ————————————————— The matrix —————————————————

/** Small: five members, eight weeks. Every figure checkable by eye. */
export function smallCycle(seed = 1): Scenario {
  const r = rng(seed);
  const members = [
    paysWeeks(member({ id: "m1", name: "Abeba", weeklyAmount: 25_000, weeksCommitted: 8 }), [1, 2, 3, 4]),
    paysPartial(
      paysWeeks(member({ id: "m2", name: "Bekele", weeklyAmount: 25_000, weeksCommitted: 8 }), [1, 2]),
      3,
      10_000,
    ),
    member({ id: "m3", name: "Chaltu", weeklyAmount: 50_000, weeksCommitted: 8 }),
    drawn(
      paysWeeks(member({ id: "m4", name: "Dawit", weeklyAmount: 25_000, weeksCommitted: 8 }), [1, 2, 3, 4, 5]),
      3,
    ),
    paysWeeks(member({ id: "m5", name: "Eyob", weeklyAmount: 25_000, weeksCommitted: 8 }), [1, 2, 3, 4, 5, 6]),
  ];
  void r;
  return scenario({
    name: "small — 5 members, 8 weeks",
    seed,
    plannedWeeks: 8,
    feePercent: 3,
    unitAmount: 25_000,
    members,
    todayWeek: 5,
    todayOffsetDays: 6,
  });
}

/**
 * Production-shaped: 25 members, 20 weeks, mixed commitments, a Tsion and an
 * Alem. This is the shape every real defect has appeared in.
 */
export function productionCycle(seed = 2): Scenario {
  const r = rng(seed);
  const rates = [25_000, 50_000, 62_500, 100_000, 175_000, 200_000];
  const members: ScenarioMember[] = [];

  for (let i = 0; i < 23; i++) {
    const weekly = pick(r, rates);
    // Mixed commitments — the Henok (10-week) and Alex (15-week) case that
    // broke a real reconciliation when everyone was assumed to be on 20.
    const weeksCommitted = i === 3 ? 10 : i === 7 ? 15 : 20;
    const startWeek = i === 11 ? 6 : 1;
    // A member over the unit holds more than one number, at unit size.
    const numbers =
      weekly > 100_000 ? [100_000, weekly - 100_000] : [weekly];
    let m = member({
      id: `p${i}`,
      name: `Member${i}`,
      weeklyAmount: weekly,
      weeksCommitted,
      startWeek,
      numbers,
    });
    const finish = Math.min(startWeek + weeksCommitted - 1, 14);
    const behaviour = r();
    if (behaviour < 0.55) {
      m = paysWeeks(m, range(startWeek, finish));
    } else if (behaviour < 0.75) {
      m = paysWeeks(m, range(startWeek, Math.max(startWeek, finish - 3)));
    } else if (behaviour < 0.9) {
      m = paysPartial(m, finish, Math.floor(weekly / 2));
      m = paysWeeks(m, range(startWeek, finish - 1));
    } else {
      m = paysWeeks(m, range(startWeek, finish + 2));
    }
    if (i === 5) m = defers(m, 9);
    if (i === 6) m = marksLate(m, 12);
    if (i < 8) m = drawn(m, i + 2);
    members.push(m);
  }

  // ALEM: drawn, then stopped. The hole is the organizer's to cover.
  members.push(
    stops(
      drawn(paysWeeks(member({ id: "alem", name: "Alem", weeklyAmount: 50_000 }), range(1, 7)), 4),
      7,
    ),
  );
  // TSION: never drawn, then stopped. She is owed paid-in less the fee.
  members.push(
    stops(paysWeeks(member({ id: "tsion", name: "Tsion", weeklyAmount: 75_000 }), range(1, 6)), 6),
  );

  return scenario({
    name: "production — 25 members, 20 weeks, mixed commitments",
    seed,
    plannedWeeks: 20,
    members,
    todayWeek: 14,
    todayOffsetDays: 2, // ARRIVED, window still OPEN — the week-14 shape.
  });
}

/**
 * Stress: everyone partial, a rate change mid-cycle, a late joiner, a
 * multi-number member, a skipped week, a stop-resume-stop.
 */
export function stressCycle(seed = 3): Scenario {
  // §2.14's worked example, verbatim: six weeks at $250, then the rate moves
  // to $500. $1,500 ÷ $500 = 3 weeks credited → three weeks behind.
  const rateChange = member({
    id: "rate",
    name: "RateChange",
    weeklyAmount: 50_000, // the NEW rate — money ÷ CURRENT rate is the rule
    weeksCommitted: 20,
  });
  const rateChanged: ScenarioMember = {
    ...rateChange,
    payments: range(1, 6).map((weekNumber) => ({
      weekNumber,
      amountPaid: 25_000, // what they actually paid, at the old rate
      isDeferred: false,
      markedLate: false,
    })),
  };

  const members = [
    rateChanged,
    paysPartial(member({ id: "late", name: "LateJoiner", startWeek: 7, weeksCommitted: 14 }), 7, 20_000),
    member({
      id: "multi",
      name: "MultiNumber",
      weeklyAmount: 250_000,
      numbers: [100_000, 100_000, 50_000],
    }),
    stopsResumesStops(
      paysWeeks(member({ id: "yoyo", name: "StopResumeStop" }), [1, 2, 3, 9, 10]),
      3,
      9,
      10,
    ),
    defers(paysPartial(member({ id: "part", name: "Partial" }), 4, 20_000), 5),
    drawn(marksLate(paysWeeks(member({ id: "won", name: "Winner" }), range(1, 11)), 12), 6),
  ];

  return scenario({
    name: "stress — rate change, late joiner, multi-number, stop-resume-stop",
    seed,
    plannedWeeks: 20,
    feePercent: 2.5,
    unitAmount: 100_000,
    skippedWeeks: [8],
    members,
    todayWeek: 12,
    todayOffsetDays: 6,
  });
}

/**
 * THE LIVE SHAPE — a cycle that has outrun its plan.
 *
 * 23 week rows against 20 planned, sitting at week 21, arrears still
 * resolving, members finishing at different weeks. This is the actual state of
 * the production cycle, and it is the fixture for BOTH the past-planned-end
 * partition case and rule D-5. One scenario, two invariants, no duplicate.
 */
export function pastPlannedEndCycle(seed = 4): Scenario {
  const members = [
    paysWeeks(member({ id: "full", name: "Finished", weeksCommitted: 20 }), range(1, 20)),
    paysWeeks(member({ id: "short", name: "TenWeek", weeksCommitted: 10 }), range(1, 10)),
    paysWeeks(member({ id: "behind", name: "StillBehind", weeksCommitted: 20 }), range(1, 16)),
    paysWeeks(
      member({ id: "joiner", name: "JoinedLate", startWeek: 4, weeksCommitted: 20 }),
      range(4, 21),
    ),
    stops(paysWeeks(member({ id: "gone", name: "Stopped", weeksCommitted: 20 }), range(1, 9)), 9),
  ];
  return scenario({
    name: "past planned end — 23 rows against 20 planned, at week 21",
    seed,
    plannedWeeks: 20,
    weekCount: 23,
    members,
    todayWeek: 21,
    todayOffsetDays: 6,
  });
}

export function range(from: number, to: number): number[] {
  if (to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The matrix, as run. Deterministic seeds so a failure reproduces. */
export function allScenarios(): Scenario[] {
  return [smallCycle(1), productionCycle(2), stressCycle(3), pastPlannedEndCycle(4)];
}

/**
 * The same scenario at every interesting position of the clock.
 *
 * C3 runs the partition over these: the first week, the middle, the last, and
 * one past the planned end. The bug it guards lived at exactly one of them.
 */
export function atEveryClockPosition(s: Scenario): { label: string; scenario: Scenario }[] {
  const last = s.weeks[s.weeks.length - 1].weekNumber;
  const positions: [string, number, number][] = [
    ["first week, window open", 1, 2],
    ["first week, window closed", 1, 6],
    ["mid cycle, window open", Math.ceil(last / 2), 2],
    ["mid cycle, window closed", Math.ceil(last / 2), 6],
    ["last row, window open", last, 2],
    ["last row, window closed", last, 6],
  ];
  if (last > s.plannedWeeks) {
    positions.push(["past the planned end", s.plannedWeeks + 1, 3]);
  }
  return positions.map(([label, week, offset]) => ({
    label,
    scenario: { ...s, today: todayAt(s.weeks, week, offset) },
  }));
}
