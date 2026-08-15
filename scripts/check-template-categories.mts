// DOES THE REGISTRY'S CATEGORY CLAIM MATCH META'S?
//
//   npx tsx scripts/check-template-categories.mts
//
// READ ONLY. It writes nothing, anywhere.
//
// WHY IT EXISTS. A WhatsApp template's CATEGORY is set by Meta at approval, not
// by us — the approval payload carries `allow_category_change: true`, so a
// template submitted as UTILITY can come back MARKETING. And a MARKETING
// template CANNOT REACH A UNITED STATES NUMBER: Meta accepts the send and
// silently discards it, which Twilio reports asynchronously as error 63049.
//
// The platform therefore records which templates are MARKETING
// (MARKETING_TEMPLATE_KEYS) and refuses to send those to a +1 number rather
// than logging an ACCEPTED nobody will ever receive. That list is a claim about
// somebody else's system, so it has to be CHECKED rather than trusted — the
// same reason sync-approved-templates exists for bodies.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { APPROVED_TEMPLATES, APPROVED_TEMPLATE_KEYS, MARKETING_TEMPLATE_KEYS } = await import(
  "../lib/whatsapp-templates"
);

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const auth =
  "Basic " + Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

const declared = new Set<string>(MARKETING_TEMPLATE_KEYS);
let problems = 0;
let unreadable = 0;

console.log("key                              META        REGISTRY SAYS   verdict");
console.log("-".repeat(84));

for (const key of APPROVED_TEMPLATE_KEYS) {
  const sid = APPROVED_TEMPLATES[key].contentSid;
  const res = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    unreadable += 1;
    console.log(`${key.padEnd(32)} HTTP ${res.status} — could not read it back`);
    continue;
  }
  const body = (await res.json()) as { whatsapp?: { category?: string } };
  const meta = body.whatsapp?.category ?? "(unknown)";
  const isMarketing = meta === "MARKETING";
  const says = declared.has(key) ? "MARKETING" : "deliverable";
  const agrees = isMarketing === declared.has(key);
  if (!agrees) problems += 1;
  console.log(
    `${key.padEnd(32)} ${meta.padEnd(11)} ${says.padEnd(15)} ` +
      (agrees
        ? isMarketing
          ? "agrees (undeliverable to US, refused at send)"
          : "agrees"
        : isMarketing
          ? "*** META SAYS MARKETING — add it to MARKETING_TEMPLATE_KEYS ***"
          : "*** META SAYS UTILITY — remove it from MARKETING_TEMPLATE_KEYS ***"),
  );
}

console.log(
  `\n${problems} disagreement(s)` + (unreadable ? `, ${unreadable} unreadable` : "") + ".",
);
if (problems > 0) {
  console.log(
    "\nA disagreement means either a template was re-categorised at Meta, or one was\n" +
      "resubmitted successfully and the refusal is now withholding a message that\n" +
      "would arrive. Both matter; neither is visible without this check.",
  );
}
process.exit(problems === 0 ? 0 : 1);
