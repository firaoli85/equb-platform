// WhatsApp delivery via Twilio — ported from the previous build's WORKING,
// Meta-approved integration (equb-app: src/lib/twilio.ts + the
// whatsapp-send/whatsapp-verify routes). Sender +13016835755, display name
// "Equb", approved under the platform's own business-verified WABA
// 1018506704190290 (12 Aug 2026). The Healthway Transport LLC approval
// belonged to the RETIRED 555-prefix sender — §2.28's sender-history note.
//
// Two Twilio products, two jobs — they are not interchangeable, and BOTH WORK
// as of 7 August 2026:
//   • Verify API   — login codes ONLY. Twilio owns the content and sends a
//     pre-approved template, which needs no service window.
//   • Messages API — statements, each carried by a Meta-approved Content
//     template, addressed by ContentSid + ContentVariables. A template needs
//     no service window either, which is the whole reason statements became
//     possible: freeform never could be — the 24-hour window is open for
//     nobody on this account — and there is deliberately NO freeform `Body`
//     path here. See docs/WHATSAPP_TEMPLATE_ONLY.md.
//
// Credentials come from env ONLY, and every function returns a result
// object — honest errors, never a throw that reaches the UI.
//
// Env vars (see .env.local):
//   TWILIO_ACCOUNT_SID        account
//   TWILIO_AUTH_TOKEN         account secret
//   TWILIO_VERIFY_SERVICE_SID Verify service (login codes)
//   TWILIO_WHATSAPP_FROM      the approved sender, e.g. +13016835755
//
// Meta constraint that shaped all of this (2.28): a freeform body is
// deliverable only inside the 24-hour service window after the member's last
// inbound message, so every statement is a pre-approved template. The
// registry (lib/whatsapp-templates.ts) pairs each key with its ContentSid; a
// key with none refuses itself in the engine before anything reaches Twilio.

import { getSetting, WHATSAPP_DISABLED_REASON } from "./settings";
import { classifyTwilioStatus, type DeliveryClass } from "./twilio-status";

const VERIFY_BASE = "https://verify.twilio.com/v2/Services";

// THE TWO VERIFY ENDPOINTS ARE ASYMMETRIC, AND THAT ASYMMETRY COST FOUR BUILDS.
//
// Send is PLURAL. Check is SINGULAR. They do not match, they are not a typo,
// and making them agree breaks whichever one you "corrected".
//
//   POST /v2/Services/{sid}/Verifications        ← create a verification
//   POST /v2/Services/{sid}/VerificationCheck    ← check a code
//
// The check used to post to /VerificationChecks. Twilio answered every single
// time with:
//
//   {"code":20404,"message":"The requested resource
//    /v2/Services/VAb84.../VerificationChecks was not found", ...}
//
// That message names the PATH, not a verification — it was saying "this
// endpoint does not exist", and it was read for four builds as "your code
// expired". A member entering a correct code seconds after it arrived was
// told it had expired, because the request never reached an endpoint at all.
//
// Confirmed against the Twilio SDK's own source, whose path works today
// against this same Verify Service:
//   node_modules/twilio/lib/rest/verify/v2/service/verificationCheck.js:29
//     instance._uri = `/Services/${serviceSid}/VerificationCheck`;
//   node_modules/twilio/lib/rest/verify/v2/service/verification.js:222
//     instance._uri = `/Services/${serviceSid}/Verifications`;
//
// Named constants so neither can be retyped at a call site, and so the pair
// is visible together rather than 130 lines apart.
const VERIFICATIONS_PATH = "Verifications";
const VERIFICATION_CHECK_PATH = "VerificationCheck";
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
 * This gates the WHOLE CHANNEL — login codes and statements alike; it is the
 * first check inside sendWhatsAppMessage too. The old "statements have their
 * own, harder gate" was the pre-approval block, deleted 7 Aug 2026.
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

/**
 * EVERY NON-OK VERIFY RESPONSE, WRITTEN DOWN.
 *
 * A member was told their login code had expired seconds after it arrived. By
 * the time anyone looked, Twilio had deleted the verification — a 10-minute
 * TTL — and the cause was gone for good. Nothing had recorded the response:
 * the check read `res.status`, returned a bucket, and discarded the body.
 *
 * So both halves now log the COMPLETE body. One stable prefix per half, so a
 * production log can be grepped for either.
 *
 * THE TYPED CODE IS NEVER LOGGED. It is a live credential for the seconds it
 * exists, and a login-code value in a log file is a login-code value anyone
 * with log access can use. The phone is masked to its last four for the same
 * reason — enough to match a member to a report, not enough to be a directory.
 */
function verifyLog(half: "check" | "send", to: string, what: string, detail: string): void {
  console.error(
    `[verify-${half}] ${new Date().toISOString()} to=***${to.slice(-4)} ${what}\n` +
      `  ${detail}`,
  );
}

