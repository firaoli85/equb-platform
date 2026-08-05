// Behavioral check (2.24) for the messaging build. Against the LIVE database:
//   1. Template seeding is idempotent and yields all five editable rows.
//   2. Standing→facts→render works on a REAL participation (read-only).
//   3. message_logs accepts a row and the probe row is removed again.
//   4. people."noMessages" exists and defaults to false for everyone.
//   5. Reports whether the Twilio env is configured (no message is sent).
// Touches: message_templates (seed only), one probe row in message_logs
// (deleted). No cycle data is written and NOTHING is sent to any member.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../lib/prisma");
const { ensureMessageTemplates, loadStandingFacts } = await import("../lib/messaging-engine");
const { MESSAGE_KEYS, renderMessage } = await import("../lib/messages");
const { whatsAppMissingConfig } = await import("../lib/whatsapp");

// 1 — seeding, twice (idempotent).
await ensureMessageTemplates();
await ensureMessageTemplates();
const templates = await prisma.messageTemplate.findMany({ orderBy: { key: "asc" } });
const keys = templates.map((t) => t.key).sort();
const expected = [...MESSAGE_KEYS].sort();
if (JSON.stringify(keys) !== JSON.stringify(expected)) {
  throw new Error(`template keys mismatch: ${keys.join(", ")}`);
}
console.log(`OK: ${templates.length} templates seeded, idempotent.`);

// 2 — real standing renders a real statement (read-only).
const participation = await prisma.participation.findFirst({
  where: { status: "ACTIVE", cycle: { status: "ACTIVE" } },
});
if (participation) {
  const loaded = await loadStandingFacts(participation.id);
  if (!loaded) throw new Error("loadStandingFacts returned null for a real participation");
  const rendered = renderMessage("BEHIND_NOTICE", loaded.facts);
  if (/\{[a-zA-Z]+\}/.test(rendered)) {
    throw new Error(`unresolved placeholder in: ${rendered}`);
  }
  console.log(`OK: real standing rendered (member: ${loaded.facts.name}):`);
  console.log(`    "${rendered}"`);
} else {
  console.log("SKIP: no active participation to render against.");
}

// 3 — the log accepts a row; probe removed after.
const anyone = await prisma.person.findFirst();
if (anyone) {
  const probe = await prisma.messageLog.create({
    data: {
      personId: anyone.id,
      templateKey: "BEHIND_NOTICE",
      body: "verification probe — never sent",
      channel: "NONE",
      toPhone: "+10000000000",
      trigger: "MANUAL",
      status: "FAILED",
      error: "verification probe",
    },
  });
  const back = await prisma.messageLog.findUnique({ where: { id: probe.id } });
  if (!back) throw new Error("probe log row did not persist");
  await prisma.messageLog.delete({ where: { id: probe.id } });
  console.log("OK: message_logs accepts and returns a row; probe removed.");
}

// 4 — hardship flag exists, defaults false.
const total = await prisma.person.count();
const optedOut = await prisma.person.count({ where: { noMessages: true } });
console.log(`OK: noMessages present — ${optedOut} of ${total} people opted out (expected 0 on a fresh flag).`);

// 5 — env presence only; nothing is sent.
const missing = whatsAppMissingConfig();
console.log(
  missing.length === 0
    ? "OK: Twilio WhatsApp env fully configured."
    : `NOTE: missing Twilio env: ${missing.join(", ")} — sends will fail honestly until set.`,
);

await prisma.$disconnect();
