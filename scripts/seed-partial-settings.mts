// CARRY THE SHARED SWITCH ACROSS TO THE TWO NEW ONES.
//
//   npx tsx scripts/seed-partial-settings.mts            # DRY RUN
//   npx tsx scripts/seed-partial-settings.mts --apply    # writes
//
// WHY THIS IS NEEDED. Until 15 Aug 2026 three payment messages shared one
// setting: `autoSendPartialConfirmed` governed the part-payment confirmation,
// the confirmation-with-an-amount-still-owed, and the part-paid-week-completed
// message. Each now has its own key. On an install that had TURNED THE SHARED
// SWITCH ON, the two new keys would read their shipped default (off) and two
// messages would go quiet on deploy — a behaviour change nobody asked for and
// nobody would see.
//
// So the stored value is COPIED, once. An install that never touched the shared
// switch has no row to copy and correctly stays on the shipped default.
//
// IDEMPOTENT: a key that already has its own stored row is left alone, because
// that row is a decision somebody made and this must never overwrite it.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});

const SOURCE = "autoSendPartialConfirmed";
const TARGETS = ["autoSendPaymentConfirmedWithPartial", "autoSendPartialCompleted"] as const;

console.log(APPLY ? "APPLYING — real writes\n" : "DRY RUN — nothing will be written\n");

const rows = await prisma.setting.findMany({
  where: { key: { in: [SOURCE, ...TARGETS] } },
});
const byKey = new Map(rows.map((r) => [r.key, r]));

const source = byKey.get(SOURCE);
if (!source) {
  console.log(`No stored ${SOURCE} row — this install never changed the shared switch.`);
  console.log("The two new keys correctly keep their shipped default (off). Nothing to do.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`${SOURCE} is stored as ${JSON.stringify(source.value)}\n`);

let planned = 0;
for (const key of TARGETS) {
  const existing = byKey.get(key);
  if (existing) {
    console.log(`  ${key}  already set to ${JSON.stringify(existing.value)} — LEFT ALONE`);
    continue;
  }
  planned += 1;
  console.log(`  ${key}  would be created as ${JSON.stringify(source.value)}`);
}

console.log(`\n${planned} of ${TARGETS.length} rows would be created.`);

if (!APPLY) {
  console.log("\nNothing was written. Re-run with --apply to carry the value across.");
  await prisma.$disconnect();
  process.exit(0);
}

for (const key of TARGETS) {
  if (byKey.has(key)) continue;
  await prisma.setting.create({ data: { key, value: source.value } });
  console.log(`  created ${key} = ${JSON.stringify(source.value)}`);
}

const after = await prisma.setting.findMany({ where: { key: { in: [SOURCE, ...TARGETS] } } });
console.log("\n=== AFTER ===");
for (const r of after) console.log(`  ${r.key} = ${JSON.stringify(r.value)}`);

await prisma.$disconnect();
