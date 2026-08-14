import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendTelegramGroupMessage,
  telegramMissingConfig,
  TELEGRAM_MESSAGE_LIMIT,
} from "./telegram";

// THE TELEGRAM TRANSPORT (D-10, D-37 — Cycle-2 build, feature D).
//
// The bot does not exist until the organizer creates it, so the honest
// unconfigured state is the FIRST state this ships in — every test of the
// refusal path is a test of what the organizer meets today.

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:test-token");
  vi.stubEnv("TELEGRAM_GROUP_CHAT_ID", "-1001234567890");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the unconfigured state refuses by NAME, and never throws", () => {
  it("names the one variable that is missing", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const result = await sendTelegramGroupMessage("hello");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("TELEGRAM_BOT_TOKEN");
    expect(result.error).not.toContain("TELEGRAM_GROUP_CHAT_ID");
    // Never attempted — the caller writes no log row for it.
    expect(result.attempted).toBe(false);
  });

  it("names both when both are missing, and BotFather as the way out", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_GROUP_CHAT_ID", "");
    const result = await sendTelegramGroupMessage("hello");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID");
    expect(result.error).toContain("BotFather");
  });

  it("telegramMissingConfig is the same rule the settings screen reads", () => {
    expect(telegramMissingConfig()).toEqual([]);
    vi.stubEnv("TELEGRAM_GROUP_CHAT_ID", "  ");
    expect(telegramMissingConfig()).toEqual(["TELEGRAM_GROUP_CHAT_ID"]);
  });
});

describe("what actually goes on the wire", () => {
  it("POSTs sendMessage with the chat id and the trimmed text", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendTelegramGroupMessage("  Draw is Sunday 8pm.  ");
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123456:test-token/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: "-1001234567890",
      text: "Draw is Sunday 8pm.",
    });
  });

  // FALSIFIABLE: flatten the error to "Telegram failed" and this fails — the
  // organizer must be able to quote "chat not found" at the wrong chat id.
  it("a non-OK response carries Telegram's own description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: "Bad Request: chat not found" }),
      })),
    );
    const result = await sendTelegramGroupMessage("hello");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("Bad Request: chat not found");
    expect(result.attempted).toBe(true);
  });

  // Telegram can answer 200 with ok:false — a shape a status check alone
  // would report as success.
  it("a 200 whose body says ok:false is still a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, description: "Forbidden: bot was kicked" }),
      })),
    );
    const result = await sendTelegramGroupMessage("hello");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("bot was kicked");
  });

  it("a network failure is a refusal in words, never a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.telegram.org");
      }),
    );
    const result = await sendTelegramGroupMessage("hello");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("ENOTFOUND");
    expect(result.attempted).toBe(true);
  });

  it("refuses the empty and the too-long before the wire", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const empty = await sendTelegramGroupMessage("   ");
    expect(empty.ok).toBe(false);
    const long = await sendTelegramGroupMessage("x".repeat(TELEGRAM_MESSAGE_LIMIT + 1));
    expect(long.ok).toBe(false);
    if (long.ok) throw new Error("expected refusal");
    expect(long.error).toContain("4,096");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The settings screen's claim is DERIVED from config, never stored (§5.15 —
// this exact line said "Telegram group — working" while zero Telegram code
// existed, and nothing the organizer could do would check or clear it).
describe("no surface claims Telegram works unconditionally", () => {
  it("the settings page derives its status from telegramMissingConfig", () => {
    const page = readFileSync(
      join(import.meta.dirname, "..", "app", "admin", "(protected)", "settings", "messaging", "page.tsx"),
      "utf8",
    );
    expect(page).not.toContain("Telegram group — working");
    expect(page).toContain("telegramMissingConfig()");
  });
});
