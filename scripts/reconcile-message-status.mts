// WHAT TWILIO ACTUALLY DID WITH EVERY MESSAGE WE RECORDED AS SENT.
//
// THE ROWS THIS EXISTS FOR. Ten MessageLog rows read SENT with error null.
// Twilio's records showed all ten as status=failed, error_code=63112, and
// billed. The platform recorded delivery for messages that never left Twilio,
// because a 201 Created with status:"queued" was treated as success.
//
// The code no longer does that. These rows are the history written while it
// did, and history does not correct itself — so this asks Twilio, one message
// at a time, what really happened.
//
// DRY RUN BY DEFAULT. It prints a table and changes nothing. Correcting the
// organizer's record of what was said to whom is not something a script should
// do because it was run; it needs --apply, said out loud.
//
//   npx tsx scripts/reconcile-message-status.mts
//   npx tsx scripts/reconcile-message-status.mts --apply
//
// Reads DIRECT_URL: the pooled app role sees no rows under RLS.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const { loggedStatusFor } = await import("../lib/twilio-status");
const { callbackErrorText } = await import("../lib/message-status-update");

const APPLY = process.argv.includes("--apply");

async function twilioMessage(
  accountSid: string,
  authToken: string,
  sid: string,
): Promise<{ status: string; errorCode: number | null; errorMessage: string | null } | null> {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`,
    { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` } },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    status?: string;
    error_code?: number | null;
    error_message?: string | null;
  };
  return {
    status: body.status ?? "",
    errorCode: body.error_code ?? null,
    errorMessage: body.error_message ?? null,
  };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
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

  // Only rows that CLAIM delivery and can be checked. A row with no
  // providerSid was never accepted by Twilio and has nothing to ask about.
  const rows = await prisma.messageLog.findMany({
    where: { status: "SENT", providerSid: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, templateKey: true, providerSid: true, status: true },
  });

  console.log(
    `\n${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} row${rows.length === 1 ? "" : "s"} claiming SENT with a provider SID\n`,
  );
  console.log(
    pad("providerSid", 36) + pad("ours", 10) + pad("twilio", 13) + pad("code", 8) + "verdict",
  );
  console.log("-".repeat(36 + 10 + 13 + 8 + 20));

  let wrong = 0;
  const corrections: { id: string; status: string; error: string | null }[] = [];

  for (const row of rows) {
    const sid = row.providerSid!;
    const actual = await twilioMessage(accountSid, authToken, sid);
    if (!actual) {
      console.log(pad(sid, 36) + pad(row.status, 10) + pad("(unreadable)", 13) + pad("-", 8) + "skipped");
      continue;
    }
    const should = loggedStatusFor(actual.status);
    const agrees = should === row.status;
    if (!agrees) {
      wrong++;
      corrections.push({
        id: row.id,
        status: should,
        error:
          should === "FAILED"
            ? callbackErrorText(
                actual.errorCode === null ? null : String(actual.errorCode),
                actual.errorMessage,
              )
            : null,
      });
    }
    console.log(
      pad(sid, 36) +
        pad(row.status, 10) +
        pad(actual.status, 13) +
        pad(actual.errorCode === null ? "-" : String(actual.errorCode), 8) +
        (agrees ? "agrees" : `WRONG — should be ${should}`),
    );
  }

  console.log(
    `\n${wrong} of ${rows.length} row${rows.length === 1 ? "" : "s"} disagree with Twilio.`,
  );

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was changed. Re-run with --apply to correct these rows.\n");
    await prisma.$disconnect();
    return;
  }

  for (const c of corrections) {
    await prisma.messageLog.update({
      where: { id: c.id },
      data: { status: c.status as "SENT" | "ACCEPTED" | "FAILED", error: c.error },
    });
  }
  console.log(`\nCorrected ${corrections.length} row${corrections.length === 1 ? "" : "s"}.\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
