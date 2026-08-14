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
import { WHATSAPP_DISABLED_REASON } from "./setting-defaults";

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
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "+13016835755");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// TWO PATHS, ONE CHANNEL, BOTH WORKING (7 Aug 2026). Login codes go through
// Twilio Verify as a pre-approved template; statements go through the
// Messages API as Meta-approved Content templates by ContentSid — never a
// freeform Body, because the 24-hour window is open for nobody on this
// account (one inbound message ever, 19 May 2026). Tested separately because
// they are different transports with different failure modes.
const SEND = {
  toE164Phone: "+12405550187",
  contentSid: "HX87cb0a437434f7f9bba329958c74544a",
  contentVariables: { "1": "Sara", "2": "$750", "3": "4–6", "4": "6", "5": "20" },
  body: "Hi Sara, we received $750 …",
};

describe("statements now SEND — but only as an approved template", () => {
  it("posts ContentSid and ContentVariables, never a Body", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url: String(url), body: String(init.body) });
        return twilioResponse(201, { sid: "SM123", status: "queued" });
      }),
    );
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage(SEND);
    // `delivery` is part of the contract now: "queued" is Twilio ACCEPTING the
    // message, and the caller must be able to tell that from delivery.
    expect(result).toEqual({
      ok: true,
      sid: "SM123",
      status: "queued",
      delivery: "accepted",
    });

    const sent = new URLSearchParams(calls[0].body);
    expect(calls[0].url).toContain("api.twilio.com");
    expect(sent.get("To")).toBe("whatsapp:+12405550187");
    expect(sent.get("From")).toBe("whatsapp:+13016835755");
    expect(sent.get("ContentSid")).toBe(SEND.contentSid);
    expect(JSON.parse(sent.get("ContentVariables")!)).toEqual(SEND.contentVariables);
    // A Body would make it freeform, which Meta refuses outside the window.
    expect(sent.get("Body")).toBeNull();
    // One sender, 27 members — a service container adds a layer with nothing
    // behind it, and would silently override From.
    expect(sent.get("MessagingServiceSid")).toBeNull();
  });

  it("NEVER sends without a ContentSid — that would be a freeform send", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage({ ...SEND, contentSid: "  " });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.permanent).toBe(true);
  });

  it("the switch still stops every statement dead", async () => {
    enabled = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage(SEND);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(WHATSAPP_DISABLED_REASON);
  });

  it("refuses cleanly when the sender number is not configured", async () => {
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage(SEND);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Guarded: a block entered only on failure passes vacuously if the
    // call unexpectedly SUCCEEDS, which is the failure worth catching.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("TWILIO_WHATSAPP_FROM");
  });
});

describe("classifying a statement failure", () => {
  async function sendWith(status: number, body: unknown) {
    vi.stubGlobal("fetch", vi.fn(async () => twilioResponse(status, body)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendWhatsAppMessage } = await freshModule();
    return sendWhatsAppMessage(SEND);
  }

  it("21656 is PERMANENT — our variables, so a retry repeats the bug", async () => {
    const r = await sendWith(400, { code: 21656, message: "ContentVariables invalid" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(21656);
      expect(r.permanent).toBe(true);
    }
  });

  it("63016 is PERMANENT — it means we sent with no ContentSid, a code defect", async () => {
    const r = await sendWith(400, { code: 63016, message: "outside window" });
    // Guarded: a block entered only on failure passes vacuously if the
    // call unexpectedly SUCCEEDS, which is the failure worth catching.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(63016);
      expect(r.permanent).toBe(true);
    }
  });

  it("63112 is PERMANENT — the sender is blocked", async () => {
    const r = await sendWith(400, { code: 63112, message: "disabled" });
    // Guarded: a block entered only on failure passes vacuously if the
    // call unexpectedly SUCCEEDS, which is the failure worth catching.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanent).toBe(true);
  });

  it("a 429 or 5xx is NOT permanent — the same message may send later", async () => {
    for (const status of [429, 500, 503]) {
      const r = await sendWith(status, { code: 20429, message: "slow down" });
      // Guarded: a block entered only on failure passes vacuously if the
      // call unexpectedly SUCCEEDS, which is the failure worth catching.
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.permanent, String(status)).not.toBe(true);
    }
  });

  it("a network throw is NOT permanent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const { sendWhatsAppMessage } = await freshModule();
    const r = await sendWhatsAppMessage(SEND);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanent).not.toBe(true);
  });

  it("an unrecognised code is NOT permanent", async () => {
    const r = await sendWith(400, { code: 12345, message: "something new" });
    // Guarded: a block entered only on failure passes vacuously if the
    // call unexpectedly SUCCEEDS, which is the failure worth catching.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanent).not.toBe(true);
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
    // Guarded: a block entered only on failure passes vacuously if the
    // call unexpectedly SUCCEEDS, which is the failure worth catching.
    expect(result.ok).toBe(false);
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

  it("logs a plain line naming the cause — not a stack", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => twilioResponse(400, { code: 63112, message: "x" })));
    const { sendWhatsAppVerification } = await freshModule();

    await sendWhatsAppVerification("+12405550187");
    // TWO lines now, deliberately, and the count is no longer pinned: the raw
    // [verify-send] capture of Twilio's complete body, then this diagnosis.
    // The capture exists because a real failure was once unrecoverable — the
    // verification behind it had been deleted before anyone could look, and
    // nothing had kept the response. What this test still holds is that the
    // DIAGNOSIS is one readable sentence rather than a stack trace.
    const diagnosis = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes("Meta has disabled"));
    expect(diagnosis, "the 63112 diagnosis line is missing").toBeDefined();
    expect(diagnosis).toContain("63112");
    expect(diagnosis).toContain("Not retrying");
    expect(diagnosis).toContain("whatsappEnabled");
    expect(diagnosis).not.toContain("    at ");
  });

  it("OTHER Twilio errors stay non-permanent and keep their own message", async () => {
    // 63016 USED TO BE THE EXAMPLE HERE, as "the 24-hour window rule — a
    // different message could succeed". That reading is now wrong. Every
    // statement goes out as an approved template and a template needs no
    // window, so 63016 can only mean the send carried no ContentSid — a code
    // defect, and permanent. A genuinely transient code is used instead.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        twilioResponse(429, { code: 20429, message: "Too Many Requests" }),
      ),
    );
    const { sendWhatsAppVerification } = await freshModule();

    const result = await sendWhatsAppVerification("+12405550187");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(20429);
      expect(result.permanent).toBe(false);
      expect(result.error).toContain("Too Many Requests");
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

