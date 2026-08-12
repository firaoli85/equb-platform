// RECOVER ONE MESSAGE LOG ROW THAT WAS NEVER WRITTEN.
//
// WHAT HAPPENED. A BEHIND_NOTICE went out and Twilio accepted it — the message
// exists at Twilio under MM9f44e47dd9be83750c6838ccabc6d6c2. The
// `messageLog.create` that should have recorded it THREW: the schema had just
// gained the ACCEPTED enum value and the database had not, so Postgres refused
// a value Prisma believed was legal.
//
// The send is not the thing that was lost. The RECORD of it is. MessageLog is
// the organizer's proof of what was said to whom, and a message that reached a
// member with no row is the same class of wrong as a row with no message —
// both make the log something you cannot trust to be complete.
//
// The migration has since been applied (prisma migrate deploy, status clean),
// so ACCEPTED is now writable. This puts the row back, then asks Twilio what
// actually became of that SID and records THAT rather than assuming.
//
// ONE-OFF. It refuses to run twice, and it exists for exactly one SID. When
// this row is in place, the script has no further purpose — it stays as the
// record of what was repaired and why.
//
//   npx tsx scripts/recover-lost-message-log.mts           # dry run
//   npx tsx scripts/recover-lost-message-log.mts --apply
//
// Reads DIRECT_URL: the pooled app role sees no rows under RLS.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const { loggedStatusFor } = await import("../lib/twilio-status");
const { callbackErrorText } = await import("../lib/message-status-update");

const APPLY = process.argv.includes("--apply");

/**
 * The lost row, exactly as deliver() would have written it.
 *
 * The body is the RENDERED text the member received, not the template — the
 * log stores what was actually said (2.21), and this sentence is the one that
 * went out.
 */
const LOST_ROW = {
  providerSid: "MM9f44e47dd9be83750c6838ccabc6d6c2",
  personId: "cmsf85n85000yb4kxpw8ip11c",
  templateId: "cmsga4m8j0001t4kxa4tu1kl2",
  templateKey: "BEHIND_NOTICE",
  toPhone: "+13015416005",
  trigger: "MANUAL" as const,
  channel: "WHATSAPP",
  body:
    "Hi Firaoli, your Equb record as of week 13: last payment week 9, and 3 weeks " +
    "behind, $6,000 outstanding. Please contact Firaoli with any questions.",
};

async function twilioMessage(accountSid: string, authToken: string, sid: string) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    status?: string;
    error_code?: number | null;
    error_message?: string | null;
    date_sent?: string | null;
  };
  return {
    status: body.status ?? "",
    errorCode: body.error_code ?? null,
    errorMessage: body.error_message ?? null,
    dateSent: body.date_sent ?? null,
  };
}

async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!accountSid || !authToken || !databaseUrl) {
    console.error("Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or DIRECT_URL in .env.local.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — recovering ${LOST_ROW.providerSid}\n`);

  // ——— REFUSE TO RUN TWICE ———
  //
  // A duplicate row is worse than the missing one: the log would then claim a
  // member was messaged twice when they were messaged once, and nothing
  // downstream could tell which row was real.
  const existing = await prisma.messageLog.findFirst({
    where: { providerSid: LOST_ROW.providerSid },
    select: { id: true, status: true, error: true, createdAt: true },
  });
  if (existing) {
    console.log("ALREADY RECOVERED — a row with this providerSid exists:");
    console.log(`  id        : ${existing.id}`);
    console.log(`  status    : ${existing.status}`);
    console.log(`  error     : ${existing.error ?? "null"}`);
    console.log(`  createdAt : ${existing.createdAt.toISOString()}`);
    console.log("\nNothing was written. This script is a one-off and its work is done.\n");
    await prisma.$disconnect();
    return;
  }

  // ——— WHAT TWILIO SAYS BECAME OF IT ———
  //
  // Asked rather than assumed. The row is inserted as ACCEPTED — which is what
  // deliver() would have written from the 201 — and then corrected to whatever
  // Twilio actually recorded, so the repair cannot bake in a guess.
  const actual = await twilioMessage(accountSid, authToken, LOST_ROW.providerSid);
  if (!actual) {
    console.error(
      `Could not read ${LOST_ROW.providerSid} from Twilio. Refusing to insert a row whose ` +
        `real outcome is unknown — that is how the false SENT rows happened.\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const finalStatus = loggedStatusFor(actual.status);
  const finalError =
    finalStatus === "FAILED"
      ? callbackErrorText(
          actual.errorCode === null ? null : String(actual.errorCode),
          actual.errorMessage,
        )
      : null;

  console.log("The row to insert:");
  console.log(`  providerSid : ${LOST_ROW.providerSid}`);
  console.log(`  personId    : ${LOST_ROW.personId}`);
  console.log(`  templateId  : ${LOST_ROW.templateId}`);
  console.log(`  templateKey : ${LOST_ROW.templateKey}`);
  console.log(`  channel     : ${LOST_ROW.channel}`);
  console.log(`  toPhone     : ${LOST_ROW.toPhone}`);
  console.log(`  trigger     : ${LOST_ROW.trigger}`);
  console.log(`  body        : ${LOST_ROW.body}`);
  console.log();
  console.log("What Twilio says became of it:");
  console.log(`  status      : ${actual.status}`);
  console.log(`  error_code  : ${actual.errorCode ?? "-"}`);
  console.log(`  date_sent   : ${actual.dateSent ?? "-"}`);
  console.log();
  console.log(`  inserted as : ACCEPTED  (what deliver() would have written)`);
  console.log(`  corrected to: ${finalStatus}`);
  console.log(`  error       : ${finalError ?? "null"}`);

  // The referenced rows must exist, or the insert fails on a foreign key with
  // a message that says nothing about which id was wrong.
  const person = await prisma.person.findUnique({
    where: { id: LOST_ROW.personId },
    select: { nameEnglishFirst: true },
  });
  const template = await prisma.messageTemplate.findUnique({
    where: { id: LOST_ROW.templateId },
    select: { key: true },
  });
  console.log();
  console.log(`  person      : ${person ? person.nameEnglishFirst : "NOT FOUND"}`);
  console.log(`  template    : ${template ? template.key : "NOT FOUND"}`);
  if (!person || !template) {
    console.error("\nRefusing: a referenced row does not exist.\n");
    await prisma.$disconnect();
    process.exit(1);
  }
  if (template.key !== LOST_ROW.templateKey) {
    console.error(
      `\nRefusing: templateId ${LOST_ROW.templateId} is ${template.key}, not ${LOST_ROW.templateKey}.\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply.\n");
    await prisma.$disconnect();
    return;
  }

  // Insert as ACCEPTED, then correct — two steps on purpose, so the row passes
  // through the state deliver() would have written and the correction is the
  // same move a status callback would have made.
  const created = await prisma.messageLog.create({
    data: {
      personId: LOST_ROW.personId,
      templateId: LOST_ROW.templateId,
      templateKey: LOST_ROW.templateKey,
      body: LOST_ROW.body,
      channel: LOST_ROW.channel,
      toPhone: LOST_ROW.toPhone,
      trigger: LOST_ROW.trigger,
      status: "ACCEPTED",
      providerSid: LOST_ROW.providerSid,
      error: null,
    },
    select: { id: true },
  });
  console.log(`\nInserted ${created.id} as ACCEPTED.`);

  if (finalStatus !== "ACCEPTED") {
    await prisma.messageLog.update({
      where: { id: created.id },
      data: { status: finalStatus, error: finalError },
    });
    console.log(`Corrected to ${finalStatus}${finalError ? ` — ${finalError}` : ""}.`);
  }
  console.log();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
