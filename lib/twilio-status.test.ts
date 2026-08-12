import { describe, expect, it } from "vitest";
import {
  classifyTwilioStatus,
  isTerminal,
  loggedStatusFor,
  nextLoggedStatus,
} from "./twilio-status";
import { callbackErrorText, statusUpdateFor } from "./message-status-update";
import {
  expectedSignature,
  signatureBase,
  verifyTwilioSignature,
} from "./twilio-signature";

// A 201 IS NOT A DELIVERY.
//
// Ten MessageLog rows read SENT with error null while Twilio's own records
// showed all ten as status=failed, error_code=63112, and billed. Twilio answers
// a create with 201 Created and status:"queued" — acceptance — and applies the
// refusal asynchronously. The old code lifted `status` out of the body and then
// never looked at it, so queued/accepted/sent/failed/undelivered all became
// SENT.

describe("classifying Twilio's status word", () => {
  it("queued / accepted / sending are ACCEPTED, never delivered", () => {
    for (const status of ["queued", "accepted", "scheduled", "sending"]) {
      expect(classifyTwilioStatus(status), status).toBe("accepted");
      expect(loggedStatusFor(status), status).toBe("ACCEPTED");
    }
  });

  it("failed / undelivered are FAILED", () => {
    for (const status of ["failed", "undelivered", "canceled"]) {
      expect(loggedStatusFor(status), status).toBe("FAILED");
    }
  });

  it("sent / delivered / read are the only words that mean SENT", () => {
    for (const status of ["sent", "delivered", "read"]) {
      expect(loggedStatusFor(status), status).toBe("SENT");
    }
  });

  it("an UNKNOWN status is ACCEPTED — never silently delivered", () => {
    // If Twilio adds a word we have not seen, "we do not know yet" is the only
    // honest reading. Guessing "delivered" is the bug this file exists for.
    for (const status of ["", "  ", "wibble", null, undefined]) {
      expect(loggedStatusFor(status as string), String(status)).toBe("ACCEPTED");
    }
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(loggedStatusFor(" DELIVERED ")).toBe("SENT");
    expect(loggedStatusFor("Failed")).toBe("FAILED");
  });

  it("only SENT and FAILED are terminal", () => {
    expect(isTerminal("SENT")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("ACCEPTED")).toBe(false);
  });

  it("nextLoggedStatus never moves off a terminal state", () => {
    expect(nextLoggedStatus("FAILED", "SENT")).toBe("FAILED");
    expect(nextLoggedStatus("SENT", "FAILED")).toBe("SENT");
    expect(nextLoggedStatus("ACCEPTED", "FAILED")).toBe("FAILED");
    expect(nextLoggedStatus("ACCEPTED", "SENT")).toBe("SENT");
  });
});

