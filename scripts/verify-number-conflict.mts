// BEHAVIOURAL VERIFICATION for "a number already in use is a choice, not a
// dead end" — against the LIVE database, on a SYNTHETIC cycle. No real member
// or number is touched, and the fixture is removed at the end either way.
//
//   npx tsx scripts/verify-number-conflict.mts
//
// WHY THIS EXISTS. The pure half (who holds it, whether it can be taken, what
// KEEP would assign) is unit-tested in lib/lucky-numbers.test.ts. The DATABASE
// half is not testable there: the two-step park in renumberHolder exists
// because @@unique([cycleId, number]) is checked per statement rather than
// deferred, and only a real Postgres unique index can prove it.
//
// It also proves the rule is the SAME on both paths. The choice was built on
// the member profile's number rows and nowhere else, so the add-member wizard
// — where most numbers are first assigned — still answered "Number 22 is
// already taken in this cycle".

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { findNumberHolder, renumberHolder, swapNumbers, takenNumbers } =
  await import("../lib/number-conflict");
const { chooseAutoNumbers, describeNumberConflict } = await import("../lib/lucky-numbers");

const TAG = "NumberConflict Fixture";
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function wipe() {
  const people = await prisma.person.findMany({
    where: { nameEnglishLast: TAG },
    select: { id: true },
  });
  for (const p of people) {
    await prisma.participation.deleteMany({ where: { personId: p.id } });
    await prisma.ledgerEntry.deleteMany({ where: { personId: p.id } });
  }
  await prisma.cycle.deleteMany({ where: { name: TAG } });
  await prisma.person.deleteMany({ where: { nameEnglishLast: TAG } });
}

/**
 * Two members: Holder has #10 and #11, Rival has #20.
 *
 * THIS FIXTURE HID TWO REAL BUGS, and the shape is why. With #1..#9 free,
 * "the next free number" was never the contested one, so the create-path
 * REPLACE looked correct when it was not. A real cycle numbers sequentially
 * from 1 (lib/lucky-numbers.ts), so nothing below is free — which is the case
 * the SEQUENTIAL section at the end of this script now covers.
 */
async function build() {
  const cycle = await prisma.cycle.create({
    data: {
      name: TAG,
      startDate: new Date(Date.UTC(2026, 0, 4)),
      plannedWeeks: 4,
      unitAmount: 100_000,
      feePercent: 2,
      status: "DRAFT",
      weeks: {
        create: [0, 1, 2, 3].map((i) => ({
          weekNumber: i + 1,
          date: new Date(Date.UTC(2026, 0, 4 + i * 7)),
        })),
      },
    },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });

  const mk = async (first: string, numbers: number[]) => {
    const person = await prisma.person.create({
      data: { nameAmharic: first, nameEnglishFirst: first, nameEnglishLast: TAG },
    });
    const participation = await prisma.participation.create({
      data: {
        cycleId: cycle.id,
        personId: person.id,
        weeklyAmount: 100_000 * numbers.length,
        startWeek: 1,
        weeksCommitted: 4,
      },
    });
    for (const number of numbers) {
      await prisma.luckyNumber.create({
        data: { cycleId: cycle.id, participationId: participation.id, number, amount: 100_000 },
      });
    }
    return { person, participation };
  };

  const holder = await mk("Holder", [10, 11]);
  const rival = await mk("Rival", [20]);
  return { cycle, holder, rival };
}

