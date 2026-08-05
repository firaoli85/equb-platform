// Presentation mode (2.4 / D-6): pure redaction for screen-sharing. When the
// organizer flips the switch, these transforms run SERVER-side so sensitive
// fields are never sent to the browser at all — inspecting the page during a
// Zoom call finds nothing.
//
// Every redactor is an ALLOWLIST: it builds a new object naming exactly what
// survives. A field added to a payload later is dropped here by default
// instead of leaking by default.
//
// Hidden when ON: member names (numbers shown instead), winner plans and any
// committed/planned indicator, money, phone numbers, the audit log.
// Kept: lucky numbers, weeks and dates, slot groupings with COUNTS instead
// of money — everything needed to actually run a draw.

export const PRESENTATION_HIDDEN = "Hidden in presentation mode.";

/** The identity substitute: a member is shown as their lucky numbers only. */
export function numbersLabel(numbers: number[]): string {
  if (numbers.length === 0) return "Member";
  return numbers.map((n) => `#${n}`).join(" + ");
}

// ————————————————— Dashboard —————————————————

type DashboardInput = {
  cycle: { id: string; name: string; plannedWeeks: number };
  currentWeek: number;
  weeksRemaining: number;
  memberCount: number;
  window: { lastOpenDayName: string; daysLeft: number } | null;
  drawsCount: number;
  paidOutCount: number;
  undrawnWarnings: {
    participationId: string;
    name: string;
    finishWeek: number;
    weeksLeft: number;
    numbers: number[];
  }[];
};

export type RedactedDashboard = ReturnType<typeof redactDashboard>;

/**
 * The command center in presentation mode: the cycle's shape and the 2.27
 * warnings (numbers only). No cash position, no series, no member lists,
 * no payouts — those sections render a calm "hidden" notice instead.
 */
export function redactDashboard<T extends DashboardInput>(data: T) {
  return {
    presentation: true as const,
    cycle: { id: data.cycle.id, name: data.cycle.name, plannedWeeks: data.cycle.plannedWeeks },
    currentWeek: data.currentWeek,
    weeksRemaining: data.weeksRemaining,
    memberCount: data.memberCount,
    window: data.window ? { ...data.window } : null,
    drawsCount: data.drawsCount,
    paidOutCount: data.paidOutCount,
    undrawnWarnings: data.undrawnWarnings.map((w) => ({
      participationId: w.participationId,
      name: numbersLabel(w.numbers),
      finishWeek: w.finishWeek,
      weeksLeft: w.weeksLeft,
      numbers: [...w.numbers],
    })),
  };
}

// ————————————————— Payments grid —————————————————

type GridCellShape<S extends string> =
  | { kind: "week"; status: S; storedPaid: number; amountDue: number }
  | { kind: "before-start" }
  | { kind: "after-finish" };

type GridInput<S extends string> = {
  cycleName: string;
  currentCycleWeek: number;
  grid: {
    columns: {
      participationId: string;
      name: string;
      numbersLabel: string;
      startWeek: number;
      finishWeek: number;
      weeksCredited: number;
      outstanding: number;
    }[];
    rows: {
      weekNumber: number;
      date: Date;
      isSkipped: boolean;
      received: number;
      expected: number;
      cells: GridCellShape<S>[];
    }[];
  };
};

/**
 * The grid stays the map (2.15): columns become lucky numbers, cells keep
 * their derived STATUS (the colors still work) but carry no amounts, and
 * the money totals are gone.
 */