/**
 * A phone value shown FAITHFULLY but not in full.
 *
 * The open question is about FORMAT, not digits: whether Twilio filed a
 * verification against "whatsapp:+1301…" while the check queries "+1301…".
 * That difference is in the prefix, and printing the whole number to answer it
 * would put a member's line in a log file for no gain.
 *
 * So every character except the middle digits survives — a "whatsapp:" prefix,
 * a leading "+", stray whitespace, a wrong country code all remain visible —
 * and the length is printed alongside, so a difference that masking would hide
 * still shows up as a different count.
 */
function describeTo(value: string): string {
  const total = (value.match(/\d/g) ?? []).length;
  let seen = 0;
  // Indexed by position among DIGITS, not among characters — otherwise a
  // "whatsapp:" prefix shifts the window and masks the wrong end.
  const masked = value.replace(/\d/g, (d) => {
    const keep = seen < 2 || seen >= total - 4;
    seen++;
    return keep ? d : "*";
  });
  return `${JSON.stringify(masked)} (len ${value.length})`;
}

/** Which credential is missing — named, so the log says what to fix. */
function credsMissingDetail(): string {
  const missing = (["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] as const).filter(
    (name) => !process.env[name]?.trim(),
  );
  return `Missing: ${missing.join(", ") || "(none — credentials() refused for another reason)"}`;
}

/** Start a WhatsApp login-code verification (Twilio Verify, channel whatsapp). */
export async function sendWhatsAppVerification(
  toE164Phone: string,
): Promise<
  | { ok: true }
  // The code and permanence are carried through rather than flattened away —
  // a 63112 on this path is the fastest sign the whole WABA is having an
  // outage, and throwing that detail away would leave login codes less
  // diagnosable than statements.
  | { ok: false; error: string; code?: number | null; permanent?: boolean }
> {
  // Login codes ride the same WhatsApp Business Account as statements, so a
  // 63112 outage takes both down — verified on this account in the 6–7 Aug
  // window, where Verify's own template sends failed alongside the rest.
  // Both paths ask the same channelRefusal(); the organizer's switch is the
  // one gate the whole channel shares.
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
    const res = await fetch(`${VERIFY_BASE}/${serviceSid}/${VERIFICATIONS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authHeader(creds.value),
      },
      body: new URLSearchParams({ To: toE164Phone, Channel: "whatsapp" }).toString(),
    });
    // Read ONCE, for both branches. A Response body can only be consumed once,
    // and the success path needs it too now.
    const sentText = await res.text();
    if (!res.ok) {
      // The body is captured BEFORE it is classified. `failure()` keeps the
      // code and a summary; this keeps everything, which is what was missing
      // when a real failure had to be reconstructed after the fact.
      verifyLog("send", toE164Phone, `HTTP ${res.status}`, sentText);
      const failed = failure("login code", res.status, sentText);
      if (failed.ok) return { ok: false, error: "Send failed." };
      return {
        ok: false,
        error: failed.error,
        code: failed.code ?? null,
        permanent: failed.permanent ?? false,
      };
    }
    // THE SUCCESSFUL SEND RESPONSE HAS NEVER BEEN LOOKED AT.
    //
    // This returned a bare { ok: true } and discarded the body — so when a
    // freshly created verification was checked seconds later and came back
    // 20404, there was no record of what Twilio had actually created. Logging
    // fired only on failure, and the send had not failed.
    //
    // The body carries sid, service_sid, status and — the one that matters —
    // the `to` Twilio ECHOES BACK. If Twilio filed the verification against
    // "whatsapp:+1301…" while the check queries "+1301…", the two never meet,
    // and this line is where that becomes visible instead of inferred.
    //
    // No code is logged: the send response does not contain one, and it stays
    // that way.
    try {
      const created = JSON.parse(sentText) as {
        sid?: string;
        service_sid?: string;
        status?: string;
        channel?: string;
        to?: string;
      };
      console.error(
        `[verify-send-ok] ${new Date().toISOString()} to=***${toE164Phone.slice(-4)}\n` +
          `  sid         : ${created.sid ?? "(absent)"}\n` +
          `  service_sid : ${created.service_sid ?? "(absent)"}\n` +
          `  status      : ${created.status ?? "(absent)"}\n` +
          `  channel     : ${created.channel ?? "(absent)"}\n` +
          `  to (echoed) : ${created.to === undefined ? "(absent)" : describeTo(created.to)}\n` +
          `  we sent To  : ${describeTo(toE164Phone)}`,
      );
    } catch {
      console.error(
        `[verify-send-ok] ${new Date().toISOString()} to=***${toE164Phone.slice(-4)} ` +
          `HTTP ${res.status} but the body did not parse:\n  ${sentText.slice(0, 500)}`,
      );
    }
    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    verifyLog("send", toE164Phone, "network error", detail);
    return { ok: false, error: `Could not reach Twilio: ${detail}` };
  }
}

/**
 * WHAT ACTUALLY HAPPENED when a login code was checked.
 *
 * THE DEFECT THIS REPLACES. There were two failure buckets: 404 became
 * "expired", and EVERYTHING ELSE became "invalid" — which the UI showed as
 * "That code is not right." Eight unrelated failures wore that sentence,
 * including a Twilio outage, a rate limit, bad credentials and missing
 * configuration. A member whose code was perfectly correct was told they had
 * typed it wrong, and the organizer had nothing to look at: the response body
 * was read for `status` and discarded.
 *
 * These are the outcomes a member can be told apart, and the reason each one
 * exists is that it needs DIFFERENT words.
 */
export type VerifyCheckResult =
  /** The code is right. */
  | "approved"
  /** Wrong code, verification still pending — they can try again. */
  | "wrong-code"
  /** No pending verification: expired, already used, canceled, or out of
   *  attempts. A new code is the only way forward. */
  | "no-verification"
  /** Twilio is rate-limiting us. Waiting is the answer, not retyping. */
  | "rate-limited"
  /**
   * OUR PROBLEM, NOT THEIRS — outage, auth failure, missing config, network.
   * The one outcome that must never be worded as a wrong code.
   */
  | "unavailable";

/** Check a WhatsApp login code. Any transport failure counts as invalid. */
export async function checkWhatsAppVerification(
  toE164Phone: string,
  code: string,
): Promise<VerifyCheckResult> {
  const creds = credentials();
  if (!creds.ok) {
    verifyLog("check", toE164Phone, "no credentials", credsMissingDetail());
    return "unavailable";
  }
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!serviceSid) {
    verifyLog("check", toE164Phone, "no service SID", "TWILIO_VERIFY_SERVICE_SID is not set.");
    return "unavailable";
  }
  // WHAT THE CHECK IS ABOUT TO SEND, IN THIS PROCESS, ON THIS REQUEST.
  //
  // The two halves have been compared by reading env vars and by a standalone
  // probe. Neither proves they agree on a REAL request pair in a running
  // server: a probe reads the same .env.local the server read at boot, and a
  // server that booted before an env change is holding different values than
  // the probe just read. This line and [verify-send-ok] are the same process,
  // seconds apart, so they can be compared character by character.
  //
  // The code is deliberately absent — it is a live credential.
  console.error(
    `[verify-check-req] ${new Date().toISOString()} to=***${toE164Phone.slice(-4)}\n` +
      `  service_sid : ${serviceSid}\n` +
      `  To (exact)  : ${describeTo(toE164Phone)}\n` +
      `  url         : ${VERIFY_BASE}/${serviceSid}/${VERIFICATION_CHECK_PATH}`,
  );

  try {
    const res = await fetch(`${VERIFY_BASE}/${serviceSid}/${VERIFICATION_CHECK_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authHeader(creds.value),
      },
      body: new URLSearchParams({ To: toE164Phone, Code: code }).toString(),
    });

    // THE BODY IS READ ONCE AND KEPT. It used to be read only for `status` on
    // the success path and thrown away on every failure — which is why the
    // verification behind a real "expired" was already deleted by Twilio
    // before anyone could look at it, and the cause is now unrecoverable.
    const text = await res.text();

    if (!res.ok) {
      // The complete body, never a summary. `20404` versus anything else is
      // the whole diagnosis, and a truncated line loses it.
      verifyLog("check", toE164Phone, `HTTP ${res.status}`, text);
      if (res.status === 404) return "no-verification";
      if (res.status === 429) return "rate-limited";
      // 401, 403, every 5xx: ours to fix, and never the member's fault.
      return "unavailable";
    }

    let status: string | undefined;
    try {
      status = (JSON.parse(text) as { status?: string }).status;
    } catch {
      // A 200 we cannot parse is not a wrong code — it is a broken response.
      verifyLog("check", toE164Phone, "HTTP 200, unparseable body", text);
      return "unavailable";
    }

    if (status === "approved") return "approved";
    // Canceled reads to the member exactly like a lapsed one: the code they
    // hold can no longer work, and only a new one will.
    if (status === "canceled") {
      verifyLog("check", toE164Phone, "HTTP 200, canceled", text);
      return "no-verification";
    }
    // "pending" — the verification is alive and the code did not match.
    return "wrong-code";
  } catch (e) {
    verifyLog("check", toE164Phone, "network error", e instanceof Error ? e.message : String(e));
    return "unavailable";
  }
}
