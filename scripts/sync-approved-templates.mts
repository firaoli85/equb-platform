// REWRITE THE APPROVED MESSAGE TEMPLATE ROWS FROM THE REGISTRY.
//
//   npx tsx scripts/sync-approved-templates.mts            # DRY RUN
//   npx tsx scripts/sync-approved-templates.mts --apply    # writes
//
// THESE ARE REAL WRITES TO THE LIVE PRODUCTION DATABASE. The dry run is the
// default for that reason.
//
// WHAT IT DOES. The registry (lib/whatsapp-templates.ts) holds the Meta-
// approved wording — first the five of 7 August 2026, now the seven-key set
// after the 13 August 2026 switchover (six new/reworked + the unchanged
// cycle-closing statement). Twilio sends by ContentSid, so a stale database
// body is not what members receive; it is what the ORGANIZER reads while
// something else goes out. This makes the two agree, by making the database
// mirror the registry, row for row.
//
// A key that is new to the platform (GROUP_ANNOUNCEMENT, 13 Aug 2026) may
// have no MessageTemplate row yet — it is CREATED from the registry, named
// from DEFAULT_TEMPLATES, in the same transaction.
//
// WHAT IT WILL NOT DO:
//   - touch LOCKOUT_NOTICE, which has no approved template and must not gain
//     one by accident (it is a security message; Twilio Verify is its channel)
//   - proceed if the registry does not hold exactly the expected key count
//   - send anything. This build does not touch the send path at all.
//
// Everything happens in ONE transaction, so a failure anywhere leaves every
// row exactly as it was.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { APPROVED_TEMPLATES, APPROVED_TEMPLATE_KEYS } = await import(
  "../lib/whatsapp-templates"
);
const { MESSAGE_KEYS, DEFAULT_TEMPLATES } = await import("../lib/messages");

class SyncError extends Error {}

function show(row: { key: string; name: string; body: string; metaTemplateSid: string | null }) {
  console.log(`  ${row.key}`);
  console.log(`    name            ${row.name}`);
  console.log(`    metaTemplateSid ${row.metaTemplateSid ?? "(none)"}`);
  console.log(`    body            ${row.body}`);
}

console.log(APPLY ? "APPLYING — real writes to the live database\n" : "DRY RUN — nothing will be written\n");

// ————————————————— BEFORE —————————————————

const before = await prisma.messageTemplate.findMany({ orderBy: { key: "asc" } });
console.log(`=== BEFORE — all ${before.length} MessageTemplate rows ===\n`);
for (const row of before) show(row);

// ————————————————— Guards, before any write —————————————————

const byKey = new Map(before.map((r) => [r.key, r]));
const missing = APPROVED_TEMPLATE_KEYS.filter((k) => !byKey.has(k));
if (missing.length > 0) {
  // 13 Aug 2026: a brand-new approved key (GROUP_ANNOUNCEMENT) has no row
  // until something creates it. This script does, from the registry, in the
  // same transaction as the updates — announced here, proven in AFTER.
  console.log(`\nNew key(s) with no MessageTemplate row yet — will CREATE: ${missing.join(", ")}`);
}
// A DELIBERATE COUNT, RAISED DELIBERATELY. 7 was the 13 Aug 2026 set; the
// phase-4 payment set (15 Aug 2026) adds five. The guard exists so a registry
// that grew by ACCIDENT cannot write rows to the live database, so it is
// bumped when the growth is intended — never widened to a range.
const EXPECTED_APPROVED = 12;
if (APPROVED_TEMPLATE_KEYS.length !== EXPECTED_APPROVED) {
  console.error(`\nREFUSING: the registry holds ${APPROVED_TEMPLATE_KEYS.length} templates, not the 7 of the 13 Aug 2026 set.`);
  await prisma.$disconnect();
  process.exit(1);
}
// LOCKOUT_NOTICE must be present in the platform and absent from the registry.
if (!byKey.has("LOCKOUT_NOTICE")) {
  console.error("\nREFUSING: LOCKOUT_NOTICE is missing from the database entirely.");
  await prisma.$disconnect();
  process.exit(1);
}
if ((APPROVED_TEMPLATE_KEYS as string[]).includes("LOCKOUT_NOTICE")) {
  console.error("\nREFUSING: LOCKOUT_NOTICE has an entry in the approved registry. It has no");
  console.error("approved template and must never gain one by accident.");
  await prisma.$disconnect();
  process.exit(1);
}

const lockoutBefore = byKey.get("LOCKOUT_NOTICE")!;

// ————————————————— What would change —————————————————

