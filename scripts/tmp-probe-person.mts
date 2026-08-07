import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { prisma } = await import("../lib/prisma");
const PHONE = "+1 202 555 0143";
const existing = await prisma.person.findFirst({ where: { nameEnglishFirst: "DoorProbe" } });
if (existing) { console.log("exists:", existing.id); }
else {
  const p = await prisma.person.create({
    data: { nameAmharic: "የበር ሙከራ", nameEnglishFirst: "DoorProbe", phone: PHONE },
  });
  console.log("created:", p.id);
}
await prisma.$disconnect();
