// The wheel's pure logic. No DB, no I/O, injectable randomness.
//
// Laws implemented here:
//   2.2  — organizer discretion: planned winners take precedence, silently.
//   2.3  — the plan is LOCKED: drawn numbers and committed numbers are
//          frozen; auto-arrange and reshuffle can never move or re-pair
//          them. (This defect shipped twice in the old app — pinned by
//          tests here.)
//   2.27 — a number is drawable only while its owner's window is open; it
//          leaves the pool when drawn or when the window ends, and members
//          approaching an undrawn window-end produce a mandatory warning.

import { calculateFee, calculateFinishWeek, calculateNet } from "./money";

export type WheelNumber = {
  id: string;
  number: number;
  /** Cents this number carries. */
  amount: number;
  participationId: string;
};

export type WheelParticipation = {
  id: string;
  name: string;
  startWeek: number;
  weeksCommitted: number;
  status: "ACTIVE" | "CLOSED";
};

// ————————————————— Pool eligibility (2.27) —————————————————

/**
 * The numbers currently in the pool: owner ACTIVE, owner's window open at
 * the current week, and not yet drawn.
 */
export function eligibleNumbers(input: {
  luckyNumbers: readonly WheelNumber[];
  participations: readonly WheelParticipation[];
  drawnNumberIds: ReadonlySet<string>;
  currentWeek: number;
}): WheelNumber[] {
  const byId = new Map(input.participations.map((p) => [p.id, p]));
  return input.luckyNumbers.filter((n) => {
    if (input.drawnNumberIds.has(n.id)) return false;
    const owner = byId.get(n.participationId);
    if (!owner || owner.status !== "ACTIVE") return false;
    const finishWeek = calculateFinishWeek(owner.startWeek, owner.weeksCommitted);
    return owner.startWeek <= input.currentWeek && input.currentWeek <= finishWeek;
  });
}

export type UndrawnWarning = {
  participationId: string;
  name: string;
  finishWeek: number;
  /** Weeks until their window closes; 0 or negative = already closing/closed. */
  weeksLeft: number;
  numbers: number[];
};

/**
 * The mandatory 2.27 safeguard: members whose window ends within
 * `weeksAhead` weeks (or has already ended) and who have NOT been drawn.
 * Everyone receives exactly once — nobody may be quietly missed.
 */
export function undrawnWindowWarnings(input: {
  luckyNumbers: readonly WheelNumber[];
  participations: readonly WheelParticipation[];
  drawnNumberIds: ReadonlySet<string>;
  currentWeek: number;
  weeksAhead: number;
}): UndrawnWarning[] {
  const numbersByOwner = new Map<string, WheelNumber[]>();
  for (const n of input.luckyNumbers) {
    (numbersByOwner.get(n.participationId) ?? numbersByOwner.set(n.participationId, []).get(n.participationId)!).push(n);
  }
  const warnings: UndrawnWarning[] = [];
  for (const p of input.participations) {
    if (p.status !== "ACTIVE") continue;
    if (p.startWeek > input.currentWeek) continue; // not started yet
    const numbers = numbersByOwner.get(p.id) ?? [];
    if (numbers.length === 0) continue;
    if (numbers.some((n) => input.drawnNumberIds.has(n.id))) continue; // drawn
    const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
    const weeksLeft = finishWeek - input.currentWeek;
    if (weeksLeft > input.weeksAhead) continue;
    warnings.push({
      participationId: p.id,
      name: p.name,
      finishWeek,
      weeksLeft,
      numbers: numbers.map((n) => n.number).sort((a, b) => a - b),
    });
  }
  return warnings.sort((a, b) => a.weeksLeft - b.weeksLeft);
}

// ————————————————— Winner-plan shape (2.3) —————————————————

export type WinnerPlanMode = "ALONE" | "TOGETHER" | "OPEN_PARTNER";

/**
 * The organizer's own words for a mode — the exact labels on the setup
 * control, so a refusal quotes the thing he clicked.
 *
 * Every sentence he reads is built from here, never from the enum. The
 * confirmation used to be assembled as `Commit ${picked} as ${planMode}?`
 * and read "Commit #3 + #7 as ALONE?" — a database word, describing a plan
 * the server was about to build as a pair.
 */
export function winnerPlanModeLabel(mode: WinnerPlanMode): string {
  return mode === "ALONE"
    ? "Win alone"
    : mode === "TOGETHER"
      ? "Win together (same week)"
      : "Open partner";
}

