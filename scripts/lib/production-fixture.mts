// A SYNTHETIC CYCLE THAT LOOKS LIKE THE REAL ONE.
//
// WHY THIS EXISTS. A verification fixture is only as good as its resemblance to
// production, and the last one proved it the expensive way: it numbered three
// members #10, #11 and #20, so #1–#9 were always free. "The next free number"
// was therefore never the contested number, and two dead code paths — the
// REPLACE swap and the REPLACE-on-create — passed their checks and were
// reported as working. A real cycle numbers sequentially from 1 with no gaps,
// which is exactly the shape both bugs needed.
//
// So this builds the shape of Cycle 1 2026:
//
//   27 members, numbers SEQUENTIAL FROM 1 with no gaps
//   four of them contribute above the unit and therefore hold TWO numbers
//     (the split is what makes weeklyAmount != luckyNumber.amount — the exact
//      state the fee bug hid in, invisible on the 23 single-number members)
//   20 weeks with real stored dates
//   several weeks DRAWN, with real payouts, real settlement receipts, and a
//     mix of COLLECTED and PENDING
//   receipts that are full, partial and missing, plus a deferral
//   one member who joined late, one carrying a balance
//
// Everything is tagged and removed by `wipe()`. No real member, week, number,
// receipt or payout is read or written.

import type { PrismaClient } from "../../lib/generated/prisma/client";

export const FIXTURE_TAG = "ProductionShape Fixture";

/** $1,000 unit, matching the live cycle. */
export const UNIT = 100_000;
export const FEE_PERCENT = 2;
export const PLANNED_WEEKS = 20;
export const MEMBER_COUNT = 27;

/** Members who contribute above the unit hold more than one number. */
const DOUBLE_CONTRIBUTORS = new Set([2, 5, 11, 19]);

export type FixtureMember = {
  index: number;
  personId: string;
  participationId: string;
  name: string;
  weeklyAmount: number;
  numbers: { id: string; number: number; amount: number }[];
};

export type Fixture = {
  cycleId: string;
  weeks: { id: string; weekNumber: number; date: Date }[];
  members: FixtureMember[];
  /** Weeks that were drawn, with the payouts created on them. */
  draws: {
    weekNumber: number;
    drawId: string;
    slotId: string;
    payouts: { id: string; number: number; net: number; status: "PENDING" | "COLLECTED" }[];
  }[];
};

export async function wipe(prisma: PrismaClient): Promise<void> {
  const people = await prisma.person.findMany({
    where: { nameEnglishLast: FIXTURE_TAG },
    select: { id: true },
  });
  for (const p of people) {
    await prisma.participation.deleteMany({ where: { personId: p.id } });
    await prisma.ledgerEntry.deleteMany({ where: { personId: p.id } });
  }
  await prisma.cycle.deleteMany({ where: { name: { startsWith: FIXTURE_TAG } } });
  await prisma.person.deleteMany({ where: { nameEnglishLast: FIXTURE_TAG } });
}

/** Anything left over is a failure of the script, not of the code under test. */
export async function assertClean(prisma: PrismaClient): Promise<number> {
  const cycles = await prisma.cycle.count({ where: { name: { startsWith: FIXTURE_TAG } } });
  const people = await prisma.person.count({ where: { nameEnglishLast: FIXTURE_TAG } });
  return cycles + people;
}

