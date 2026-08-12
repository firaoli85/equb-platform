// TWILIO DELIVERY CALLBACKS — the platform's only way to learn a message died.
//
// WHY THIS ROUTE EXISTS. Ten MessageLog rows read SENT with no error while
// Twilio's own records showed all ten as failed with 63112, and billed. The
// send succeeds — Twilio answers 201 Created with status:"queued" — and the
// refusal arrives ASYNCHRONOUSLY, moments later. With no callback there was no
// second word from Twilio, ever, so the platform's record of what members
// received was permanently wrong and nothing could notice.
//
// THIS IS A PUBLIC ENDPOINT. It rewrites the message log, which is the
// organizer's proof of what was said to whom, so every request must prove it
// came from Twilio (X-Twilio-Signature) or be refused. Unsigned is refused —
// see lib/twilio-signature.ts.
//
// IT WILL NOT FIRE ON LOCALHOST. Twilio calls this from the internet, so a dev
// machine never receives one unless APP_BASE_URL points at a public tunnel.
// That is not a failure mode: rows simply stay ACCEPTED, which is the honest
// state for a message nobody has heard back about.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { statusUpdateFor } from "@/lib/message-status-update";
import { verifyTwilioSignature } from "@/lib/twilio-signature";
import { STATUS_CALLBACK_PATH, statusCallbackUrl } from "@/lib/whatsapp";
import type { LoggedStatus } from "@/lib/twilio-status";

export const dynamic = "force-dynamic";

/**
 * The URL Twilio signed.
 *
 * It signs the URL IT POSTED TO, which is the public one — not whatever host
 * header reaches this process behind a proxy. So the configured callback URL
 * is preferred and the request URL is only a fallback; getting this wrong
 * makes every genuine callback fail signature validation.
 */
function signedUrl(requestUrl: string): string {
  return statusCallbackUrl() ?? requestUrl;
}

export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) {
    // Refuse rather than skip the check: with no token nothing can be proven,
    // and an unverified writer to the message log is worse than no callbacks.
    console.error(
      `[twilio-status] TWILIO_AUTH_TOKEN is not set — cannot verify signatures, refusing.`,
    );
    return new NextResponse("Not configured", { status: 500 });
  }

  // Twilio posts form-encoded, never JSON.
  let params: Record<string, string>;
  try {
    const form = await request.formData();
    params = Object.fromEntries(
      [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]),
    );
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const valid = verifyTwilioSignature({
    authToken: token,
    url: signedUrl(request.url),
    params,
    signature: request.headers.get("x-twilio-signature"),
  });
  if (!valid) {
    // 403 and nothing else. No detail about WHY — a public endpoint that
    // explains how its signature check failed is an oracle for forging one.
    console.error(`[twilio-status] rejected an unsigned or mis-signed callback.`);
    return new NextResponse("Forbidden", { status: 403 });
  }

  const messageSid = params.MessageSid?.trim() || params.SmsSid?.trim();
  const messageStatus = params.MessageStatus?.trim() || params.SmsStatus?.trim();
  if (!messageSid || !messageStatus) {
    return new NextResponse("Missing MessageSid or MessageStatus", { status: 400 });
  }

  // The row is found by providerSid, which deliver() wrote from Twilio's own
  // response — the same identifier Twilio is now quoting back.
  const row = await prisma.messageLog.findFirst({
    where: { providerSid: messageSid },
    select: { id: true, status: true },
  });
  if (!row) {
    // 200, deliberately. An unknown SID is not our error and Twilio retries a
    // non-2xx — retrying forever against a message we never logged is noise.
    console.warn(`[twilio-status] no MessageLog row for ${messageSid} (status ${messageStatus}).`);
    return NextResponse.json({ ok: true, matched: false });
  }

  const decision = statusUpdateFor({
    current: row.status as LoggedStatus,
    incomingStatus: messageStatus,
    errorCode: params.ErrorCode,
    errorMessage: params.ErrorMessage,
  });

  if (!decision.apply) {
    // Idempotent and order-safe: a duplicate or overtaking callback is
    // acknowledged and changes nothing.
    return NextResponse.json({ ok: true, matched: true, changed: false, reason: decision.reason });
  }

  await prisma.messageLog.update({
    where: { id: row.id },
    data: { status: decision.status, error: decision.error },
  });

  if (decision.status === "FAILED") {
    console.error(
      `[twilio-status] ${messageSid} FAILED (${messageStatus})` +
        `${params.ErrorCode ? ` code ${params.ErrorCode}` : ""} — MessageLog corrected.`,
    );
  }

  return NextResponse.json({ ok: true, matched: true, changed: true, status: decision.status });
}

/**
 * A GET is not part of the contract, but returning the path helps confirm the
 * route is deployed and reachable without having to forge a signed POST.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: STATUS_CALLBACK_PATH,
    configured: statusCallbackUrl() !== null,
  });
}
