import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The WhatsApp transport boundary: which sends reach the network at all.
//
// lib/whatsapp.ts reads the setting through lib/settings, which talks to the
// database — so settings is mocked here and the module is imported fresh per
// test. Under test: does a disabled channel reach the network, are statements
// refused unconditionally, and is 63112 reported as permanent?
//
// The reason strings are IMPORTED, never re-typed. They were duplicated here
// as literals and went stale the moment the real one changed — a test that
// asserts its own copy of a string proves nothing about what ships.
import {
  WHATSAPP_DISABLED_REASON,
  WHATSAPP_STATEMENTS_BLOCKED_REASON,
} from "./setting-defaults";

let enabled = true;

vi.mock("./settings", () => ({
  getSetting: vi.fn(async (key: string) => (key === "whatsappEnabled" ? enabled : true)),
  WHATSAPP_DISABLED_REASON,
  WHATSAPP_STATEMENTS_BLOCKED_REASON,
}));

async function freshModule() {
  vi.resetModules();
  return import("./whatsapp");
}

function twilioResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  enabled = true;
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
  vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VAtest");
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "+15559620327");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// THE TWO PATHS ARE NO LONGER ONE CHANNEL. Login codes go through Twilio
// Verify as a pre-approved template, which needs no 24-hour service window and
// works today. Statements post a freeform Body, which Meta accepts only inside
// a window this account has open for nobody (one inbound message ever, 19 May
// 2026). Sharing a single switch is what kept a WORKING login channel switched
// off, so these are now tested as the separate things they are.
describe("statements — blocked at the transport, whatever the switch says", () => {
  for (const state of [true, false]) {
    it(`never touches the network, with the switch ${state ? "ON" : "OFF"}`, async () => {
      enabled = state;
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { sendWhatsAppMessage } = await freshModule();

      const result = await sendWhatsAppMessage("+12405550187", "hello");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(WHATSAPP_STATEMENTS_BLOCKED_REASON);
        expect(result.permanent).toBe(true);
      }
    });
  }

  it("refuses without credentials — there is no config that makes it work", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage("+12405550187", "hello");
    expect(fetchSpy).not.toHaveBeenCalled();
    // NOT a "not configured" message — configuring it would change nothing.
    if (!result.ok) expect(result.error).toBe(WHATSAPP_STATEMENTS_BLOCKED_REASON);
  });
});

describe("whatsappEnabled — the switch, which governs LOGIN CODES", () => {
  it("a DISABLED channel never touches the network", async () => {
    enabled = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppVerification } = await freshModule();

    const result = await sendWhatsAppVerification("+12405550187");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(WHATSAPP_DISABLED_REASON);
  });

  it("the switch is checked BEFORE credentials — a dead channel needs no config", async () => {
    enabled = false;
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppVerification } = await freshModule();

    const result = await sendWhatsAppVerification("+12405550187");
    expect(fetchSpy).not.toHaveBeenCalled();
    if (!result.ok) expect(result.error).toBe(WHATSAPP_DISABLED_REASON);
  });

  it("an ENABLED channel does send a login code", async () => {
    const urls: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      urls.push(String(url));
      return twilioResponse(201, { status: "pending" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppVerification } = await freshModule();

    const result = await sendWhatsAppVerification("+12405550187");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    // …through Verify, not the Messages API.
    expect(urls[0]).toContain("verify.twilio.com");
  });
});

describe("Twilio 63112 — Meta disabled the Business Account", () => {
  it("is reported as PERMANENT, with the code preserved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        twilioResponse(400, {
          code: 63112,
          message: "Meta disabled the WhatsApp Business Account connected to this Sender",
        }),
      ),
    );
    const { sendWhatsAppVerification } = await freshModule();

    const result = await sendWhatsAppVerification("+12405550187");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(63112);
      expect(result.permanent).toBe(true);
      expect(result.error).toContain("Meta has disabled");
      expect(result.error).toContain("not retried");
    }
  });

  it("is attempted exactly ONCE — nothing retries it", async () => {
    const fetchSpy = vi.fn(async () => twilioResponse(400, { code: 63112, message: "disabled" }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppVerification } = await freshModule();

    await sendWhatsAppVerification("+12405550187");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("logs ONE plain line naming the cause — not a stack", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => twilioResponse(400, { code: 63112, message: "x" })));
    const { sendWhatsAppVerification } = await freshModule();

    await sendWhatsAppVerification("+12405550187");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain("Meta has disabled");
    expect(line).toContain("63112");
    expect(line).toContain("Not retrying");
    expect(line).toContain("whatsappEnabled");
  });

  it("OTHER Twilio errors stay non-permanent and keep their own message", async () => {
    // 63016 is the 24-hour window rule — a different message could succeed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        twilioResponse(400, { code: 63016, message: "Outside messaging window" }),
      ),
    );
    const { sendWhatsAppVerification } = await freshModule();

    const result = await sendWhatsAppVerification("+12405550187");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(63016);
      expect(result.permanent).toBe(false);
      expect(result.error).toContain("Outside messaging window");
    }
  });

  it("isMetaDisabledError recognises only 63112", async () => {
    const { isMetaDisabledError, META_DISABLED_WABA_CODE } = await freshModule();
    expect(META_DISABLED_WABA_CODE).toBe(63112);
    expect(isMetaDisabledError(63112)).toBe(true);
    expect(isMetaDisabledError(63016)).toBe(false);
    expect(isMetaDisabledError(null)).toBe(false);
    expect(isMetaDisabledError(undefined)).toBe(false);
  });

  it("a network failure is not mistaken for the permanent case", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const { sendWhatsAppVerification } = await freshModule();

    const result = await sendWhatsAppVerification("+12405550187");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).not.toBe(true);
  });
});
