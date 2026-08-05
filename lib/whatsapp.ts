// WhatsApp delivery via Twilio — ported from the previous build's WORKING,
// Meta-approved integration (equb-app: src/lib/twilio.ts + the
// whatsapp-send/whatsapp-verify routes). Sender +15559620327, display name
// "Equb", approved via Healthway Transport LLC (2.28).
//
// Two Twilio products, two jobs — they are not interchangeable:
//   • Verify API   — login codes ONLY. Twilio owns the message content.
//   • Messages API — arbitrary statement bodies (2.21) over the approved
//     WhatsApp sender. This is what the messaging system sends through.
//
// Credentials come from env ONLY, and every function returns a result
// object — honest errors, never a throw that reaches the UI.
//
// Env vars (see .env.local):
//   TWILIO_ACCOUNT_SID        account
//   TWILIO_AUTH_TOKEN         account secret
//   TWILIO_VERIFY_SERVICE_SID Verify service (login codes)
//   TWILIO_WHATSAPP_FROM      the approved sender, e.g. +15559620327
//
// Meta constraint to design around (2.28): a freeform body is deliverable
// only inside the 24-hour service window after the member's last inbound
// message. Outside it, Meta requires a pre-approved template — each
// MessageTemplate row carries metaTemplateSid so the mapping is recorded
// once approval lands; until then Twilio returns an honest error (63016)
// which lands in MessageLog instead of being swallowed.

const VERIFY_BASE = "https://verify.twilio.com/v2/Services";
const API_BASE = "https://api.twilio.com/2010-04-01";

type Credentials = { sid: string; token: string };

function credentials(): { ok: true; value: Credentials } | { ok: false; error: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) {
    return {
      ok: false,
      error:
        "WhatsApp is not configured — set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.local.",
    };
  }
  return { ok: true, value: { sid, token } };
}

function authHeader(c: Credentials): string {
  return `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`;
}

/** Which env vars are missing — lets the UI say plainly why sends will fail. */
export function whatsAppMissingConfig(): string[] {
  return (
    [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_VERIFY_SERVICE_SID",
      "TWILIO_WHATSAPP_FROM",
    ] as const
  ).filter((name) => !process.env[name]?.trim());
}

/** Twilio error payloads carry a human message + numeric code; surface both. */
function twilioError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; code?: number };
    if (parsed.message) {
      return `Twilio ${status}${parsed.code ? ` (code ${parsed.code})` : ""}: ${parsed.message}`;
    }
  } catch {
    // fall through to the raw text
  }
  return `Twilio ${status}: ${bodyText.slice(0, 300)}`;
}

export type WhatsAppSendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; error: string };

/**
 * Send one freeform WhatsApp message body to an E.164 phone via the Twilio
 * Messages API (the Verify API cannot carry arbitrary content). Returns the
 * provider's message SID and initial status on success, an honest error on
 * failure — never throws.
 */
export async function sendWhatsAppMessage(
  toE164Phone: string,
  body: string,
): Promise<WhatsAppSendResult> {
  const creds = credentials();
  if (!creds.ok) return creds;
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (!from) {
    return {
      ok: false,
      error: "WhatsApp is not configured — set TWILIO_WHATSAPP_FROM in .env.local.",
    };
  }
  try {
    const res = await fetch(`${API_BASE}/Accounts/${creds.value.sid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authHeader(creds.value),
      },
      body: new URLSearchParams({
        To: `whatsapp:${toE164Phone}`,
        From: `whatsapp:${from}`,
        Body: body,
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: twilioError(res.status, text) };
    const parsed = JSON.parse(text) as { sid?: string; status?: string };
    return { ok: true, sid: parsed.sid ?? "", status: parsed.status ?? "queued" };
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach Twilio: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Start a WhatsApp login-code verification (Twilio Verify, channel whatsapp). */
export async function sendWhatsAppVerification(
  toE164Phone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const creds = credentials();
  if (!creds.ok) return creds;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!serviceSid) {
    return {
      ok: false,
      error: "WhatsApp codes are not configured — set TWILIO_VERIFY_SERVICE_SID in .env.local.",
    };
  }
  try {
    const res = await fetch(`${VERIFY_BASE}/${serviceSid}/Verifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authHeader(creds.value),
      },
      body: new URLSearchParams({ To: toE164Phone, Channel: "whatsapp" }).toString(),
    });
    if (!res.ok) return { ok: false, error: twilioError(res.status, await res.text()) };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach Twilio: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// "approved" — code is correct
// "expired"  — 404: verification not found, already used, or timed out
// "invalid"  — wrong code, still pending
export type VerifyCheckResult = "approved" | "expired" | "invalid";

/** Check a WhatsApp login code. Any transport failure counts as invalid. */
export async function checkWhatsAppVerification(
  toE164Phone: string,
  code: string,
): Promise<VerifyCheckResult> {
  const creds = credentials();
  if (!creds.ok) return "invalid";
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!serviceSid) return "invalid";
  try {
    const res = await fetch(`${VERIFY_BASE}/${serviceSid}/VerificationChecks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authHeader(creds.value),
      },
      body: new URLSearchParams({ To: toE164Phone, Code: code }).toString(),
    });
    if (res.status === 404) return "expired";
    if (!res.ok) return "invalid";
    const parsed = JSON.parse(await res.text()) as { status?: string };
    return parsed.status === "approved" ? "approved" : "invalid";
  } catch {
    return "invalid";
  }
}
