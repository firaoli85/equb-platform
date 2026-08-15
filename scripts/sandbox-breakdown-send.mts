// THE ONE LIVE TEST OF PHASE 4b-ii.
//
//   npx tsx scripts/sandbox-breakdown-send.mts           # composes, sends nothing
//   npx tsx scripts/sandbox-breakdown-send.mts --send    # ONE real WhatsApp message
//
// WHAT IT PROVES, and why it must be live. Every phase-4 template carries a
// COMPOSED variable — `paymentBreakdown` puts a whole list of weeks into one
// Meta parameter ("week 14 (Aug 16), week 15 (Aug 23) and week 16 (Aug 30)").
// Meta rejects a parameter containing a newline, a tab, or four consecutive
// spaces, and no local test can tell us whether the real gateway accepts this
// shape: only the gateway can. So one message goes out before any auto-send is
// switched on, and the composer is what gets fixed if it refuses.
//
// TO THE ORGANIZER'S OWN PHONE. Firaoli Seboka, +1 301 541 6005 — no member is
// touched by this, and the sentence he reads is the exact sentence the code
// composes.
//
// NO MessageLog ROW. `sendWhatsAppMessage` is the raw provider call; only
// `deliver()` logs, and a test send is not a message the platform sent to a
// member. Twilio's own record is the evidence, read back below.
//
// ACCEPTANCE IS NOT DELIVERY (5.15). A 201 with status "queued" says Twilio has
// it, nothing more; the ten rows that read SENT while Twilio showed 63112 are
// why. This polls the Message resource until it settles, and reports the
// provider's own final word.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const SEND = process.argv.includes("--send");

const { paymentBreakdown } = await import("../lib/payment-message");
const { APPROVED_TEMPLATES } = await import("../lib/whatsapp-templates");

// Week 14, 15, 16 of cycle 1 — the member's own numbering, with the SCHEDULED
// dates. Aug 16 / 23 / 30 2026 are three consecutive Sundays.
const WEEKS = [
  { weekNumber: 14, date: new Date("2026-08-16T00:00:00Z") },
  { weekNumber: 15, date: new Date("2026-08-23T00:00:00Z") },
  { weekNumber: 16, date: new Date("2026-08-30T00:00:00Z") },
];

const breakdown = paymentBreakdown(WEEKS, 1);
const template = APPROVED_TEMPLATES.PAYMENT_CONFIRMED_V4;

const variables: Record<string, string> = {
  "1": "Firaoli",
  "2": "$6,000.00",
  "3": breakdown,
  "4": "16",
  "5": "40",
};

const rendered = template.approvedBody.replace(/\{\{(\d)\}\}/g, (_m, n) => variables[n] ?? "");

console.log("=== THE COMPOSED VARIABLE ({{3}}) ===\n");
console.log(`  ${JSON.stringify(breakdown)}`);
console.log(`  length ${breakdown.length}`);
console.log(`  newline   ${/\n/.test(breakdown)}`);
console.log(`  tab       ${/\t/.test(breakdown)}`);
console.log(`  4+ spaces ${/ {4}/.test(breakdown)}`);
console.log(`  en/em dash ${/[–—]/.test(breakdown)}`);

console.log("\n=== THE MESSAGE AS THE MEMBER WOULD READ IT ===\n");
console.log(`  ${rendered}`);

console.log("\n=== THE SEND ===\n");
console.log(`  ContentSid  ${template.contentSid}`);
console.log(`  to          +13015416005 (Firaoli Seboka, the organizer)`);

if (!SEND) {
  console.log("\nNothing was sent. Re-run with --send to deliver this one message.");
  process.exit(0);
}

const { sendWhatsAppMessage } = await import("../lib/whatsapp");

const result = await sendWhatsAppMessage({
  toE164Phone: "+13015416005",
  contentSid: template.contentSid,
  contentVariables: variables,
  body: rendered,
});

console.log(`\n  result      ${JSON.stringify(result)}`);

if (!result.ok) {
  console.error("\nREFUSED. Fix the COMPOSER (lib/payment-message.ts), not the template.");
  process.exit(1);
}

// ————— Twilio's own final word —————

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const auth = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${result.sid}.json`;

console.log("\n=== POLLING TWILIO FOR THE REAL OUTCOME ===\n");
let final: { status: string; error_code: number | null; error_message: string | null } | null = null;
for (let i = 0; i < 12; i += 1) {
  await new Promise((r) => setTimeout(r, 2500));
  const res = await fetch(url, { headers: { Authorization: auth } });
  const json = (await res.json()) as {
    status: string;
    error_code: number | null;
    error_message: string | null;
  };
  console.log(`  t+${(i + 1) * 2.5}s  status=${json.status}  error=${json.error_code ?? "none"}`);
  final = json;
  if (["delivered", "read", "failed", "undelivered"].includes(json.status)) break;
}

console.log(`\n  FINAL  ${JSON.stringify(final)}`);
const ok = final !== null && ["sent", "delivered", "read"].includes(final.status);
console.log(
  ok
    ? "\nMETA ACCEPTED THE COMPOSED LIST. The one-variable breakdown is live-proven."
    : "\nNOT PROVEN. Do not enable auto-send. Fix the COMPOSER, not the template.",
);
process.exit(ok ? 0 : 1);