// ————————————————————————————————————————————————————————————————
// A 201 IS NOT A DELIVERY.
//
// Ten rows read SENT while Twilio's records showed all ten failed with 63112,
// billed. Twilio answers a create with 201 Created + status:"queued", which is
// ACCEPTANCE; the refusal lands asynchronously. `res.ok` alone treated every
// one of those as success.
// ————————————————————————————————————————————————————————————————

describe("the immediate response status is read, not just the HTTP code", () => {
  function respond(status: number, body: unknown) {
    vi.stubGlobal("fetch", vi.fn(async () => twilioResponse(status, body)));
  }

  it('201 with status:"queued" is ACCEPTED — not delivered', async () => {
    respond(201, { sid: "MM123", status: "queued" });
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage(SEND);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("queued");
      // THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG.
      expect(result.delivery).toBe("accepted");
      expect(result.delivery).not.toBe("delivered");
    }
  });

  it('201 with status:"failed" and a code is FAILED, not SENT', async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    respond(201, {
      sid: "MM123",
      status: "failed",
      error_code: 63112,
      error_message: "Channel Sender is disabled",
    });
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage(SEND);
    // A 2xx that says "failed" is a failure. res.ok was the whole test before.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(63112);
      expect(result.permanent).toBe(true);
      expect(result.error).toContain("63112");
      expect(result.error).toContain("Channel Sender is disabled");
    }
  });

  it('201 with status:"undelivered" is also a failure', async () => {
    respond(201, { sid: "MM123", status: "undelivered", error_code: 63024 });
    const { sendWhatsAppMessage } = await freshModule();
    const result = await sendWhatsAppMessage(SEND);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(63024);
  });

  it('201 with status:"delivered" is the only shape that means delivered', async () => {
    respond(201, { sid: "MM123", status: "delivered" });
    const { sendWhatsAppMessage } = await freshModule();
    const result = await sendWhatsAppMessage(SEND);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.delivery).toBe("delivered");
  });

  it("an unrecognised status is accepted, never delivered", async () => {
    respond(201, { sid: "MM123", status: "wibble" });
    const { sendWhatsAppMessage } = await freshModule();
    const result = await sendWhatsAppMessage(SEND);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.delivery).toBe("accepted");
  });
});

