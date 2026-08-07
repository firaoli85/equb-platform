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

import { getSetting, WHATSAPP_DISABLED_REASON } from "./settings";

const VERIFY_BASE = "https://verify.twilio.com/v2/Services";
const API_BASE = "https://api.twilio.com/2010-04-01";

/**
 * Meta disabled the WhatsApp Business Account behind the sender.
 *
 * Twilio's own definition of 63112. It is PERMANENT for us: it does not
 * depend on the recipient, the message, the template, or the time of day, and
 * it will keep failing (and keep being billed at ~$0.001 a message) until
 * Meta restores the account. Retrying is pure waste, so nothing retries it —
 * it is logged plainly and the send is done.
 *
 * Observed on this account from 2026-08-05 17:48 UTC: every send after that
 * point failed with it, template sends through Verify included.
 */
export const META_DISABLED_WABA_CODE = 63112;

/** True when a Twilio failure is the Meta-disabled-WABA case. */
export function isMetaDisabledError(code: number | null | undefined): boolean {
  return code === META_DISABLED_WABA_CODE;
}

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

/** Twilio error payloads carry a human message + numeric code; keep both. */
function twilioError(
  status: number,
  bodyText: string,
): { message: string; code: number | null } {
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; code?: number };
    if (parsed.message) {
      return {
        message: `Twilio ${status}${parsed.code ? ` (code ${parsed.code})` : ""}: ${parsed.message}`,
        code: parsed.code ?? null,
      };
    }
  } catch {
    // fall through to the raw text
  }
  return { message: `Twilio ${status}: ${bodyText.slice(0, 300)}`, code: null };
}

/**
 * Turn a Twilio failure into a result, logging the permanent case PLAINLY —
 * one readable line naming the cause and the fact that nothing will be
 * retried, instead of an opaque code buried in a stack.
 */
function failure(where: string, status: number, bodyText: string): WhatsAppSendResult {
  const { message, code } = twilioError(status, bodyText);
  if (isMetaDisabledError(code)) {
    console.error(
      `WhatsApp ${where}: Meta has disabled the WhatsApp Business Account (Twilio ${META_DISABLED_WABA_CODE}). ` +
        `Not retrying — no send can succeed until Meta restores it. ` +
        `Turn the whatsappEnabled setting off to stop attempting sends.`,
    );
    return {
      ok: false,
      error:
        `Meta has disabled the WhatsApp Business Account (Twilio ${META_DISABLED_WABA_CODE}). ` +
        `Nothing will send until Meta restores it — not retried.`,
      code,
      permanent: true,
    };
  }
  return { ok: false, error: message, code, permanent: false };
}

export type WhatsAppSendResult =
  | { ok: true; sid: string; status: string }
  | {
      ok: false;
      error: string;
      /** Twilio's numeric error code, when it gave one. */
      code?: number | null;
      /** True when retrying can never help (see META_DISABLED_WABA_CODE). */
      permanent?: boolean;
    };

/**
 * The channel switch (whatsappEnabled), checked at the TRANSPORT boundary so
 * no caller can bypass it: every WhatsApp send in the platform goes through
 * one of the two functions below. Returns the refusal to report, or null when
 * sending is allowed.
 */
async function channelRefusal(): Promise<string | null> {
  return (await getSetting("whatsappEnabled")) ? null : WHATSAPP_DISABLED_REASON;
}

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
  // The channel switch comes FIRST — before credentials, before the network.
  // A disabled channel must cost nothing and reach nobody.
  const disabled = await channelRefusal();
  if (disabled) return { ok: false, error: disabled, permanent: true };
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
    if (!res.ok) return failure("statement send", res.status, text);
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
  // Login codes ride the SAME WhatsApp Business Account as statements, so the
  // 63112 outage kills them too — verified on this account: Verify's own
  // template sends failed 63112 alongside the freeform ones. One switch
  // covers both.
  const disabled = await channelRefusal();
  if (disabled) return { ok: false, error: disabled };
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
    if (!res.ok) {
      const failed = failure("login code", res.status, await res.text());
      return { ok: false, error: failed.ok === false ? failed.error : "Send failed." };
    }
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
