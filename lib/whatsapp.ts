// WhatsApp delivery via Twilio — ported from the previous build's WORKING,
// Meta-approved integration (equb-app: src/lib/twilio.ts + the
// whatsapp-send/whatsapp-verify routes). Sender +15559620327, display name
// "Equb", approved via Healthway Transport LLC (2.28).
//
// Two Twilio products, two jobs — they are not interchangeable, and TODAY ONLY
// ONE OF THEM WORKS:
//   • Verify API   — login codes ONLY. Twilio owns the content and sends a
//     pre-approved template, which needs no service window. WORKING.
//   • Messages API — arbitrary statement bodies (2.21). Freeform, so Meta
//     accepts it only inside a 24-hour window that is open for nobody on this
//     account. BLOCKED at the transport, unconditionally. See
//     sendWhatsAppMessage and docs/WHATSAPP_TEMPLATE_ONLY.md.
//
// That asymmetry is the whole design of this file: one switch used to gate
// both, which meant a dead statement path took login codes down with it.
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

import {
  getSetting,
  WHATSAPP_DISABLED_REASON,
  WHATSAPP_STATEMENTS_BLOCKED_REASON,
} from "./settings";

const VERIFY_BASE = "https://verify.twilio.com/v2/Services";
// The Messages API base is deliberately ABSENT. It was only ever used by the
// freeform statement send, which no longer exists — see sendWhatsAppMessage.
// When templates land, the send moves to Content (ContentSid +
// ContentVariables) and the host comes back with it.

/**
 * Meta disabled the WhatsApp Business Account behind the sender — Twilio's own
 * definition of 63112.
 *
 * It does not depend on the recipient, the message, the template or the time
 * of day, so while it lasts nothing can succeed and retrying is pure waste
 * (each attempt is still billed at ~$0.001). Nothing retries it: it is logged
 * plainly and the send is done.
 *
 * NOT PERMANENT, though this comment used to say so. Observed on this account
 * from 2026-08-06 03:03 to 2026-08-07 01:53 UTC — 15 consecutive failures,
 * Verify's template sends included — and then it simply cleared. By
 * 2026-08-08 the sender read ONLINE / quality HIGH / 100K customers per 24hr
 * and login codes delivered again, one of them verified end to end. Treat 63112
 * as an outage to wait out, not a verdict.
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
        `Not retrying — while this lasts no send can succeed. ` +
        `It has cleared on its own before (2026-08-06 → 2026-08-07); if it persists, ` +
        `turn the whatsappEnabled setting off to stop attempting sends.`,
    );
    return {
      ok: false,
      error:
        `Meta has disabled the WhatsApp Business Account (Twilio ${META_DISABLED_WABA_CODE}). ` +
        `Nothing will send while it lasts — not retried.`,
      code,
      // Permanent for THIS attempt: no retry of this send can succeed. The
      // outage itself may lift later, which is a new attempt, not a retry.
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
 * no caller can bypass it. Returns the refusal to report, or null when sending
 * is allowed.
 *
 * This gates LOGIN CODES only. Statements have their own, harder gate — see
 * sendWhatsAppMessage.
 */
async function channelRefusal(): Promise<string | null> {
  return (await getSetting("whatsappEnabled")) ? null : WHATSAPP_DISABLED_REASON;
}

/**
 * Freeform statement bodies (2.21) over the approved WhatsApp sender.
 *
 * THIS FUNCTION DOES NOT SEND, AND THAT IS DELIBERATE.
 *
 * It refuses before credentials and before the network, unconditionally, and
 * NOT via a setting — because the obstacle is structural, not configuration.
 * Meta accepts a freeform body only inside the 24-hour service window opened
 * by the member's own inbound message. This account has one inbound message
 * ever (19 May 2026), so no window is open for anyone, and this call carries a
 * raw Body with no ContentSid. Every attempt would fail, be billed, and land a
 * failure in MessageLog for a member who was never reachable.
 *
 * A toggle would be the wrong shape: an organizer could switch it on and get
 * silent non-delivery back. There is no configuration that makes this work —
 * only registering each message shape as a Content template and sending
 * ContentSid + ContentVariables instead of Body. That work is specified in
 * docs/WHATSAPP_TEMPLATE_ONLY.md, and MessageTemplate.metaTemplateSid is where
 * the mapping lands when it happens.
 *
 * The request this USED to make is recorded in the doc rather than left here
 * as unreachable code — POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json with
 * To/From/Body — because dead code that looks live is how a freeform send
 * comes back by accident.
 *
 * The signature is unchanged so every caller and every test still type-checks
 * against the same contract; only the answer is different, and it is always
 * the same answer.
 */
export async function sendWhatsAppMessage(
  _toE164Phone: string,
  _body: string,
): Promise<WhatsAppSendResult> {
  return {
    ok: false,
    error: WHATSAPP_STATEMENTS_BLOCKED_REASON,
    code: null,
    permanent: true,
  };
}

/** Start a WhatsApp login-code verification (Twilio Verify, channel whatsapp). */
export async function sendWhatsAppVerification(
  toE164Phone: string,
): Promise<
  | { ok: true }
  // The code and permanence are carried through rather than flattened away.
  // This is now the ONLY WhatsApp path that reaches Twilio, so it is the only
  // one that can observe an outage like 63112 — throwing that detail away
  // would leave the working channel less diagnosable than the dead one.
  | { ok: false; error: string; code?: number | null; permanent?: boolean }
> {
  // Login codes ride the same WhatsApp Business Account as statements, so a
  // 63112 outage does take them down too — verified on this account, where
  // Verify's own template sends failed alongside the freeform ones.
  //
  // But that is an OUTAGE, not the statement problem. Statements are blocked
  // by the 24-hour window rule, which never applies to a Verify template. So
  // this path is gated on the organizer's switch alone, and no longer shares a
  // gate with sendWhatsAppMessage — that sharing is what kept a working login
  // channel switched off.
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
      if (failed.ok) return { ok: false, error: "Send failed." };
      return {
        ok: false,
        error: failed.error,
        code: failed.code ?? null,
        permanent: failed.permanent ?? false,
      };
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