describe("StatusCallback — the only way to hear a message failed", () => {
  it("is sent with the message when APP_BASE_URL is public", async () => {
    vi.stubEnv("APP_BASE_URL", "https://equb.example.com");
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        bodies.push(String(init.body));
        return twilioResponse(201, { sid: "MM123", status: "queued" });
      }),
    );
    const { sendWhatsAppMessage } = await freshModule();

    await sendWhatsAppMessage(SEND);
    const sent = new URLSearchParams(bodies[0]);
    expect(sent.get("StatusCallback")).toBe("https://equb.example.com/api/twilio/status");
  });

  it("is OMITTED rather than malformed when no base URL is set", async () => {
    // Twilio rejects a malformed StatusCallback outright, which would turn
    // "no delivery reporting" into "no delivery".
    vi.stubEnv("APP_BASE_URL", "");
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        bodies.push(String(init.body));
        return twilioResponse(201, { sid: "MM123", status: "queued" });
      }),
    );
    const { sendWhatsAppMessage } = await freshModule();

    const result = await sendWhatsAppMessage(SEND);
    expect(result.ok).toBe(true);
    expect(new URLSearchParams(bodies[0]).get("StatusCallback")).toBeNull();
  });

  it("is omitted for a non-http value rather than sent as garbage", async () => {
    vi.stubEnv("APP_BASE_URL", "localhost:3000");
    const { statusCallbackUrl } = await freshModule();
    expect(statusCallbackUrl()).toBeNull();
  });
});

// ————————————————————————————————————————————————————————————————
// THE LOGIN-CODE CHECK MUST NEVER BLAME THE MEMBER FOR OUR FAILURE.
//
// There were two buckets: 404 → "expired", everything else → "That code is
// not right." So a Twilio outage, a rate limit, bad credentials and missing
// config all told a member they had mistyped a code that was perfectly
// correct — and sent them to retype it, which could not work.
//
// One member hit this for real on 12 Aug: a code that had arrived seconds
// earlier was rejected as expired. The verification behind it was deleted by
// Twilio (10-minute TTL) before anyone could look, because nothing recorded
// the response body. The cause is gone for good.
// ————————————————————————————————————————————————————————————————

describe("checkWhatsAppVerification — one outcome per real cause", () => {
  const CASES: {
    what: string;
    status: number;
    body: unknown;
    expected: string;
  }[] = [
    { what: '200 "pending" — genuinely the wrong code', status: 200, body: { status: "pending" }, expected: "wrong-code" },
    { what: '200 "approved"', status: 200, body: { status: "approved" }, expected: "approved" },
    { what: '200 "canceled" — the code can no longer work', status: 200, body: { status: "canceled" }, expected: "no-verification" },
    { what: "404 / 20404 — no pending verification", status: 404, body: { code: 20404, message: "not found" }, expected: "no-verification" },
    { what: "429 — Twilio is rate-limiting US", status: 429, body: { code: 20429, message: "Too Many Requests" }, expected: "rate-limited" },
    { what: "401 — our credentials are wrong", status: 401, body: { code: 20003, message: "Authenticate" }, expected: "unavailable" },
    { what: "403 — our account is forbidden", status: 403, body: { code: 20003, message: "Forbidden" }, expected: "unavailable" },
    { what: "500 — Twilio is down", status: 500, body: { message: "Internal Server Error" }, expected: "unavailable" },
    { what: "503 — Twilio is unavailable", status: 503, body: { message: "Service Unavailable" }, expected: "unavailable" },
    { what: "200 with an unparseable body", status: 200, body: "<html>not json</html>", expected: "unavailable" },
  ];

  for (const c of CASES) {
    it(`${c.what} → ${c.expected}`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: c.status >= 200 && c.status < 300,
          status: c.status,
          text: async () => (typeof c.body === "string" ? c.body : JSON.stringify(c.body)),
        })),
      );
      const { checkWhatsAppVerification } = await freshModule();
      expect(await checkWhatsAppVerification("+12405550187", "123456")).toBe(c.expected);
    });
  }

  it("a network throw → unavailable, never wrong-code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const { checkWhatsAppVerification } = await freshModule();
    expect(await checkWhatsAppVerification("+12405550187", "123456")).toBe("unavailable");
  });

  it("missing credentials → unavailable, never wrong-code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { checkWhatsAppVerification } = await freshModule();
    expect(await checkWhatsAppVerification("+12405550187", "123456")).toBe("unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing service SID → unavailable, never wrong-code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "");
    const { checkWhatsAppVerification } = await freshModule();
    expect(await checkWhatsAppVerification("+12405550187", "123456")).toBe("unavailable");
  });

  // THE ASSERTION THE WHOLE BUILD EXISTS FOR. Stated separately from the table
  // so it cannot be weakened by editing a row.
  it("NO outage or misconfiguration is ever reported as a wrong code", async () => {
    const OURS = [401, 403, 500, 502, 503, 504];
    for (const status of OURS) {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false, status, text: async () => "{}" })),
      );
      const { checkWhatsAppVerification } = await freshModule();
      const result = await checkWhatsAppVerification("+12405550187", "123456");
      expect(result, `HTTP ${status}`).toBe("unavailable");
      expect(result, `HTTP ${status} must never read as the member's mistake`).not.toBe(
        "wrong-code",
      );
    }
  });
});

