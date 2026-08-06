// READ-ONLY: what changed in the book recently. Used to explain a moved
// baseline between two runs of the deferral impact report.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { formatMoney } = await import("../lib/format");

const since = new Date(Date.now() - 36 * 60 * 60 * 1000);

const audits = await prisma.auditLog.findMany({
  where: { createdAt: { gte: since } },
  orderBy: { createdAt: "desc" },
  take: 50,
});
console.log(`AUDIT ENTRIES in the last 36h: ${audits.length}`);
for (const a of audits) {
  console.log(`  ${a.createdAt.toISOString()}  ${a.action}  ${(a.summary ?? "").slice(0, 100)}`);
}

const evs = await prisma.paymentEvent.findMany({
  where: { createdAt: { gte: since } },
  include: { participation: { include: { person: true } } },
  orderBy: { createdAt: "desc" },
  take: 25,
});
console.log(`\nPAYMENT EVENTS created in the last 36h: ${evs.length}`);
for (const e of evs) {
  console.log(
    `  ${e.createdAt.toISOString()}  ${e.participation.person.nameEnglishFirst}  ${formatMoney(e.amount)}${e.pinnedWeekId ? "  PINNED" : ""}`,
  );
}

await prisma.$disconnect();
