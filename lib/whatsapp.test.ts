import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The WhatsApp channel switch and the Meta-disabled (63112) case.
//
// lib/whatsapp.ts reads the setting through lib/settings, which talks to the
// database — so settings is mocked here and the module is imported fresh per
// test. What is under test is the TRANSPORT boundary: does a disabled channel
// reach the network at all, and is 63112 reported as permanent?

const WHATSAPP_DISABLED_REASON =
  "WhatsApp is disabled — Meta has disabled the Business Account. Turn back on once resolved.";

let enabled = true;

vi.mock("./settings", () => ({
  getSetting: vi.fn(async (key: string) => (key === "whatsappEnabled" ? enabled : true)),
  WHATSAPP_DISABLED_REASON,
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

describe("whatsappEnabled — the channel switch", () => {
  it("a DISABLED channel never touches the network, for statements", async () => {
    enabled = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage("+12405550187", "hello");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(WHATSAPP_DISABLED_REASON);
      expect(result.permanent).toBe(true);
    }
  });

  it("a DISABLED channel never touches the network, for LOGIN CODES either", async () => {
    // Login codes ride the same Business Account, so one switch covers both.
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
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage("+12405550187", "hello");
    expect(fetchSpy).not.toHaveBeenCalled();
    if (!result.ok) expect(result.error).toBe(WHATSAPP_DISABLED_REASON);
  });

  it("an ENABLED channel does send", async () => {
    const fetchSpy = vi.fn(async () =>
      twilioResponse(201, { sid: "SM123", status: "queued" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage("+12405550187", "hello");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, sid: "SM123", status: "queued" });
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
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage("+12405550187", "hello");
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
    const { sendWhatsAppMessage } = await freshModule();

    await sendWhatsAppMessage("+12405550187", "hello");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("logs ONE plain line naming the cause — not a stack", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => twilioResponse(400, { code: 63112, message: "x" })));
    const { sendWhatsAppMessage } = await freshModule();

    await sendWhatsAppMessage("+12405550187", "hello");
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
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage("+12405550187", "hello");
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
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage("+12405550187", "hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).not.toBe(true);
  });
});
