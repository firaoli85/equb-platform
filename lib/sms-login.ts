// Firebase Phone Auth failure handling, kept out of the component so it is
// unit-testable — because the bug this exists to prevent was a DIAGNOSTIC
// failure, not a logic one.
//
// WHAT WENT WRONG. "Text me a code" appeared to do nothing: the reCAPTCHA
// badge rendered, no request was ever made to identitytoolkit, the console
// stayed clean, and the member saw one generic sentence. Two separate causes,
// both invisible:
//
//   1. The catch block threw the error away. Every distinct failure — bad
//      container, unauthorised domain, malformed number — arrived as the same
//      message, with nothing logged.
//
//   2. The real failure was a HANG, not a throw. signInWithPhoneNumber awaits
//      RecaptchaVerifier.verify(), which resolves ONLY when reCAPTCHA yields
//      a token. When reCAPTCHA challenges the visitor, that token arrives
//      only after a human solves the puzzle — and if nobody does, the promise
//      never settles. Verified in a real browser: the challenge iframe mounts
//      at 375×555 and the promise stays pending indefinitely. A pending
//      promise logs nothing and sends nothing, which is exactly the reported
//      symptom.
//
// So: every wait is bounded, and every failure names itself.

/** Long enough to solve an image puzzle; short enough to never hang. */
export const SMS_SEND_TIMEOUT_MS = 60_000;

/** error.name used for the bounded-wait rejection. */
export const RECAPTCHA_TIMEOUT = "RecaptchaTimeout";

/**
 * Reject with a NAMED error when a promise has not settled in time, so a hang
 * is reported like any other failure instead of spinning forever.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(
        "Timed out waiting for the reCAPTCHA check to complete. If a reCAPTCHA " +
          "challenge appeared, it was not completed.",
      );
      err.name = RECAPTCHA_TIMEOUT;
      reject(err);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type SmsErrorFacts = { code: string; name: string; message: string };

/**
 * Everything worth logging about a failure, pulled out safely. A throw can be
 * anything at all — null, a string, a number — so the message never becomes
 * the literal word "undefined" in front of a member.
 */
export function describeSmsError(error: unknown): SmsErrorFacts {
  const err = error as { code?: string; message?: string; name?: string } | null;
  const raw = err?.message ?? (error == null ? "" : String(error));
  const message = raw.trim() === "" || raw === "undefined" || raw === "[object Object]"
    ? "no error detail was provided"
    : raw;
  return { code: err?.code ?? "", name: err?.name ?? "", message };
}

/** The console line — one readable block, not an opaque object dump. */
export function smsErrorLogLine(stage: "send" | "verify", error: unknown): string {
  const { code, name, message } = describeSmsError(error);
  return (
    `[SMS ${stage}] Firebase Phone Auth failed\n` +
    `  code   : ${code || "(none — not a Firebase AuthError)"}\n` +
    `  name   : ${name || "(none)"}\n` +
    `  message: ${message}`
  );
}

/**
 * What the MEMBER is told. Known Firebase codes get plain English; anything
 * unknown still names its code, so a silent generic can never come back.
 */
export function smsErrorMessage(error: unknown): string {
  const { code, name, message } = describeSmsError(error);

  if (name === RECAPTCHA_TIMEOUT) {
    return "The security check wasn't completed. If a reCAPTCHA puzzle appeared, solve it and try again — or use your PIN.";
  }
  switch (code) {
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/invalid-verification-code":
      return "That code is not right.";
    case "auth/code-expired":
      return "That code expired — request a new one.";
    case "auth/invalid-phone-number":
      return "That phone number is not in a valid format.";
    case "auth/quota-exceeded":
      return "SMS is temporarily unavailable. Try WhatsApp or your PIN.";
    case "auth/captcha-check-failed":
      return "The reCAPTCHA check failed. Reload the page and try again.";
    case "auth/unauthorized-domain":
      return "This site is not authorised for SMS sign-in. Contact the organizer.";
    case "auth/argument-error":
      return "SMS sign-in could not start on this page. Reload and try again.";
    case "auth/operation-not-allowed":
      return "SMS sign-in is not enabled for this project. Contact the organizer.";
    case "auth/network-request-failed":
      return "Could not reach the network. Check your connection and try again.";
    case "auth/internal-error":
      return "The sign-in service returned an error. Try again, or use another method.";
    default:
      return code
        ? `Could not send the code (${code}). Try again, or use another method.`
        : `Could not send the code: ${message}. Try again, or use another method.`;
  }
}

/**
 * Firebase rejects a non-E.164 number client-side, before any request — one
 * more way to fail with nothing on the network to look at. Checked first so
 * the reason can be named.
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}