/**
 * "#3", "#3 and #7", "#3, #7 and #9" — or a bare count when the caller has
 * ids only.
 *
 * Falls back to the count unless the labels cover the WHOLE selection. A
 * ticked number that has since been deleted resolves to nothing on the setup
 * page, and "you picked #3" over a two-number selection would under-report
 * what the button was about to send.
 */
function pickedLabel(count: number, numbers?: readonly number[]): string {
  if (!numbers || numbers.length !== count) return `${count} number${count === 1 ? "" : "s"}`;
  const sorted = [...numbers].sort((a, b) => a - b).map((n) => `#${n}`);
  // EMPTY IS ITS OWN CASE, and leaving it out produced a sentence shown to the
  // organizer: with no numbers, `slice(0, -1)` is empty and `sorted[-1]` is
  // undefined, so the join built "Commit  and undefined to win alone?".
  //
  // Reachable, not theoretical. `winnerPlanConfirmation` calls this as
  // `pickedLabel(numbers.length, numbers)` — the two arguments are the same
  // fact, so the guard on the line above CANNOT fire there, and the setup page
  // renders that sentence live under the control the moment a ticked id fails
  // to resolve to a number.
  if (sorted.length === 0) return "no numbers";
  if (sorted.length === 1) return sorted[0];
  return `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/**
 * HOW MANY NUMBERS EACH MODE TAKES — and why "Win alone" REFUSES a second
 * one rather than quietly splitting the selection into several plans.
 *
 * THE DEFECT. `createWinnerPlan` validated arity for TOGETHER (< 2 refused)
 * and OPEN_PARTNER (!== 1 refused) and had no ALONE branch at all. It then
 * created ONE slot and wrote EVERY picked id into it whatever the mode. So
 * selecting #3 and #7, choosing "Win alone" and pressing Create plan
 * committed them as a PAIR winning the SAME week — the exact opposite of
 * what the organizer had just declared, with no refusal anywhere and a
 * confirmation that agreed with him on the way past. Nothing covered a
 * multi-number ALONE plan.
 *
 * "Alone" with several numbers picked has two honest readings: refuse and
 * ask for one at a time, or write one plan per number. THE SECOND IS NOT
 * SOMETHING THIS SYSTEM CAN SAY, and the reasons are structural:
 *
 *   1. A WEEK HOLDS AT MOST ONE PLAN. `createWinnerPlan` refuses a second
 *      plan on an assigned week; `selectWinningSlot` below reads a week's
 *      plan with `.find()`, which takes the FIRST match; `recordDraw` and
 *      `restoreFulfilledPlan` both use `findFirst`. Two plans on one week is
 *      not a shape any of those can read, so N alone-plans would need N
 *      DIFFERENT weeks.
 *   2. AND THE COMMIT CONTROL OFFERS EXACTLY ONE WEEK. Splitting the
 *      selection would therefore have to drop the week he had just chosen
 *      from every plan but one — with no rule saying which one keeps it —
 *      leaving the rest committed to no week at all. 2.3 is explicit that a
 *      plan carries WHICH WEEK, and that the Brain must know intent rather
 *      than invent it. A plan that silently loses its week is the system
 *      deciding something he did not say.
 *
 * So ALONE takes exactly one number, and the refusal carries the way
 * forward: commit them one at a time, a week each. That costs nothing — the
 * numbers stay pickable, and the week dropdown already hides weeks that hold
 * a plan, so the second commit cannot collide with the first.
 *
 * OPEN_PARTNER has always carried this same rule for this same reason (a
 * plan pins one anchor). ALONE now matches it.
 *
 * Returns null when the selection is committable, otherwise the refusal.
 * ONE home, because the setup page states it before the round trip and the
 * server enforces it after — two copies would be two chances to disagree
 * about what the organizer was told (§5.10).
 */
export function winnerPlanArityRefusal(input: {
  mode: WinnerPlanMode;
  /** How many distinct numbers are selected. */
  count: number;
  /**
   * The lucky NUMBERS, when the caller has them. The setup page does; the
   * action holds ids at the point it checks. Named in the refusal so the
   * organizer reads his own selection back instead of a bare count.
   */
  numbers?: readonly number[];
}): string | null {
  const { mode, count } = input;
  if (count === 0) return "Pick at least one number.";
  const picked = pickedLabel(count, input.numbers);
  if (mode === "ALONE" && count > 1) {
    return (
      `"${winnerPlanModeLabel("ALONE")}" means one number wins by itself, so it takes ` +
      `exactly one — you picked ${picked}. Commit them one at a time, choosing a week ` +
      `for each, or choose "${winnerPlanModeLabel("TOGETHER")}" if they should share a week.`
    );
  }
  if (mode === "TOGETHER" && count < 2) {
    return (
      `"${winnerPlanModeLabel("TOGETHER")}" means two or more numbers share one week — ` +
      `you picked ${picked}. Add another number, or choose ` +
      `"${winnerPlanModeLabel("ALONE")}" if it wins by itself.`
    );
  }
  if (mode === "OPEN_PARTNER" && count !== 1) {
    return (
      `"${winnerPlanModeLabel("OPEN_PARTNER")}" plans one number and lets the shuffle ` +
      `attach a partner to it, so it takes exactly one — you picked ${picked}. Commit ` +
      `them one at a time, or choose "${winnerPlanModeLabel("TOGETHER")}" if these ` +
      `should share a week.`
    );
  }
  return null;
}

/**
 * What the confirmation says before the plan is written.
 *
 * It read `Commit #3 + #7 as ALONE?` — wrong twice over: the database's word
 * for the mode, and a description of a plan the action was about to build as
 * a pair. A confirmation that misdescribes the write is worse than none,
 * because the organizer approves it. Built from the same labels as the
 * refusal, and from the numbers that will actually be in the plan.
 */
export function winnerPlanConfirmation(input: {
  mode: WinnerPlanMode;
  numbers: readonly number[];
  /** null when no week is assigned yet — said plainly, never left blank. */
  weekNumber?: number | null;
}): { title: string; effect: string } {
  // `numbers.length` for the count on purpose: this is the confirmation, and
  // it names exactly the numbers going into the plan. The under-report guard
  // in `pickedLabel` belongs to the REFUSAL, which is told a count from the
  // ticked set and can therefore be handed fewer labels than it has ids.
  const list = pickedLabel(input.numbers.length, input.numbers);
  const week =
    input.weekNumber === null || input.weekNumber === undefined
      ? "a week you assign later"
      : `week ${input.weekNumber}`;
  if (input.mode === "ALONE") {
    return {
      title: `Commit ${list} to win alone?`,
      // True because a committed number's slot is frozen whole: reshuffle
      // skips it, moveNumber refuses a drop into it, and validateArrangement
      // demands it arrive byte-identical. That is the whole difference from
      // "Open partner", so the sentence has to state it.
      effect: `${list} wins ${week} by itself — nothing else can join that slot.`,
    };
  }
  if (input.mode === "TOGETHER") {
    return {
      title: `Commit ${list} to win together, in the same week?`,
      effect: `${list} win ${week} together, in one slot.`,
    };
  }
  return {
    title: `Commit ${list}, open to one partner?`,
    effect: `${list} wins ${week}, and the shuffle may attach one other number to its slot.`,
  };
}

// ————————————————— Winner selection (2.2 / 2.3) —————————————————

export type EligibleSlot = { id: string; luckyNumberIds: readonly string[] };
export type ActivePlan = {
  id: string;
  weekId: string | null;
  luckyNumberIds: readonly string[];
};

export type WinnerSelection = {
  slotId: string;
  /** For the AUDIT LOG only — the reason never reaches any UI (2.4). */
  reason: "planned" | "random";
  planId?: string;
};

/**
 * The server-side decision: a plan committed to this week decides the
 * winner; otherwise a uniformly random eligible slot. The reason is
 * recorded for the audit trail and never surfaced to a screen.
 */
export function selectWinningSlot(input: {
  eligibleSlots: readonly EligibleSlot[];
  winnerPlans: readonly ActivePlan[];
  weekId: string;
  random?: () => number;
}): WinnerSelection {
  if (input.eligibleSlots.length === 0) {
    throw new Error("No eligible slots to draw from.");
  }
  const plan = input.winnerPlans.find((p) => p.weekId === input.weekId);
  if (plan) {
    // A plan with NO numbers must never decide a draw. `[].every(...)` is
    // vacuously true, so an emptied plan would match the FIRST eligible slot
    // and rig the week — recorded in the audit log as an intentional "planned"
    // win rather than a spin. Plans are emptied by cascade, not by the
    // organizer: WinnerPlanNumber cascades when a LuckyNumber is deleted, so
    // removing a member or a number can hollow one out. They are purged at
    // source (lib/draw-cascade purgeEmptyWinnerPlans); this refuses to act on
    // one that slipped through.
    if (plan.luckyNumberIds.length === 0) {
      throw new Error(
        "The winner plan for this week has no numbers left in it — cancel or rebuild the plan on the setup page before drawing.",
      );
    }
    const slot = input.eligibleSlots.find((s) =>
      plan.luckyNumberIds.every((id) => s.luckyNumberIds.includes(id)),
    );
    if (!slot) {
      throw new Error(
        "The winner planned for this week is not sitting together in an eligible slot — fix the arrangement on the setup page first.",
      );
    }
    return { slotId: slot.id, reason: "planned", planId: plan.id };
  }

  // A NUMBER COMMITTED TO ANOTHER WEEK IS OUT OF THIS WEEK'S POOL.
  //
  // Ground truth 2.3: "Committed numbers are treated exactly like already-drawn
  // numbers: excluded from the shuffle pool, their slot frozen." That was
  // implemented for the SHUFFLE and not for the SPIN, so chance could consume a
  // number the organizer had committed to a later week.
  //
  // What that cost: plan #5 for week 15; weeks are drawn in order so week 12
  // comes up next; no plan targets week 12, so the spin rolled over every
  // eligible slot — including #5's. Chance lands on it. `recordDraw` consults
  // only the plan for the week being drawn, so nothing cancels or marks plan
  // P. It sits PLANNED, targeting week 15, holding a number that is already
  // drawn — a row that has outlived its own possibility. When week 15 arrives
  // the plan cannot find its numbers in any eligible slot and throws, and
  // because that happens on the SHARED draw screen the organizer sees only the
  // neutral error (2.4). Week 15 cannot be spun at all until someone leaves
  // the Zoom call and cancels the plan.
  //
  // A plan with no week assigned commits nothing to any week and never blocks.
  const committedElsewhere = new Set(
    input.winnerPlans
      .filter((p) => p.weekId !== null && p.weekId !== input.weekId)
      .flatMap((p) => p.luckyNumberIds),
  );
  const spinnable = input.eligibleSlots.filter(
    (s) => !s.luckyNumberIds.some((id) => committedElsewhere.has(id)),
  );
  if (spinnable.length === 0) {
    // Said plainly, because the operational screens show it privately and the
    // draw screen must never explain itself (2.4).
    throw new Error(
      "Every slot still on the wheel is committed to a later week, so there is nobody left " +
        "for this one to land on. Cancel or re-week a plan on the setup page first.",
    );
  }

  const random = input.random ?? Math.random;
  const index = Math.floor(random() * spinnable.length);
  return { slotId: spinnable[Math.min(index, spinnable.length - 1)].id, reason: "random" };
}

// ————————————————— Draw-screen display order (2.4, audit H3c) —————————————————

/**
 * Deterministic shuffled order for the DRAW SCREEN. A planned winner's slot
 * is created last, so raw position order would show it as the final wheel
 * segment every single week — visible to the naked eye on Zoom. Seeding by
 * the week keeps the wheel identical across reloads within one draw while
 * decorrelating position from creation order.
 */
export function displayOrder<T>(slots: readonly T[], seed: string): T[] {
  // String hash → mulberry32 PRNG: stable across runtimes, no Math.random.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return fisherYates(slots, random);
}

// ————————————————— Arrangement (2.3 frozen, over-unit flagged) —————————————————

export type ProposedSlot = {
  luckyNumberIds: string[];
  numbers: number[];
  total: number;
  /** Over the unit amount: allowed but flagged — guidance, not obstruction. */
  overUnit: boolean;
  /** Seeded by an OPEN_PARTNER commitment; the anchor stays, partners vary. */
  anchored?: boolean;
};

function fisherYates<T>(items: readonly T[], random: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function packIntoSlots(
  pool: readonly WheelNumber[],
  unitAmount: number,
  seeds: { anchor: WheelNumber }[],
  random: () => number,
): ProposedSlot[] {
  const shuffled = fisherYates(pool, random);
  const slots: { members: WheelNumber[]; total: number; anchored: boolean; open: boolean }[] =
    seeds.map((s) => ({ members: [s.anchor], total: s.anchor.amount, anchored: true, open: true }));
  let current: (typeof slots)[number] | null = null;

  for (const n of shuffled) {
    // Top up an open anchored slot first (OPEN_PARTNER: one random partner).
    const anchored = slots.find((s) => s.anchored && s.open && s.total < unitAmount);
    if (anchored) {
      anchored.members.push(n);
      anchored.total += n.amount;
      anchored.open = false; // "may attach ONE random partner"
      continue;
    }
    if (current === null || current.total >= unitAmount) {
      current = { members: [], total: 0, anchored: false, open: true };
      slots.push(current);
    }
    current.members.push(n);
    current.total += n.amount;
  }

  return slots
    .filter((s) => s.members.length > 0)
    .map((s) => ({
      luckyNumberIds: s.members.map((m) => m.id),
      numbers: s.members.map((m) => m.number).sort((a, b) => a - b),
      total: s.total,
      overUnit: s.total > unitAmount,
      ...(s.anchored ? { anchored: true } : {}),
    }));
}

/** Group unassigned numbers into slots targeting the unit amount. */
export function autoArrange(input: {
  unassignedNumbers: readonly WheelNumber[];
  unitAmount: number;
  /** Drawn or committed ids — excluded outright as defense in depth (2.3). */
  lockedNumberIds?: ReadonlySet<string>;
  random?: () => number;
}): ProposedSlot[] {
  const locked = input.lockedNumberIds ?? new Set<string>();
  const pool = input.unassignedNumbers.filter((n) => !locked.has(n.id));
  return packIntoSlots(pool, input.unitAmount, [], input.random ?? Math.random);
}

export type ReshuffleResult = {
  /** Slots containing drawn or committed numbers — returned EXACTLY as they
   *  were, never touched (2.3). */
  frozenSlotIds: string[];
  proposedSlots: ProposedSlot[];
};

/**
 * Reshuffle everything that is free. A slot containing ANY drawn or
 * ALONE/TOGETHER-committed number is frozen whole — its composition is the
 * organizer's locked intent (or history) and must survive intact.
 * OPEN_PARTNER numbers are anchors: they stay, and the shuffle may attach
 * one random partner.
 */
export function reshuffle(input: {
  slots: readonly { id: string; members: readonly WheelNumber[] }[];
  drawnNumberIds: ReadonlySet<string>;
  committedNumberIds: ReadonlySet<string>;
  anchoredNumberIds?: ReadonlySet<string>;
  unitAmount: number;
  random?: () => number;
}): ReshuffleResult {
  const anchoredIds = input.anchoredNumberIds ?? new Set<string>();
  const frozenSlotIds: string[] = [];
  const pool: WheelNumber[] = [];
  const seeds: { anchor: WheelNumber }[] = [];

  for (const slot of input.slots) {
    const isFrozen = slot.members.some(
      (m) => input.drawnNumberIds.has(m.id) || input.committedNumberIds.has(m.id),
    );
    if (isFrozen) {
      frozenSlotIds.push(slot.id);
      continue;
    }
    for (const member of slot.members) {
      if (anchoredIds.has(member.id)) seeds.push({ anchor: member });
      else pool.push(member);
    }
  }

  return {
    frozenSlotIds,
    proposedSlots: packIntoSlots(pool, input.unitAmount, seeds, input.random ?? Math.random),
  };
}

// ————————————————— Payouts (per lucky number) —————————————————

export type NumberPayout = {
  luckyNumberId: string;
  gross: number;
  fee: number;
  net: number;
};

/**
 * One payout PER LUCKY NUMBER: each number's share is its own amount over
 * its owner's committed weeks, and each person pays their own fee on their
 * own share. (Matches the imported Cycle 1 books exactly: a $1,000 number
 * over 20 weeks grosses $20,000, fee 2% = $400, net $19,600.)
 */
export function calculatePayout(input: {
  luckyNumber: { id: string; amount: number };
  participation: { weeksCommitted: number };
  cycle: { feePercent: number };
}): NumberPayout {
  const gross = input.luckyNumber.amount * input.participation.weeksCommitted;
  if (!Number.isSafeInteger(gross)) {
    throw new RangeError(`payout gross overflows: ${input.luckyNumber.amount} * ${input.participation.weeksCommitted}`);
  }
  const fee = calculateFee(gross, input.cycle.feePercent);
  return { luckyNumberId: input.luckyNumber.id, gross, fee, net: calculateNet(gross, fee) };
}
