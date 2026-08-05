// Core money logic for the Equb platform. Pure functions only — no database,
// no I/O. All money values are integer CENTS (ground truth 2.14: money is the
// truth; everything else is derived at read time and never stored).
//
// Date convention: week arithmetic runs on UTC calendar days. Cycle start
// dates are stored as UTC midnight (from <input type="date">), and UTC has no
// DST, so "7 days apart" is always exactly 7 * 24 hours.

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

/** Postgres Int4 ceiling for stored cents — a database limit, not a business rule. */
export const MAX_MONEY_CENTS = 2_147_483_647;

/** Sanity guard on week counts (~19 years of weekly cycles) — abuse protection, not configuration. */
export const MAX_WEEKS = 1_000;

/** More lucky numbers than this per member means the unit amount is misconfigured. */
export const MAX_LUCKY_NUMBERS_PER_MEMBER = 100;

function assertCents(name: string, cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`${name} must be an integer number of cents, got ${cents}`);
  }
  if (cents < 0) {
    throw new RangeError(`${name} must not be negative, got ${cents}`);
  }
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

function assertValidDate(name: string, date: Date): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}

/** The UTC calendar day of a date, as a timestamp at UTC midnight. */
function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Split a weekly contribution into the amounts its lucky numbers carry.
 * At or below the unit -> one number. Above the unit -> full-unit numbers
 * plus a remainder number.
 *
 * e.g. unit 100000: 50000 -> [50000]; 125000 -> [100000, 25000];
 *      200000 -> [100000, 100000]; 175000 -> [100000, 75000]
 */
export function splitIntoLuckyNumbers(weeklyAmount: number, unitAmount: number): number[] {
  assertPositiveInt("weeklyAmount", weeklyAmount);
  assertPositiveInt("unitAmount", unitAmount);
  if (weeklyAmount <= unitAmount) return [weeklyAmount];
  const fullUnits = Math.floor(weeklyAmount / unitAmount);
  const remainder = weeklyAmount % unitAmount;
  const count = fullUnits + (remainder > 0 ? 1 : 0);
  if (count > MAX_LUCKY_NUMBERS_PER_MEMBER) {
    throw new RangeError(
      `${weeklyAmount} cents at a unit of ${unitAmount} cents would create ${count} lucky numbers (max ${MAX_LUCKY_NUMBERS_PER_MEMBER}) — raise the unit amount`,
    );
  }
  const amounts = new Array<number>(fullUnits).fill(unitAmount);
  if (remainder > 0) amounts.push(remainder);
  return amounts;
}

/** Total a member contributes over their committed weeks, in cents. */
export function calculateGross(weeklyAmount: number, weeksCommitted: number): number {
  assertCents("weeklyAmount", weeklyAmount);
  if (!Number.isSafeInteger(weeksCommitted) || weeksCommitted < 0) {
    throw new RangeError(`weeksCommitted must be a non-negative integer, got ${weeksCommitted}`);
  }
  const gross = weeklyAmount * weeksCommitted;
  if (!Number.isSafeInteger(gross)) {
    throw new RangeError(`gross overflows safe integer range: ${weeklyAmount} * ${weeksCommitted}`);
  }
  return gross;
}

/**
 * Organizer fee in cents: feePercent of gross, rounded to the nearest cent
 * (half-cent ties round up). Computed in integer basis points so floating
 * point can never misround a tie; percents are supported to 2 decimal places.
 */
export function calculateFee(gross: number, feePercent: number): number {
  assertCents("gross", gross);
  if (!Number.isFinite(feePercent) || feePercent < 0) {
    throw new RangeError(`feePercent must be a non-negative finite number, got ${feePercent}`);
  }
  const basisPoints = Math.round(feePercent * 100);
  return Math.round((gross * basisPoints) / 10_000);
}

/** What the member actually receives, in cents. */
export function calculateNet(gross: number, fee: number): number {
  assertCents("gross", gross);
  assertCents("fee", fee);
  if (fee > gross) {
    throw new RangeError(`fee (${fee}) must not exceed gross (${gross})`);
  }
  return gross - fee;
}

/**
 * The week a participation finishes, inclusive. Derived, never stored.
 * startWeek must be >= 1 — a join can never start before week 1 (D-20).
 */
export function calculateFinishWeek(startWeek: number, weeksCommitted: number): number {
  assertPositiveInt("startWeek", startWeek);
  assertPositiveInt("weeksCommitted", weeksCommitted);
  return startWeek + weeksCommitted - 1;
}

/**
 * How many weeks remain from startWeek through the planned end, inclusive.
 * Ground truth 2.22 / D-31: a late joiner's commitment is CAPPED to this by
 * default — joining at week 15 of 20 offers at most 6 weeks, finishing with
 * everyone else. 0 when startWeek is already past the planned end. Only an
 * explicit organizer override may exceed it.
 */
export function remainingWeeksInCycle(plannedWeeks: number, startWeek: number): number {
  assertPositiveInt("plannedWeeks", plannedWeeks);
  assertPositiveInt("startWeek", startWeek);
  return Math.max(0, plannedWeeks - startWeek + 1);
}

/** The date of every week in a cycle: startDate, then 7 days apart. */
export function generateWeekDates(startDate: Date, plannedWeeks: number): Date[] {
  assertValidDate("startDate", startDate);
  assertPositiveInt("plannedWeeks", plannedWeeks);
  if (plannedWeeks > MAX_WEEKS) {
    throw new RangeError(`plannedWeeks must be at most ${MAX_WEEKS}, got ${plannedWeeks}`);
  }
  return Array.from(
    { length: plannedWeeks },
    (_, i) => new Date(startDate.getTime() + i * DAYS_PER_WEEK * MS_PER_DAY),
  );
}

/**
 * The calendar date of a given week number: startDate for week 1, then 7
 * days per week. Valid past the planned end (2.7/2.22 — override weeks keep
 * the same rhythm). The organizer never calculates a date by hand.
 */
export function dateOfWeek(startDate: Date, weekNumber: number): Date {
  assertValidDate("startDate", startDate);
  assertPositiveInt("weekNumber", weekNumber);
  return new Date(startDate.getTime() + (weekNumber - 1) * DAYS_PER_WEEK * MS_PER_DAY);
}

/**
 * The current week number, derived from the calendar (ground truth 2.14:
 * never hardcoded, never stored). Week 1 is the start date through day 6.
 * Returns 0 if the cycle has not started yet. Runs past plannedWeeks when
 * reality runs long (ground truth 2.7: track the truth).
 */
export function currentWeekNumber(startDate: Date, today: Date): number {
  assertValidDate("startDate", startDate);
  assertValidDate("today", today);
  const dayDiff = Math.floor((utcDay(today) - utcDay(startDate)) / MS_PER_DAY);
  if (dayDiff < 0) return 0;
  return Math.floor(dayDiff / DAYS_PER_WEEK) + 1;
}
