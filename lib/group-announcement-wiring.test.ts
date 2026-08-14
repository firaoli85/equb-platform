import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE GROUP ANNOUNCEMENT'S LOG ROW (Cycle-2 build, feature D).
//
// The action's contract, driven through fakes: an attempt that reached
// Telegram writes a MessageLog row with channel TELEGRAM and NO person —
// SENT on Telegram's ok (which, unlike Twilio's "queued", means the message
// IS in the chat), FAILED with Telegram's own words otherwise. A refusal
// before the wire writes nothing: never attempted, so it did not fail at the
// provider — the engine's own rule.

const logCreate = vi.fn(async (args: unknown) => args);

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ ok: true as const, userId: "admin-1" })),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async () => false), // presentationMode off
  WHATSAPP_DISABLED_REASON: "SWITCH OFF",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { messageLog: { create: logCreate } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function action() {
  vi.resetModules();
  const { sendGroupAnnouncement } = await import("@/app/actions/messages");
  return sendGroupAnnouncement;
}

beforeEach(() => {
  logCreate.mockClear();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
  vi.stubEnv("TELEGRAM_GROUP_CHAT_ID", "-1001234567890");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a send that reaches Telegram is logged", () => {
  it("writes SENT, channel TELEGRAM, no person, addressed to the chat id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
    );
    const send = await action();
    const result = await send({ text: "  Draw is Sunday 8pm.  " });
    expect(result.ok).toBe(true);
    expect(logCreate).toHaveBeenCalledTimes(1);
    expect((logCreate.mock.calls[0] as unknown[])[0]).toEqual({
      data: {
        personId: null,
        templateId: null,
        templateKey: "TELEGRAM_BROADCAST",
        body: "Draw is Sunday 8pm.",
        channel: "TELEGRAM",
        toPhone: "-1001234567890",
        trigger: "MANUAL",
        status: "SENT",
        error: null,
      },
    });
  });

  it("a Telegram refusal is logged FAILED, carrying Telegram's description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: "Bad Request: chat not found" }),
      })),
    );
    const send = await action();
    const result = await send({ text: "hello group" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("chat not found");
    const row = (logCreate.mock.calls[0] as unknown[])[0] as {
      data: { status: string; error: string; channel: string };
    };
    expect(row.data.status).toBe("FAILED");
    expect(row.data.channel).toBe("TELEGRAM");
    expect(row.data.error).toContain("chat not found");
  });
});

describe("a refusal before the wire writes NO row", () => {
  it("missing config refuses at the control and leaves the log alone", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const send = await action();
    const result = await send({ text: "hello" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("TELEGRAM_BOT_TOKEN");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });
});
