import { describe, expect, it, vi } from "vitest";
import {
  describeSmsError,
  isValidE164,
  RECAPTCHA_TIMEOUT,
  smsErrorLogLine,
  smsErrorMessage,
  SMS_SEND_TIMEOUT_MS,
  withTimeout,
} from "./sms-login";

// The bug these guard against was a DIAGNOSTIC failure: a hang that logged
// nothing, and a catch block that turned every distinct cause into one
// generic sentence. Both are regressions waiting to happen, so both are
// pinned here.

describe("withTimeout — a hang must never look like progress", () => {
  it("rejects with a NAMED error when nothing settles in time", async () => {
    vi.useFakeTimers();
    try {
      const pending = new Promise<string>(() => {}); // never settles
      const raced = withTimeout(pending, 1000);
      const assertion = expect(raced).rejects.toMatchObject({ name: RECAPTCHA_TIMEOUT });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("the timeout message says what was being waited for", async () => {
    vi.useFakeTimers();
    try {
      const raced = withTimeout(new Promise<string>(() => {}), 10);
      const assertion = expect(raced).rejects.toThrow(/reCAPTCHA/i);
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a value straight through when it resolves in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("passes the ORIGINAL rejection through — the timeout never masks a real error", async () => {
    const real = Object.assign(new Error("boom"), { code: "auth/quota-exceeded" });
    await expect(withTimeout(Promise.reject(real), 1000)).rejects.toBe(real);
  });

  it("clears its timer on success, so nothing fires afterwards", async () => {
    vi.useFakeTimers();
    try {
      await expect(withTimeout(Promise.resolve(1), 1000)).resolves.toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the configured wait is long enough to solve a puzzle but finite", () => {
    expect(SMS_SEND_TIMEOUT_MS).toBe(60_000);
  });
});

describe("smsErrorMessage — a failure must always name itself", () => {
  it("translates the Firebase codes a member can actually hit", () => {
    const cases: [string, RegExp][] = [
      ["auth/too-many-requests", /too many attempts/i],
      ["auth/invalid-phone-number", /not in a valid format/i],
      ["auth/quota-exceeded", /temporarily unavailable/i],
      ["auth/captcha-check-failed", /reCAPTCHA check failed/i],
      ["auth/unauthorized-domain", /not authorised/i],
      ["auth/operation-not-allowed", /not enabled/i],
      ["auth/network-request-failed", /connection/i],
    ];
    for (const [code, expected] of cases) {
      expect(smsErrorMessage({ code }), code).toMatch(expected);
    }
  });

  it("NAMES an untranslated code instead of hiding it", () => {
    // The old behaviour returned one generic sentence for everything, which
    // is what made this undiagnosable.
    expect(smsErrorMessage({ code: "auth/some-new-code" })).toContain("auth/some-new-code");
  });

  it("falls back to the raw message when there is no code at all", () => {
    expect(smsErrorMessage(new Error("container missing"))).toContain("container missing");
  });

  it("the timeout gets its own actionable message, not a code dump", () => {
    const timeout = Object.assign(new Error("timed out"), { name: RECAPTCHA_TIMEOUT });
    const msg = smsErrorMessage(timeout);
    expect(msg).toMatch(/security check/i);
    expect(msg).toMatch(/PIN/);
  });

  it("never returns an empty or undefined-laden string", () => {
    for (const input of [null, undefined, {}, "", 0, new Error("")]) {
      const msg = smsErrorMessage(input);
      expect(msg.trim().length).toBeGreaterThan(0);
      expect(msg).not.toContain("undefined");
    }
  });
});

describe("smsErrorLogLine — the console must carry the real facts", () => {
  it("includes the code, name and message", () => {
    const line = smsErrorLogLine("send", {
      code: "auth/argument-error",
      name: "FirebaseError",
      message: "recaptcha container not found",
    });
    expect(line).toContain("[SMS send]");
    expect(line).toContain("auth/argument-error");
    expect(line).toContain("FirebaseError");
    expect(line).toContain("recaptcha container not found");
  });

  it("says plainly when the throw was not a Firebase error", () => {
    expect(smsErrorLogLine("verify", new Error("plain"))).toContain("not a Firebase AuthError");
  });

  it("describeSmsError never throws on odd inputs", () => {
    for (const input of [null, undefined, "string", 42]) {
      expect(() => describeSmsError(input)).not.toThrow();
    }
  });
});

describe("isValidE164 — rejected before any request, so it must be named", () => {
  it("accepts real international numbers", () => {
    expect(isValidE164("+12405550187")).toBe(true);
    expect(isValidE164("+251911234567")).toBe(true);
  });

  it("rejects what Firebase would reject client-side", () => {
    for (const bad of ["", "+", "2405550187", "+0405550187", "+12405550187123456", "not a number"]) {
      expect(isValidE164(bad), bad).toBe(false);
    }
  });
});
