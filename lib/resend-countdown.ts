// WHEN THE RESEND CONTROL IS ALLOWED, AND WHAT IT SAYS.
//
// Pure, so the wording and the arithmetic are testable without a timer or a
// rendered component — the two things that actually go wrong here are an
// off-by-one in the clock and a sentence that promises the wrong thing.

/** Long enough that a member waits for the message rather than re-requesting. */
export const RESEND_COOLDOWN_SECONDS = 45;

/** m:ss — "0:45", "0:09". */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type ResendState =
  | { enabled: false; reason: "cooling"; label: string; secondsLeft: number }
  | { enabled: false; reason: "sending"; label: string }
  | { enabled: true; label: string };

/**
 * What the resend control shows right now.
 *
 * THE WORDING IS THE POINT. Inside Twilio's 10-minute validity window a
 * re-request RE-SENDS THE SAME CODE — confirmed against Twilio's own attempt
 * log, where two requests six minutes apart share one verification SID. So
 * this never says "new code": a member told they are getting a new one, who
 * then receives the digits they already have, reasonably concludes the system
 * is broken. "Send it again" is what actually happens.
 *
 * `bypassCooldown` is for the case where the previous code is definitively
 * gone (no-verification). Making someone wait 45 seconds for a code that
 * cannot work is pointless, and the error that names the remedy has to be able
 * to offer it.
 */
export function resendState(input: {
  secondsLeft: number;
  sending: boolean;
  bypassCooldown?: boolean;
}): ResendState {
  if (input.sending) return { enabled: false, reason: "sending", label: "Sending…" };
  if (input.bypassCooldown || input.secondsLeft <= 0) {
    return { enabled: true, label: "Send it again" };
  }
  return {
    enabled: false,
    reason: "cooling",
    label: `Send it again in ${formatCountdown(input.secondsLeft)}`,
    secondsLeft: input.secondsLeft,
  };
}

/**
 * Which outcomes make RESENDING the right remedy.
 *
 * `unavailable` is deliberately absent. That outcome means Twilio was down,
 * our credentials were wrong, or our config was broken — resending cannot fix
 * any of those, and offering it as the fix sends a member round a loop that
 * was never going to work. They are told to try again in a moment instead.
 */
export function resendIsTheRemedy(outcome: string | null): boolean {
  return outcome === "no-verification" || outcome === "rate-limited";
}

/** Should the cooldown be skipped entirely for this outcome? */
export function resendBypassesCooldown(outcome: string | null): boolean {
  // Only when the previous code is definitively dead. A rate limit is Twilio
  // telling us to slow down, so the cooldown is exactly right there.
  return outcome === "no-verification";
}
