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
import { classifyTwilioStatus, type DeliveryClass } from "./twilio-status";

const VERIFY_BASE = "https://verify.twilio.com/v2/Services";
const API_BASE = "https://api.twilio.com/2010-04-01";

/** Where Twilio posts delivery updates. Must match the webhook route. */
export const STATUS_CALLBACK_PATH = "/api/twilio/status";

/**
 * The public URL Twilio will POST delivery updates to, or null.
 *
 * REQUIRES A PUBLICLY REACHABLE URL. Twilio calls this from the internet, so
 * it CANNOT fire against localhost — on a dev machine `APP_BASE_URL` is
 * normally unset and no StatusCallback is sent at all. Everything still works;
 * the rows simply stay ACCEPTED, which is the honest state for a message
 * nobody has heard back about. To exercise it locally, point APP_BASE_URL at a
 * tunnel (ngrok/cloudflared).
 *
 * Returns null rather than a half-formed URL: Twilio rejects a malformed
 * StatusCallback outright, which would fail the send itself.
 */
export function statusCallbackUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}${STATUS_CALLBACK_PATH}`;
}

/**
 * ContentVariables did not match the template (Twilio 21656).
 *
 * PERMANENT: it means the object we built does not fit the approved template —
 * our bug, and retrying sends the identical wrong object. One send already hit
 * this on 2026-08-07.
 */
export const CONTENT_VARIABLES_INVALID_CODE = 21656;

/**
 * Freeform outside the 24-hour service window (Twilio 63016).
 *
 * PERMANENT, and it means something specific: this send carried no ContentSid.
 * Every statement now goes out as an approved template, and a template needs no
 * window — so seeing 63016 at all is a CODE DEFECT, not a delivery problem.
 * Retrying cannot fix a missing ContentSid.
 */
export const OUTSIDE_SERVICE_WINDOW_CODE = 63016;

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

  // OUR BUG, NOT A DELIVERY PROBLEM — and the distinction is the whole point
  // of classifying it. A retry re-sends the identical malformed request, and
  // every attempt is billed and lands another FAILED row in the log.
  if (code === CONTENT_VARIABLES_INVALID_CODE) {
    console.error(
      `WhatsApp ${where}: ContentVariables did not match the approved template ` +
        `(Twilio ${CONTENT_VARIABLES_INVALID_CODE}). Not retrying — the same variables would be ` +
        `sent again. Check variableOrder in lib/whatsapp-templates.ts against the template Meta approved.`,
    );
    return {
      ok: false,
      error:
        `The message variables did not match the approved template (Twilio ` +
        `${CONTENT_VARIABLES_INVALID_CODE}). Nothing was sent, and it was not retried.`,
      code,
      permanent: true,
    };
  }

  if (code === OUTSIDE_SERVICE_WINDOW_CODE) {
    console.error(
      `WhatsApp ${where}: sent OUTSIDE the 24-hour window (Twilio ${OUTSIDE_SERVICE_WINDOW_CODE}), ` +
        `which means this send carried no ContentSid. Every statement is supposed to go as an ` +
        `approved template, and a template needs no window — so this is a code defect, not a ` +
        `delivery failure. Not retrying.`,
    );
    return {
      ok: false,
      error:
        `This message was sent without an approved template (Twilio ` +
        `${OUTSIDE_SERVICE_WINDOW_CODE}), so Meta refused it. Nothing was retried.`,
      code,
      permanent: true,
    };
  }
  return { ok: false, error: message, code, permanent: false };
}

export type WhatsAppSendResult =
  | {
      ok: true;
      sid: string;
      /** Twilio's RAW status word, carried through unchanged. */
      status: string;
      /**
       * What that word means, classified once (lib/twilio-status.ts).
       *
       * "accepted" is the common case and the important one: Twilio has the
       * message and has confirmed NOTHING about its fate. A caller that
       * records this as delivered is making the claim that produced ten false
       * SENT rows.
       */
      delivery: DeliveryClass;
    }
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
 * Send one approved WhatsApp TEMPLATE to a member.
 *
 * Statements go out as Meta-approved Content templates and never as freeform
 * text. That is not a preference: Meta accepts a freeform body only inside the
 * 24-hour service window a member opens by messaging us, and this account has
 * had ONE inbound message in its history (19 May 2026). A template needs no
 * window, which is why this path works at all.
 *
 * `body` is NOT what Twilio sends — Twilio renders the approved sentence from
 * the ContentSid and the variables. It is passed so the caller can log the
 * exact text a member will read. If those two ever disagree, the log is wrong
 * and lib/whatsapp-templates.test.ts is what catches it.
 *
 * NO MESSAGING SERVICE SID. We send from the number directly: one sender, 27
 * members, and a service container would add a layer with nothing behind it.
 *
 * Never throws — a failure is an honest result the caller logs.
 */
export async function sendWhatsAppMessage(args: {
  toE164Phone: string;
  contentSid: string;
  contentVariables: Record<string, string>;
  /** The rendered text, for MessageLog. Not sent to Twilio. */
  body: string;
}): Promise<WhatsAppSendResult> {
  // The channel switch first — before credentials, before the network. A
  // switched-off channel must cost nothing and reach nobody.
  const disabled = await channelRefusal();
  if (disabled) return { ok: false, error: disabled, code: null, permanent: true };

  // A send with no ContentSid is a freeform send, which Meta will refuse with
  // 63016 and bill us for. Refuse it here instead, where it costs nothing and
  // says what is actually wrong.
  if (!args.contentSid.trim()) {
    return {
      ok: false,
      error:
        "No approved template for this message — nothing was sent. A WhatsApp statement " +
        "can only go out under a Meta-approved ContentSid.",
      code: null,
      permanent: true,
    };
  }

  const creds = credentials();
  if (!creds.ok) return creds;
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (!from) {
    return {
      ok: false,
      error: "WhatsApp is not configured — set TWILIO_WHATSAPP_FROM in .env.local.",
      code: null,
      permanent: true,
    };
  }

  const callbackUrl = statusCallbackUrl();

  try {
    const res = await fetch(`${API_BASE}/Accounts/${creds.value.sid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authHeader(creds.value),
      },
      body: new URLSearchParams({
        To: `whatsapp:${args.toE164Phone}`,
        From: `whatsapp:${from}`,
        ContentSid: args.contentSid,
        ContentVariables: JSON.stringify(args.contentVariables),
        // WITHOUT THIS THE PLATFORM CAN NEVER LEARN A MESSAGE FAILED.
        //
        // 63112 lands asynchronously, moments after the 201 that says
        // "queued". No callback meant no second word from Twilio, ever — so a
        // row written as SENT stayed SENT while Twilio's own records said
        // failed and billed. Ten rows did exactly that.
        //
        // Omitted entirely when no public base URL is set, rather than sent as
        // a broken value: Twilio rejects a malformed StatusCallback and the
        // whole send fails, which would turn "no delivery reporting" into "no
        // delivery". See statusCallbackUrl.
        ...(callbackUrl ? { StatusCallback: callbackUrl } : {}),
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) return failure("statement send", res.status, text);

    const parsed = JSON.parse(text) as {
      sid?: string;
      status?: string;
      error_code?: number | null;
      error_message?: string | null;
    };

    // A 2xx IS NOT A DELIVERY, and this is where that was lost. Twilio answers
    // 201 Created with status:"queued" for a message it has merely accepted,
    // and can answer 2xx with status:"failed" outright. `res.ok` alone treated
    // both as success.
    const delivery = classifyTwilioStatus(parsed.status);

    if (delivery === "failed") {
      // Failed IN THE IMMEDIATE RESPONSE. Twilio already knows, so the code
      // and message are on the body rather than arriving by callback later.
      const code = parsed.error_code ?? null;
      const detail = parsed.error_message?.trim();
      if (isMetaDisabledError(code)) {
        console.error(
          `WhatsApp statement send: Meta has disabled the WhatsApp Business Account ` +
            `(Twilio ${META_DISABLED_WABA_CODE}). Not retrying — while this lasts no send can succeed.`,
        );
      }
      return {
        ok: false,
        error:
          `Twilio refused the message immediately (status "${parsed.status}"` +
          (code ? `, code ${code}` : "") +
          `)${detail ? `: ${detail}` : ""}. Nothing reached the member.`,
        code,
        // A refusal Twilio made up front is about THIS message, so a retry of
        // the identical message repeats it.
        permanent: true,
      };
    }

    // The provider SID is what makes a log row traceable back to Twilio, and
    // what the status callback matches on.
    return {
      ok: true,
      sid: parsed.sid ?? "",
      status: parsed.status ?? "queued",
      delivery,
    };
  } catch (e) {
    // A network throw is NOT permanent — the same message may well send later.
    return {
      ok: false,
      error: `Could not reach Twilio: ${e instanceof Error ? e.message : String(e)}`,
      code: null,
      permanent: false,
    };
  }
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