async function main() {
  await wipe();
  const { cycle, holder } = await build();

  console.log("\nThe conflict names WHO holds the number\n");
  const found = await prisma.$transaction(async (tx) =>
    findNumberHolder(tx, { cycleId: cycle.id, number: 10 }),
  );
  check("a taken number resolves to its holder", found?.memberName === "Holder", String(found?.memberName));
  check("and to the number itself", found?.number === 10);
  check("undrawn, so REPLACE is allowed", found?.drawn === false && found?.payoutCount === 0);

  const free = await prisma.$transaction(async (tx) =>
    findNumberHolder(tx, { cycleId: cycle.id, number: 999 }),
  );
  check("a free number has no holder", free === null);

  console.log("\nKEEP names a number that is actually free\n");
  const taken = await prisma.$transaction(async (tx) => takenNumbers(tx, cycle.id));
  const described = describeNumberConflict({ number: 10, holder: found!, taken });
  check("the message names the holder", described.message.includes("Holder"));
  check("REPLACE is offered", described.replaceRefusal === null);
  check(
    `the suggested number (#${described.suggestedNumber}) is genuinely free`,
    !taken.has(described.suggestedNumber),
    `taken = ${[...taken].sort((a, b) => a - b).join(",")}`,
  );

  console.log("\nREPLACE moves the holder — through a real unique index\n");
  const landedOn = await prisma.$transaction(async (tx) =>
    renumberHolder(tx, { cycleId: cycle.id, holder: found!, reserve: [10] }),
  );
  const after = await prisma.luckyNumber.findMany({
    where: { cycleId: cycle.id },
    select: { number: true, participation: { select: { person: { select: { nameEnglishFirst: true } } } } },
    orderBy: { number: "asc" },
  });
  const byNumber = new Map(after.map((n) => [n.number, n.participation.person.nameEnglishFirst]));
  check("#10 is now free", !byNumber.has(10), `#10 held by ${byNumber.get(10)}`);
  check(`the holder landed on #${landedOn}`, byNumber.get(landedOn) === "Holder");
  check("their OTHER number is untouched", byNumber.get(11) === "Holder");
  check("the rival is untouched", byNumber.get(20) === "Rival");
  check("nothing was duplicated", after.length === 3, `${after.length} numbers`);
  check(
    "the park value did not survive",
    !byNumber.has(Math.max(...taken) + 1) || landedOn === Math.max(...taken) + 1,
  );

  console.log("\nA DRAWN number cannot be taken — only KEEP is offered\n");
  const slot = await prisma.slot.create({
    data: {
      cycleId: cycle.id,
      position: 1,
      members: { create: [{ luckyNumberId: (await prisma.luckyNumber.findFirstOrThrow({ where: { cycleId: cycle.id, number: 11 } })).id }] },
    },
  });
  const week = await prisma.week.findFirstOrThrow({ where: { cycleId: cycle.id, weekNumber: 1 } });
  await prisma.draw.create({ data: { weekId: week.id, slotId: slot.id } });

  const drawnHolder = await prisma.$transaction(async (tx) =>
    findNumberHolder(tx, { cycleId: cycle.id, number: 11 }),
  );
  check("the holder reads as DRAWN", drawnHolder?.drawn === true);
  const drawnConflict = describeNumberConflict({
    number: 11,
    holder: drawnHolder!,
    taken: await prisma.$transaction(async (tx) => takenNumbers(tx, cycle.id)),
  });
  check("REPLACE is refused", drawnConflict.replaceRefusal !== null);
  check(
    "and the refusal says WHY, in the organizer's terms",
    (drawnConflict.replaceRefusal ?? "").includes("already been drawn"),
    drawnConflict.replaceRefusal ?? "",
  );
  check("KEEP still offers a free number", !(await prisma.$transaction(async (tx) => takenNumbers(tx, cycle.id))).has(drawnConflict.suggestedNumber));

  // ————————————————————————————————————————————————————————————————
  // THE NUMBERING CHOICE, in the organizer's words: "fresh numbers assign
  // incrementally from 1 with manual override available; carry-over reuses
  // previous numbers WHERE FREE."
  //
  // The pure half is unit-tested. What is NOT testable there is that
  // carry-over is PER NUMBER rather than all-or-nothing: someone who held #40
  // and #41 last cycle and finds #41 taken must keep #40 and get the next free
  // value for the second. Losing both because one clashed was never the rule.
  // ————————————————————————————————————————————————————————————————
  console.log("\nThe numbering choice — carry-over is per number, not all-or-nothing\n");

  const second = await prisma.cycle.create({
    data: {
      name: TAG,
      startDate: new Date(Date.UTC(2026, 5, 7)),
      plannedWeeks: 4,
      unitAmount: 100_000,
      feePercent: 2,
      status: "DRAFT",
    },
  });
  // Someone already holds #41 in the new cycle, so only #40 can carry over.
  const squatter = await prisma.person.create({
    data: { nameAmharic: "Squatter", nameEnglishFirst: "Squatter", nameEnglishLast: TAG },
  });
  const squatterPart = await prisma.participation.create({
    data: {
      cycleId: second.id,
      personId: squatter.id,
      weeklyAmount: 100_000,
      startWeek: 1,
      weeksCommitted: 4,
    },
  });
  await prisma.luckyNumber.create({
    data: { cycleId: second.id, participationId: squatterPart.id, number: 41, amount: 100_000 },
  });

  const takenInSecond = await prisma.$transaction(async (tx) => takenNumbers(tx, second.id));
  const carried = chooseAutoNumbers({
    count: 2,
    taken: takenInSecond,
    preferred: [40, 41],
  });
  check("the free previous number is kept", carried.includes(40), carried.join(","));
  check("the taken one is NOT reused", !carried.includes(41), carried.join(","));
  check("and its replacement is genuinely free", !takenInSecond.has(carried[1]), carried.join(","));
  check("exactly the right count is assigned", carried.length === 2);

  const fresh = chooseAutoNumbers({ count: 2, taken: takenInSecond });
  check(
    "FRESH mode counts up from 1, reusing gaps",
    fresh[0] === 1 && fresh[1] === 2,
    fresh.join(","),
  );

  // ————————————————————————————————————————————————————————————————
  // THE CASE THE ORIGINAL FIXTURE HID.
  //
  // Everything above ran on a cycle numbered 10, 11, 20 — so #1..#9 were free
  // and "the next free number" was never the contested one. A real cycle is
  // numbered sequentially from 1, and on that shape BOTH replace paths were
  // dead:
  //
  //   the SWAP moved the holder onto a number this row still held → P2002 →
  //     "Number N is already taken in this cycle", the exact dead end the
  //     feature exists to replace;
  //   the CREATE path renumbered the holder straight back onto the contested
  //     number, so the member who asked for it still could not have it.
  //
  // Both are reproduced here on 1, 2, 3 — no gaps, nothing free below.
  // ————————————————————————————————————————————————————————————————
  console.log("\nA SEQUENTIALLY NUMBERED cycle — nothing free below\n");

  const third = await prisma.cycle.create({
    data: {
      name: TAG,
      startDate: new Date(Date.UTC(2026, 8, 6)),
      plannedWeeks: 4,
      unitAmount: 100_000,
      feePercent: 2,
      status: "DRAFT",
    },
  });
  const seqMk = async (name: string, numbers: number[]) => {
    const person = await prisma.person.create({
      data: { nameAmharic: name, nameEnglishFirst: name, nameEnglishLast: TAG },
    });
    const part = await prisma.participation.create({
      data: {
        cycleId: third.id,
        personId: person.id,
        weeklyAmount: 100_000 * numbers.length,
        startWeek: 1,
        weeksCommitted: 4,
      },
    });
    for (const n of numbers) {
      await prisma.luckyNumber.create({
        data: { cycleId: third.id, participationId: part.id, number: n, amount: 100_000 },
      });
    }
    return part;
  };
  await seqMk("Abebe", [1, 2]);
  await seqMk("Meheret", [3]);

  // THE SWAP: Abebe edits his #1 to #3, which Meheret holds. REPLACE must
  // leave Abebe on #3 and Meheret on #1 — nobody without a number.
  let swapError: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const moving = await tx.luckyNumber.findFirstOrThrow({
        where: { cycleId: third.id, number: 1 },
      });
      const h = await findNumberHolder(tx, { cycleId: third.id, number: 3 });
      await swapNumbers(tx, {
        cycleId: third.id,
        moving: { luckyNumberId: moving.id, from: 1 },
        holder: h!,
      });
    });
  } catch (e) {
    swapError = e instanceof Error ? e.message : String(e);
  }
  check("the SWAP completes against a real unique index", swapError === null, swapError ?? "");

  const swapped = new Map(
    (
      await prisma.luckyNumber.findMany({
        where: { cycleId: third.id },
        select: {
          number: true,
          participation: { select: { person: { select: { nameEnglishFirst: true } } } },
        },
      })
    ).map((n) => [n.number, n.participation.person.nameEnglishFirst]),
  );
  check("the mover took the contested number", swapped.get(3) === "Abebe", String(swapped.get(3)));
  check("the holder took the vacated one", swapped.get(1) === "Meheret", String(swapped.get(1)));
  check("nobody was left without a number", swapped.size === 3, `${swapped.size} numbers`);
  check("the mover's OTHER number is untouched", swapped.get(2) === "Abebe");

  // THE CREATE PATH: a new member claims #3 with nothing free below it.
  const landedSeq = await prisma.$transaction(async (tx) => {
    const h = await findNumberHolder(tx, { cycleId: third.id, number: 3 });
    return renumberHolder(tx, { cycleId: third.id, holder: h!, reserve: [3] });
  });
  check(
    `the holder did NOT land back on the contested number (landed on #${landedSeq})`,
    landedSeq !== 3,
    `landed on #${landedSeq}`,
  );
  const freedNow = await prisma.luckyNumber.findFirst({
    where: { cycleId: third.id, number: 3 },
  });
  check("#3 is genuinely free for the new member", freedNow === null);
}

try {
  await main();
} finally {
  await wipe();
  const left = await prisma.cycle.count({ where: { name: TAG } });
  const leftPeople = await prisma.person.count({ where: { nameEnglishLast: TAG } });
  console.log(`\nFixtures remaining: ${left} cycle(s), ${leftPeople} person(s)`);
  if (left > 0 || leftPeople > 0) failures += 1;
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