describe("every non-OK Verify response is written to the server log", () => {
  it("logs the COMPLETE body, with a stable prefix and a masked number", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const BODY = '{"code":20404,"message":"The requested resource ... was not found","status":404}';
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, text: async () => BODY })));
    const { checkWhatsAppVerification } = await freshModule();

    await checkWhatsAppVerification("+12405550187", "123456");
    const line = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(line).toContain("[verify-check]");
    expect(line).toContain("HTTP 404");
    // The whole body — 20404 versus anything else is the entire diagnosis.
    expect(line).toContain(BODY);
    // Masked to the last four; a log is not a phone directory.
    expect(line).toContain("***0187");
    expect(line).not.toContain("+12405550187");
  });

  it("NEVER logs the code the member typed — it is a live credential", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "{}" })));
    const { checkWhatsAppVerification } = await freshModule();

    await checkWhatsAppVerification("+12405550187", "918273");
    const line = errorSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(line).not.toContain("918273");
  });

  it("the SEND half logs its failures too, under its own prefix", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const BODY = '{"code":63112,"message":"Channel Sender disabled"}';
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, text: async () => BODY })));
    const { sendWhatsAppVerification } = await freshModule();

    await sendWhatsAppVerification("+12405550187");
    const line = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(line).toContain("[verify-send]");
    expect(line).toContain(BODY);
  });
});

// ————————————————————————————————————————————————————————————————
// THE ENDPOINT PATHS. ASSERTED, BECAUSE NOTHING EVER LOOKED AT THEM.
//
// The check posted to /VerificationChecks — PLURAL — for four builds. Twilio's
// endpoint is /VerificationCheck, SINGULAR. Every request 20404'd, and the
// member was told their correct code had expired.
//
// 44 tests were green the whole time. Every one of them mocked `fetch` and
// asserted on the RESULT; not one inspected the URL, so a request to an
// endpoint that does not exist looked exactly like a request to one that does.
// That is the gap these close: the URL is now part of the contract.
//
// THE TWO PATHS ARE ASYMMETRIC AND MUST STAY THAT WAY:
//   send  → /Verifications      (plural)
//   check → /VerificationCheck  (singular)
// Making them agree breaks whichever one is "corrected". Confirmed against
// the Twilio SDK's own source, which works today against this same service.
//
// WHAT A WRONG PATH LOOKS LIKE — so it is recognised next time rather than
// mistaken for a lapsed code:
//   {"code":20404,"message":"The requested resource
//    /v2/Services/VAb84.../VerificationChecks was not found"}
// A 20404 naming the PATH is a wrong endpoint. A missing verification is the
// same code, but the platform can only tell them apart by reading the message.
// ————————————————————————————————————————————————————————————————

describe("the Verify endpoint paths", () => {
  async function urlFor(call: "send" | "check"): Promise<string> {
    const urls: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ sid: "VE1", service_sid: "VAtest", status: "pending", to: "+12405550187" }),
        };
      }),
    );
    const mod = await freshModule();
    if (call === "send") await mod.sendWhatsAppVerification("+12405550187");
    else await mod.checkWhatsAppVerification("+12405550187", "123456");
    return urls[0];
  }

  it("CHECK posts to /VerificationCheck — singular", async () => {
    const url = await urlFor("check");
    expect(url.endsWith("/VerificationCheck"), url).toBe(true);
  });

  it("CHECK does NOT post to /VerificationChecks — the four-build bug", async () => {
    const url = await urlFor("check");
    expect(url.endsWith("/VerificationChecks"), url).toBe(false);
    expect(url, "plural is the endpoint that does not exist").not.toContain("VerificationChecks");
  });

  it("SEND posts to /Verifications — plural, and must not be 'corrected'", async () => {
    const url = await urlFor("send");
    expect(url.endsWith("/Verifications"), url).toBe(true);
  });

  it("the two are DIFFERENT — the asymmetry is the point", async () => {
    const send = await urlFor("send");
    const check = await urlFor("check");
    expect(send).not.toBe(check);
    expect(send.endsWith("s")).toBe(true);
    expect(check.endsWith("s")).toBe(false);
  });

  it("both hang off the same v2 service base", async () => {
    for (const call of ["send", "check"] as const) {
      const url = await urlFor(call);
      expect(url, call).toContain("https://verify.twilio.com/v2/Services/");
      expect(url, call).toContain("VAtest");
    }
  });
});