export function redactGrid<S extends string>(data: GridInput<S>) {
  return {
    presentation: true as const,
    cycleName: data.cycleName,
    currentCycleWeek: data.currentCycleWeek,
    grid: {
      columns: data.grid.columns.map((c) => ({
        participationId: c.participationId,
        name: c.numbersLabel,
        numbersLabel: c.numbersLabel,
        startWeek: c.startWeek,
        finishWeek: c.finishWeek,
        weeksCredited: c.weeksCredited,
        outstanding: 0,
      })),
      rows: data.grid.rows.map((r) => ({
        weekNumber: r.weekNumber,
        date: r.date,
        isSkipped: r.isSkipped,
        received: 0,
        expected: 0,
        cells: r.cells.map((cell): GridCellShape<S> =>
          cell.kind === "week"
            ? { kind: "week", status: cell.status, storedPaid: 0, amountDue: 0 }
            : cell.kind === "before-start"
              ? { kind: "before-start" }
              : { kind: "after-finish" },
        ),
      })),
    },
    memberWeekly: {} as Record<string, number>,
  };
}

// ————————————————— Week board —————————————————

type BoardMember = {
  participationId: string;
  name: string;
  amountDue: number;
  amountPaidThisWeek: number;
  isDeferred: boolean;
  weeksBehind: number;
  amountOwed: number;
};

type BoardInput = {
  cycleName: string;
  weekNumber: number;
  weekDate: Date;
  isSkipped: boolean;
  currentCycleWeek: number;
  allWeeks: { weekNumber: number; date: Date }[];
  membersPaid: number;
  membersExpected: number;
  windowDaysLeft: number;
  owing: BoardMember[];
  paid: BoardMember[];
};

export type RedactedBoard = ReturnType<typeof redactWeekBoard>;

/**
 * The week list keeps WHO (as numbers) and paid/owing/deferred state — no
 * amounts, no receipts, no owed totals. `nameByParticipation` supplies the
 * numbers label per member (the board rows carry names otherwise).
 */
export function redactWeekBoard<T extends BoardInput>(
  data: T,
  nameByParticipation: (participationId: string) => string,
) {
  const member = (m: BoardMember) => ({
    participationId: m.participationId,
    name: nameByParticipation(m.participationId),
    amountDue: 0,
    amountPaidThisWeek: 0,
    isDeferred: m.isDeferred,
    weeksBehind: m.weeksBehind,
    amountOwed: 0,
  });
  return {
    presentation: true as const,
    cycleName: data.cycleName,
    weekNumber: data.weekNumber,
    weekDate: data.weekDate,
    isSkipped: data.isSkipped,
    currentCycleWeek: data.currentCycleWeek,
    allWeeks: data.allWeeks.map((w) => ({ weekNumber: w.weekNumber, date: w.date })),
    expected: 0,
    receivedTotal: 0,
    membersPaid: data.membersPaid,
    membersExpected: data.membersExpected,
    windowDaysLeft: data.windowDaysLeft,
    owing: data.owing.map(member),
    paid: data.paid.map(member),
    receiptsByParticipation: {} as Record<
      string,
      { eventId: string; appliedHere: number; eventAmount: number; method: string | null }[]
    >,
  };
}

// ————————————————— Wheel setup —————————————————

type WheelNumberShape = {
  id: string;
  number: number;
  amount: number | null;
  owner: string;
  eligible: boolean;
  /** frozen = cannot move at all; anchored = slots-only. */
  lock: "frozen" | "anchored" | null;
  lockReason: string | null;
};

type WheelStateInput = {
  cycleName: string;
  currentWeek: number;
  slots: { id: string; position: number; drawn: boolean; members: WheelNumberShape[] }[];
  unassigned: WheelNumberShape[];
  weeks: { id: string; weekNumber: number; hasDraw: boolean; planned: boolean }[];
  warnings: {
    participationId: string;
    name: string;
    finishWeek: number;
    weeksLeft: number;
    numbers: number[];
  }[];
};

export type RedactedWheelState = ReturnType<typeof redactWheelState>;

/**
 * Wheel setup in presentation mode: numbers and slot groupings stay (counts,
 * not money), plans are NOT sent, and every locked number — drawn, committed,
 * or anchored — collapses into a bare "frozen" lock with no reason. To keep
 * the WHY underivable, the payload also drops every field that would
 * distinguish lock kinds: `eligible` collapses to false on locked numbers
 * (committed numbers stay pool-eligible, drawn ones never do — the pair
 * would name the planned winners) and per-slot `drawn` is not sent (a frozen
 * number in an UNDRAWN slot could only be plan-committed). Anchored numbers
 * become fully frozen (stricter than the real rule; the server still
 * validates the truth).
 */
