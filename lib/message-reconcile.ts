// ASK TWILIO WHAT ACTUALLY HAPPENED, AND WRITE IT DOWN.
//
// WHY THIS EXISTS IN THE APP AND NOT ONLY IN A SCRIPT. `deliver()` writes
// ACCEPTED when Twilio returns 201 + status "queued". That is honest at the
// moment it is written — Twilio has the message and has confirmed nothing — and
// it is supposed to be corrected later by the StatusCallback. But the callback
// is only sent when APP_BASE_URL is set (lib/whatsapp.ts, statusCallbackUrl),
// and it is NOT set. So every send in this platform's history has come to rest
// at ACCEPTED and stayed there.
//
// On 15 August 2026 that meant 75 of 81 rows disagreed with Twilio: most had
// actually been DELIVERED, and one had been dropped by Meta (63049) while the
// log still read ACCEPTED. An organizer reading "Accepted" cannot tell those
// two apart, and one of them means a member was never told.
//
// 2.23 — NOTHING MAY REQUIRE A DEVELOPER. A maintenance script that only
// somebody with a terminal can run is not a fix for a screen the organizer
// reads every day. This is the same reconciliation, callable from the page.
//
// APPEND-ONLY DOES NOT APPLY HERE. The log's body, recipient and template are
// never touched; only `status` and `error`, and only ever to what Twilio's own
// records say. That is not editing the record of what was said — it is
// finishing it.

import { prisma } from "./prisma";
import { loggedStatusFor } from "./twilio-status";

export type ReconcileResult = {
  checked: number;
  corrected: number;
  /** What changed, newest first — the organizer reads this, not a count alone. */
  changes: { templateKey: string; from: string; to: string; twilioStatus: string; error: string | null }[];
  /** Rows whose SID Twilio would not answer for. Reported, never assumed fine. */
  unreadable: number;
};

async function twilioStatus(
  sid: string,
): Promise<{ status: string; errorCode: number | null } | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !token) return null;
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`,
      { headers: { Authorization: "Basic " + Buffer.from(`${accountSid}:${token}`).toString("base64") } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; error_code?: number | null };
    return { status: body.status ?? "", errorCode: body.error_code ?? null };
  } catch {
    return null;
  }
}

/**
 * Bring recent unfinished rows into line with Twilio's own records.
 *
 * BOUNDED, because this makes one HTTP call per row and the organizer is
 * waiting for the page. The newest rows are the ones he is looking at.
 *
 * ONLY UNFINISHED ROWS. A row Twilio has already confirmed as SENT or FAILED is
 * terminal and is left alone — re-asking would spend a request to learn nothing.
 */
export async function reconcileAcceptedStatuses(limit = 50): Promise<ReconcileResult> {
  const rows = await prisma.messageLog.findMany({
    where: { status: "ACCEPTED", providerSid: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, templateKey: true, status: true, providerSid: true },
  });

  const changes: ReconcileResult["changes"] = [];
  let unreadable = 0;

  for (const row of rows) {
    const actual = await twilioStatus(row.providerSid!);
    if (!actual) {
      unreadable += 1;
      continue;
    }
    const should = loggedStatusFor(actual.status);
    if (should === row.status) continue;

    // THE ERROR CODE IS THE WHOLE EXPLANATION for a message that vanished.
    // 63049 — "Meta chose not to deliver this WhatsApp marketing message" —
    // reads as an unexplained failure without it.
    const error =
      should === "FAILED"
        ? `Twilio reported ${actual.status}${actual.errorCode ? ` (error ${actual.errorCode})` : ""}.`
        : null;

    await prisma.messageLog.update({
      where: { id: row.id },
      data: { status: should, error },
    });
    changes.push({
      templateKey: row.templateKey,
      from: row.status,
      to: should,
      twilioStatus: actual.status,
      error,
    });
  }

  return { checked: rows.length, corrected: changes.length, changes, unreadable };
}