console.log(`\n=== PLANNED CHANGES ===\n`);
let changing = 0;
for (const key of APPROVED_TEMPLATE_KEYS) {
  const row = byKey.get(key);
  const t = APPROVED_TEMPLATES[key];
  if (!row) {
    changing += 1;
    console.log(`  ${key}  (CREATE — no row exists)`);
    console.log(`    body            ${t.namedBody}`);
    console.log(`    metaTemplateSid ${t.contentSid}`);
    continue;
  }
  const bodyChanges = row.body !== t.namedBody;
  const sidChanges = row.metaTemplateSid !== t.contentSid;
  if (bodyChanges || sidChanges) changing += 1;
  console.log(`  ${key}${bodyChanges || sidChanges ? "" : "  (already correct)"}`);
  if (bodyChanges) {
    console.log(`    body            ${row.body}`);
    console.log(`         ->         ${t.namedBody}`);
  }
  if (sidChanges) {
    console.log(`    metaTemplateSid ${row.metaTemplateSid ?? "(none)"}  ->  ${t.contentSid}`);
  }
}
console.log(`\n  LOCKOUT_NOTICE  UNTOUCHED (undeliverable by design)`);
console.log(`\n${changing} of ${APPROVED_TEMPLATE_KEYS.length} rows would change or be created.`);

if (!APPLY) {
  console.log("\nNothing was written. Re-run with --apply to perform the update.");
  await prisma.$disconnect();
  process.exit(0);
}

// ————————————————— The write —————————————————

try {
  await prisma.$transaction(
    async (tx) => {
      let touched = 0;
      for (const key of APPROVED_TEMPLATE_KEYS) {
        const t = APPROVED_TEMPLATES[key];
        if (!byKey.has(key)) {
          // New platform key — same shape ensureMessageTemplates creates,
          // except the body and SID come straight from the registry.
          await tx.messageTemplate.create({
            data: {
              key,
              name: DEFAULT_TEMPLATES[key].name,
              body: t.namedBody,
              metaTemplateSid: t.contentSid,
            },
          });
          touched += 1;
          continue;
        }
        const result = await tx.messageTemplate.updateMany({
          where: { key },
          data: { body: t.namedBody, metaTemplateSid: t.contentSid },
        });
        if (result.count !== 1) {
          throw new SyncError(
            `${key}: expected to update exactly 1 row, updated ${result.count}. Rolling back.`,
          );
        }
        touched += result.count;
      }
      // ONE ROW PER APPROVED TEMPLATE, asserted rather than trusted: a
      // transaction touching more rows than the registry has keys is writing
      // something nobody described. Raised with the pre-write guard above.
      if (touched !== EXPECTED_APPROVED) {
        throw new SyncError(
          `Expected to touch exactly ${EXPECTED_APPROVED} rows, touched ${touched}. Rolling back.`,
        );
      }

      // Belt and braces INSIDE the transaction: LOCKOUT_NOTICE must be byte
      // for byte what it was. If anything above touched it, roll everything
      // back rather than leave a message that cannot be sent looking sendable.
      const lockoutAfter = await tx.messageTemplate.findUnique({
        where: { key: "LOCKOUT_NOTICE" },
      });
      if (
        !lockoutAfter ||
        lockoutAfter.body !== lockoutBefore.body ||
        lockoutAfter.metaTemplateSid !== lockoutBefore.metaTemplateSid
      ) {
        throw new SyncError("LOCKOUT_NOTICE was modified. Rolling back.");
      }
    },
    { isolationLevel: "Serializable" },
  );
} catch (e) {
  console.error(`\nFAILED — nothing was written. ${e instanceof Error ? e.message : String(e)}`);
  await prisma.$disconnect();
  process.exit(1);
}

// ————————————————— AFTER —————————————————

const after = await prisma.messageTemplate.findMany({ orderBy: { key: "asc" } });
console.log(`\n=== AFTER — all ${after.length} MessageTemplate rows ===\n`);
for (const row of after) show(row);

// ————————————————— Read back, and prove it —————————————————

let problems = 0;
for (const key of APPROVED_TEMPLATE_KEYS) {
  const row = after.find((r) => r.key === key)!;
  const t = APPROVED_TEMPLATES[key];
  if (row.body !== t.namedBody) {
    console.error(`  MISMATCH ${key}: body did not land as expected.`);
    problems += 1;
  }
  if (row.metaTemplateSid !== t.contentSid) {
    console.error(`  MISMATCH ${key}: metaTemplateSid did not land as expected.`);
    problems += 1;
  }
}
const lockoutFinal = after.find((r) => r.key === "LOCKOUT_NOTICE")!;
if (lockoutFinal.body !== lockoutBefore.body || lockoutFinal.metaTemplateSid !== null) {
  console.error("  MISMATCH LOCKOUT_NOTICE: it should be untouched and carry no ContentSid.");
  problems += 1;
}
console.log(
  `\nEvery platform key accounted for: ${MESSAGE_KEYS.length} keys, ${after.length} rows.`,
);
console.log(problems === 0 ? "\nSYNCED — the database now matches the approved registry." : `\n${problems} PROBLEM(S)`);

await prisma.$disconnect();
process.exit(problems === 0 ? 0 : 1);