export function redactWheelState<T extends WheelStateInput>(data: T) {
  const num = (n: WheelNumberShape) => ({
    id: n.id,
    number: n.number,
    amount: null,
    owner: "",
    eligible: n.lock === null ? n.eligible : false,
    lock: n.lock === null ? null : ("frozen" as const),
    lockReason: null,
  });
  return {
    presentation: true as const,
    cycleName: data.cycleName,
    unitAmount: null,
    currentWeek: data.currentWeek,
    slots: data.slots.map((s) => ({
      id: s.id,
      position: s.position,
      drawn: false,
      members: s.members.map(num),
      total: null,
    })),
    unassigned: data.unassigned.map(num),
    plans: [] as never[],
    weeks: data.weeks.map((w) => ({
      id: w.id,
      weekNumber: w.weekNumber,
      hasDraw: w.hasDraw,
      planned: false,
    })),
    warnings: data.warnings.map((w) => ({
      participationId: w.participationId,
      name: numbersLabel(w.numbers),
      finishWeek: w.finishWeek,
      weeksLeft: w.weeksLeft,
      numbers: [...w.numbers],
    })),
  };
}

/**
 * Auto-arrange / reshuffle proposals in presentation mode: the client applies
 * them by id only. Built field-by-field — a spread would carry the `anchored`
 * flag (an OPEN_PARTNER plan indicator) and per-slot money to the browser.
 */
export function redactProposedSlots(slots: { luckyNumberIds: string[] }[]) {
  return slots.map((s) => ({
    luckyNumberIds: [...s.luckyNumberIds],
    numbers: [] as never[],
    total: 0,
    overUnit: false,
  }));
}

// ————————————————— Cycle roster —————————————————

type PersonShape = {
  nameAmharic: string;
  nameEnglishFirst: string;
  nameEnglishLast: string | null;
  phone: string | null;
  notes: string | null;
  authUserId: string | null;
  pinHash: string | null;
  pinFailedAttempts: number;
  pinLockedUntil: Date | null;
  pinLoginAllowed: boolean | null;
};

type CycleDetailInput = {
  unitAmount: number;
  feePercent: number;
  weeks: { notes: string | null }[];
  participations: {
    weeklyAmount: number;
    person: PersonShape;
    luckyNumbers: { number: number; amount: number }[];
  }[];
};

/**
 * The cycle roster keeps its SHAPE (same prisma types) so the page renders
 * unchanged, but every identity field carries the numbers label and every
 * sensitive Person field (phone, auth identity, PIN state) is explicitly
 * blanked — spreading a prisma row must never carry a hidden field through.
 * Money is zeroed; the page hides its money columns via the mode flag so no
 * misleading $0 renders.
 */
export function redactCycleDetail<T extends CycleDetailInput>(detail: T): T {
  return {
    ...detail,
    unitAmount: 0,
    feePercent: 0,
    // Week notes are uncontrolled organizer free text — they can name members
    // or amounts ("skipped — X's payout delayed").
    weeks: detail.weeks.map((w) => ({ ...w, notes: null })),
    participations: detail.participations.map((p) => {
      const label = numbersLabel(p.luckyNumbers.map((n) => n.number));
      const blanked: PersonShape = {
        ...p.person,
        nameAmharic: label,
        nameEnglishFirst: "",
        nameEnglishLast: null,
        phone: null,
        notes: null,
        authUserId: null,
        pinHash: null,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinLoginAllowed: null,
      };
      return {
        ...p,
        weeklyAmount: 0,
        person: blanked,
        luckyNumbers: p.luckyNumbers.map((n) => ({ ...n, amount: 0 })),
      };
    }),
  };
}