export async function build(
  prisma: PrismaClient,
  options: { name?: string; status?: "DRAFT" | "ACTIVE" } = {},
): Promise<Fixture> {
  const cycleName = options.name ?? FIXTURE_TAG;
  // DRAFT unless asked otherwise: a partial unique index permits exactly one
  // ACTIVE cycle and the organizer's real one holds it.
  const cycle = await prisma.cycle.create({
    data: {
      name: cycleName,
      startDate: new Date(Date.UTC(2026, 4, 17)),
      plannedWeeks: PLANNED_WEEKS,
      unitAmount: UNIT,
      feePercent: FEE_PERCENT,
      status: options.status ?? "DRAFT",
      weeks: {
        create: Array.from({ length: PLANNED_WEEKS }, (_, i) => ({
          weekNumber: i + 1,
          date: new Date(Date.UTC(2026, 4, 17 + i * 7)),
        })),
      },
    },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });

  // ————— Members, with numbers running 1..N with NO GAPS —————
  const members: FixtureMember[] = [];
  let nextNumber = 1;
  for (let i = 1; i <= MEMBER_COUNT; i += 1) {
    const holdsTwo = DOUBLE_CONTRIBUTORS.has(i);
    const weeklyAmount = holdsTwo ? UNIT * 2 : UNIT;
    // One late joiner, to keep the window arithmetic honest.
    const startWeek = i === MEMBER_COUNT ? 6 : 1;
    const weeksCommitted = i === MEMBER_COUNT ? PLANNED_WEEKS - 5 : PLANNED_WEEKS;

    const person = await prisma.person.create({
      data: {
        nameAmharic: `አባል${i}`,
        nameEnglishFirst: `Member${String(i).padStart(2, "0")}`,
        nameEnglishLast: FIXTURE_TAG,
        phone: `+1555000${String(1000 + i).slice(-4)}`,
      },
    });
    const participation = await prisma.participation.create({
      data: {
        cycleId: cycle.id,
        personId: person.id,
        weeklyAmount,
        startWeek,
        weeksCommitted,
      },
    });

    const numbers: FixtureMember["numbers"] = [];
    for (let k = 0; k < (holdsTwo ? 2 : 1); k += 1) {
      const created = await prisma.luckyNumber.create({
        data: {
          cycleId: cycle.id,
          participationId: participation.id,
          number: nextNumber,
          amount: UNIT,
        },
      });
      numbers.push({ id: created.id, number: created.number, amount: created.amount });
      nextNumber += 1;
    }

    members.push({
      index: i,
      personId: person.id,
      participationId: participation.id,
      name: person.nameEnglishFirst,
      weeklyAmount,
      numbers,
    });
  }

  // ————— Receipts: full, partial, missing, deferred —————
  //
  // Weeks 1..7 have happened. Most members paid them; a few are short; one
  // week is deferred for one member. This is what makes the derived figures
  // (paid in, still to save, overdue) non-trivial.
  const ELAPSED = 7;
  for (const m of members) {
    const firstWeek = m.index === MEMBER_COUNT ? 6 : 1;
    for (let w = firstWeek; w <= ELAPSED; w += 1) {
      const week = cycle.weeks[w - 1];
      // Member 3 stops paying after week 4 — the carried-balance shape.
      if (m.index === 3 && w > 4) continue;
      // Member 8 pays week 5 short.
      const amount = m.index === 8 && w === 5 ? m.weeklyAmount / 2 : m.weeklyAmount;
      const payment = await prisma.payment.create({
        data: {
          participationId: m.participationId,
          weekId: week.id,
          amountPaid: amount,
          // Member 12's week 6 is deferred — excused, still owed.
          isDeferred: m.index === 12 && w === 6,
        },
      });
      const event = await prisma.paymentEvent.create({
        data: {
          participationId: m.participationId,
          amount,
          receivedAt: new Date(week.date.getTime() + 2 * 86_400_000),
          idempotencyKey: `${FIXTURE_TAG}:${cycle.id}:${m.participationId}:${w}`,
        },
      });
      await prisma.paymentAllocation.create({
        data: { eventId: event.id, paymentId: payment.id, amount },
      });
    }
  }

  // ————— Draws on weeks 1..6, with settlements —————
  //
  // Each drawn week has a slot holding one or two numbers, a real Payout per
  // number priced from lib/wheel's arithmetic, and the winner's own week
  // settled out of that payout — the pair that several money bugs live in.
  const draws: Fixture["draws"] = [];
  const drawPlan: { week: number; memberIndexes: number[] }[] = [
    { week: 1, memberIndexes: [1] },
    { week: 2, memberIndexes: [2] }, // a TWO-number member
    { week: 3, memberIndexes: [4, 6] }, // two winners in one week
    { week: 4, memberIndexes: [7] },
    { week: 5, memberIndexes: [9] },
    { week: 6, memberIndexes: [10] },
  ];

  for (const [position, plan] of drawPlan.entries()) {
    const week = cycle.weeks[plan.week - 1];
    const winners = plan.memberIndexes.map((i) => members[i - 1]);
    const slot = await prisma.slot.create({
      data: {
        cycleId: cycle.id,
        position: position + 1,
        members: {
          create: winners.flatMap((m) => m.numbers.map((n) => ({ luckyNumberId: n.id }))),
        },
      },
    });
    const draw = await prisma.draw.create({ data: { weekId: week.id, slotId: slot.id } });

    const payouts: Fixture["draws"][number]["payouts"] = [];
    for (const m of winners) {
      for (const n of m.numbers) {
        const gross = n.amount * (m.index === MEMBER_COUNT ? PLANNED_WEEKS - 5 : PLANNED_WEEKS);
        const fee = Math.round((gross * FEE_PERCENT) / 100);
        // The winner does not pay the week they win: their own contribution is
        // settled out of the payout, and netAmount is decremented by it.
        const settlement = n.amount;
        const net = gross - fee - settlement;
        // Weeks 1-4 collected; 5 and 6 still pending — so a status filter
        // matters, which is exactly what closeCycle was missing.
        const status = plan.week <= 4 ? "COLLECTED" : "PENDING";
        const payout = await prisma.payout.create({
          data: {
            luckyNumberId: n.id,
            drawId: draw.id,
            grossAmount: gross,
            feeAmount: fee,
            netAmount: net,
            status,
            ...(status === "COLLECTED" ? { paidAt: week.date } : {}),
          },
        });
        const settlementEvent = await prisma.paymentEvent.create({
          data: {
            participationId: m.participationId,
            amount: settlement,
            receivedAt: week.date,
            pinnedWeekId: week.id,
            settlementPayoutId: payout.id,
            notes: `Week ${plan.week} contribution settled from the payout — the winner does not pay the week they win`,
            idempotencyKey: `${FIXTURE_TAG}:settle:${payout.id}`,
          },
        });
        // The pinned receipt lands on that week only.
        const own = await prisma.payment.findFirst({
          where: { participationId: m.participationId, weekId: week.id },
        });
        if (own) {
          await prisma.paymentAllocation.create({
            data: { eventId: settlementEvent.id, paymentId: own.id, amount: settlement },
          });
        }
        payouts.push({ id: payout.id, number: n.number, net, status });
      }
    }
    draws.push({ weekNumber: plan.week, drawId: draw.id, slotId: slot.id, payouts });
  }

  // ————— A carried balance on the person who stopped paying —————
  await prisma.ledgerEntry.create({
    data: {
      personId: members[2].personId,
      type: "DEBT",
      amount: UNIT * 3,
      description: `${cycleName} — 3 weeks unpaid`,
      occurredAt: new Date(Date.UTC(2026, 5, 21)),
    },
  });

  return {
    cycleId: cycle.id,
    weeks: cycle.weeks.map((w) => ({ id: w.id, weekNumber: w.weekNumber, date: w.date })),
    members,
    draws,
  };
}
