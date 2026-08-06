// READ-ONLY: after removing a test fixture, is anything left behind?
// Reports empty slots, draws whose slot has no members, and payouts whose
// lucky number is gone. Deletes nothing.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});

const emptySlots = await prisma.slot.findMany({
  where: { members: { none: {} } },
  include: { draws: { include: { week: true, payouts: true } } },
});
console.log(`Slots with no members: ${emptySlots.length}`);
for (const s of emptySlots) {
  console.log(
    `  slot ${s.id} position ${s.position} — ${s.draws.length} draw(s)` +
      s.draws.map((d) => ` [week ${d.week.weekNumber}, ${d.payouts.length} payout(s)]`).join(""),
  );
}

const people = await prisma.person.count();
const participations = await prisma.participation.count({ where: { status: "ACTIVE" } });
console.log(`\nPeople: ${people} · active participations: ${participations}`);

await prisma.$disconnect();