describe("what a status callback does to a row", () => {
  it("moves ACCEPTED -> FAILED and records the 63112", () => {
    const update = statusUpdateFor({
      current: "ACCEPTED",
      incomingStatus: "failed",
      errorCode: "63112",
    });
    expect(update.apply).toBe(true);
    if (update.apply) {
      expect(update.status).toBe("FAILED");
      expect(update.error).toContain("63112");
    }
  });

  it("moves ACCEPTED -> SENT on delivery, clearing any error", () => {
    const update = statusUpdateFor({ current: "ACCEPTED", incomingStatus: "delivered" });
    expect(update.apply).toBe(true);
    if (update.apply) {
      expect(update.status).toBe("SENT");
      expect(update.error).toBeNull();
    }
  });

  // IDEMPOTENT. Twilio delivers callbacks at least once, so the same one
  // arrives twice as a matter of course.
  it("a DUPLICATE callback changes nothing the second time", () => {
    const first = statusUpdateFor({ current: "ACCEPTED", incomingStatus: "failed", errorCode: "63112" });
    expect(first.apply).toBe(true);

    // The row is now FAILED; the identical callback arrives again.
    const second = statusUpdateFor({ current: "FAILED", incomingStatus: "failed", errorCode: "63112" });
    expect(second.apply).toBe(false);
    if (!second.apply) expect(second.reason).toContain("Duplicate");
  });

  // OUT OF ORDER. Twilio guarantees no ordering, so a `sent` can overtake a
  // `failed` for the same message. Applied naively that walks a dead message
  // back to delivered — the same false claim, by another route.
  it("an OUT-OF-ORDER callback cannot regress a terminal state", () => {
    const late = statusUpdateFor({ current: "FAILED", incomingStatus: "sent" });
    expect(late.apply).toBe(false);
    if (!late.apply) expect(late.reason).toContain("terminal");

    const reverse = statusUpdateFor({ current: "SENT", incomingStatus: "failed", errorCode: "63112" });
    expect(reverse.apply).toBe(false);
  });

  it("an ACCEPTED-to-ACCEPTED callback (queued -> sending) is a no-op", () => {
    const update = statusUpdateFor({ current: "ACCEPTED", incomingStatus: "sending" });
    expect(update.apply).toBe(false);
  });

  it("the error text keeps the code, which is the whole diagnosis", () => {
    expect(callbackErrorText("63112", null)).toContain("63112");
    expect(callbackErrorText("63112", "Meta disabled")).toBe("Twilio 63112: Meta disabled");
    expect(callbackErrorText(null, null)).toBeNull();
  });
});

// THE ENDPOINT IS PUBLIC and it rewrites the message log — the organizer's
// record of what was said to whom. Anyone who learns the URL can POST to it.
describe("Twilio signature validation", () => {
  const TOKEN = "test-auth-token";
  const URL_ = "https://equb.example.com/api/twilio/status";
  const PARAMS = {
    MessageSid: "MM5adfd3d702a8f2b4cc1d8345b6d9c382",
    MessageStatus: "failed",
    ErrorCode: "63112",
  };

  it("accepts a correctly signed request", () => {
    expect(
      verifyTwilioSignature({
        authToken: TOKEN,
        url: URL_,
        params: PARAMS,
        signature: expectedSignature(TOKEN, URL_, PARAMS),
      }),
    ).toBe(true);
  });

  it("REJECTS an unsigned request — missing is not valid", () => {
    for (const signature of [null, undefined, "", "   "]) {
      expect(
        verifyTwilioSignature({ authToken: TOKEN, url: URL_, params: PARAMS, signature }),
        String(signature),
      ).toBe(false);
    }
  });

  it("rejects a forged signature", () => {
    expect(
      verifyTwilioSignature({
        authToken: TOKEN,
        url: URL_,
        params: PARAMS,
        signature: "bm90LWEtcmVhbC1zaWduYXR1cmU=",
      }),
    ).toBe(false);
  });

  it("rejects a signature made with a DIFFERENT token", () => {
    expect(
      verifyTwilioSignature({
        authToken: TOKEN,
        url: URL_,
        params: PARAMS,
        signature: expectedSignature("someone-elses-token", URL_, PARAMS),
      }),
    ).toBe(false);
  });

  it("rejects when a parameter has been tampered with", () => {
    const signature = expectedSignature(TOKEN, URL_, PARAMS);
    expect(
      verifyTwilioSignature({
        authToken: TOKEN,
        url: URL_,
        // An attacker flipping a failure into a delivery.
        params: { ...PARAMS, MessageStatus: "delivered" },
        signature,
      }),
    ).toBe(false);
  });

  it("rejects when the URL differs", () => {
    const signature = expectedSignature(TOKEN, URL_, PARAMS);
    expect(
      verifyTwilioSignature({
        authToken: TOKEN,
        url: "https://evil.example.com/api/twilio/status",
        params: PARAMS,
        signature,
      }),
    ).toBe(false);
  });

  it("signs URL + params sorted by key, concatenated", () => {
    // Twilio's documented scheme, asserted literally rather than by
    // re-deriving it the same way the implementation does.
    expect(signatureBase("https://x/y", { b: "2", a: "1" })).toBe("https://x/ya1b2");
  });
});
