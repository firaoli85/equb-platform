// Portal self-test fixture: a LATE-JOINING test member in the active cycle
// (joins at the current week, capped to the cycle end — 2.22), with a phone
// and a PIN so the real login flow can be driven end-to-end.
//
//   npx tsx scripts/portal-test-fixture.mts create   → prints ids
//   npx tsx scripts/portal-test-fixture.mts cleanup  → removes everything
//
// Cleanup deletes the participation (payments/events/lucky numbers cascade)
// and then the person. Nothing else is touched.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../lib/prisma");
const { hashPin } = await import("../lib/pin");
const { currentWeekNumber } = await import("../lib/money");

const PHONE = "+15550009999";
const PIN = "4321";
const NAME_EN = "Portal Test";
const NAME_AM = "የሙከራ አባል";

const mode = process.argv[2];

if (mode === "cleanup") {
  const person = await prisma.person.findFirst({ where: { phone: PHONE, nameEnglishFirst: NAME_EN } });
  if (!person) {
    console.log("Nothing to clean up.");
  } else {
    // Settlement tests may have written ledger entries, and payment tests
    // may have produced message-log rows — both go with the test person
    // (they would otherwise block the delete).
    const ledger = await prisma.ledgerEntry.deleteMany({ where: { personId: person.id } });
    await prisma.messageLog.deleteMany({ where: { personId: person.id } });
    await prisma.participation.deleteMany({ where: { personId: person.id } });
    await prisma.person.delete({ where: { id: person.id } });
    console.log(
      `Removed test person ${person.id}, their participation (cascade), and ${ledger.count} ledger entr${ledger.count === 1 ? "y" : "ies"}.`,
    );
    if (person.authUserId) console.log(`AUTH_USER_TO_DELETE=${person.authUserId}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

const cycle = await prisma.cycle.findFirst({
  where: { status: "ACTIVE" },
  include: { weeks: { orderBy: { weekNumber: "asc" } }, luckyNumbers: true },
});
if (!cycle) throw new Error("No active cycle.");

const week = Math.max(1, currentWeekNumber(cycle.startDate, new Date()));
const startWeek = Math.min(week, cycle.plannedWeeks);
const weeksCommitted = cycle.plannedWeeks - startWeek + 1; // capped (2.22)
const taken = new Set(cycle.luckyNumbers.map((n) => n.number));
let number = 900;
while (taken.has(number)) number += 1;

const existing = await prisma.person.findFirst({ where: { phone: PHONE } });
if (existing) throw new Error(`Phone ${PHONE} already in use by ${existing.id} — clean up first.`);

// "create-nopin" leaves pinHash empty so the phone-digit DEFAULT PIN flow
// can be exercised (last 4 of the phone sign them in).
const person = await prisma.person.create({
  data: {
    nameAmharic: NAME_AM,
    nameEnglishFirst: NAME_EN,
    nameEnglishLast: "Fixture",
    phone: PHONE,
    pinHash: mode === "create-nopin" ? null : await hashPin(PIN),
  },
});
const participation = await prisma.participation.create({
  data: {
    cycleId: cycle.id,
    personId: person.id,
    weeklyAmount: 50000, // $500/wk
    startWeek,
    weeksCommitted,
    luckyNumbers: { create: [{ cycleId: cycle.id, number, amount: 50000 }] },
  },
});

console.log(
  JSON.stringify(
    {
      personId: person.id,
      participationId: participation.id,
      phone: PHONE,
      pin: PIN,
      startWeek,
      weeksCommitted,
      finishWeek: startWeek + weeksCommitted - 1,
      luckyNumber: number,
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
