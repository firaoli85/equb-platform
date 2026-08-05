// Behavioral check: the presentationMode setting PERSISTS in the database.
// Writes true, reads it back, writes false, reads it back, and leaves the
// setting OFF (its default). Touches only the settings row — no cycle data.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { getSetting, setSetting } = await import("../lib/settings");
const { prisma } = await import("../lib/prisma");

const before = await getSetting("presentationMode");
console.log(`before: ${before}`);

await setSetting("presentationMode", true);
const on = await getSetting("presentationMode");
if (on !== true) throw new Error(`expected true after set, got ${on}`);
const row = await prisma.setting.findUnique({ where: { key: "presentationMode" } });
console.log(`persisted row: ${row?.key} = ${row?.value}`);

await setSetting("presentationMode", false);
const off = await getSetting("presentationMode");
if (off !== false) throw new Error(`expected false after set, got ${off}`);

console.log("OK: presentationMode persists (true -> read true, false -> read false); left OFF.");
await prisma.$disconnect();
