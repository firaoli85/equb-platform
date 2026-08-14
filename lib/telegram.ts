// TELEGRAM GROUP BROADCAST — the transport (D-10, D-37: one bot, one chat,
// one message to everyone, and nothing else).
//
// This is deliberately the WHOLE Telegram surface: no per-member sends, no
// automation, no templates. WhatsApp is the per-member channel (2.28);
// Telegram is the town square. A function that took a chat id as input would
// be the first step toward per-member Telegram, so the chat id comes from env
// and nothing else.
//
// HONEST IN THE UNCONFIGURED STATE, by design. The bot does not exist until
// the organizer creates it with BotFather, so every path here returns a
// refusal naming exactly which variable is missing — never a throw, and never
// a generic "failed". The settings screen derives its Configured/Not
// configured line from the same check, so the two cannot disagree.
//
// Env vars (set in .env.local when the bot exists):
//   TELEGRAM_BOT_TOKEN      from BotFather
//   TELEGRAM_GROUP_CHAT_ID  the group's chat id (negative number for groups)

export type TelegramSendResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /**
       * Did this reach the wire? A refusal BEFORE the network (missing
       * config, empty, too long) is not an attempt, and the caller's log
       * follows the engine's rule: a message that was never attempted did
       * not FAIL at the provider, so it gets no log row.
       */
      attempted: boolean;
    };

/** Telegram's hard limit for one sendMessage call. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Which of the two variables are missing, for the settings screen and the
 * refusal below — one rule, asked by both, so the status line and the send
 * cannot disagree about whether the channel is configured.
 */
export function telegramMissingConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) missing.push("TELEGRAM_BOT_TOKEN");
  if (!process.env.TELEGRAM_GROUP_CHAT_ID?.trim()) missing.push("TELEGRAM_GROUP_CHAT_ID");
  return missing;
}

/**
 * Post one message to the group. Returns a result, never throws.
 *
 * A NON-OK RESPONSE CARRIES TELEGRAM'S OWN WORDS. The Bot API answers errors
 * with a `description` ("Bad Request: chat not found", "Unauthorized"), and
 * that sentence is the difference between the organizer fixing a wrong chat
 * id in a minute and reporting "it says failed" with nothing to quote.
 */
export async function sendTelegramGroupMessage(text: string): Promise<TelegramSendResult> {
  const missing = telegramMissingConfig();
  if (missing.length > 0) {
    return {
      ok: false,
      attempted: false,
      error:
        `Telegram is not configured on this machine — ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} not set in .env.local. Create the bot with ` +
        `BotFather, add it to the group, and set ${missing.length === 1 ? "the variable" : "both variables"}.`,
    };
  }

  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, attempted: false, error: "There is nothing to send — the announcement is empty." };
  }
  if (trimmed.length > TELEGRAM_MESSAGE_LIMIT) {
    return {
      ok: false,
      attempted: false,
      error:
        `Telegram delivers at most ${TELEGRAM_MESSAGE_LIMIT.toLocaleString("en-US")} characters ` +
        `in one message, and this is ${trimmed.length.toLocaleString("en-US")}. Shorten it, or ` +
        `send it as two announcements.`,
    };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_GROUP_CHAT_ID,
          text: trimmed,
        }),
      },
    );
    // Telegram answers every call with { ok, description? } — read it either
    // way, because a 200 with ok:false exists in its API surface.
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        attempted: true,
        error: `Telegram did not accept the message — ${payload?.description ?? `HTTP ${response.status}`}. Nothing was posted.`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      attempted: true,
      error: `Could not reach Telegram — ${e instanceof Error ? e.message : "network error"}. Nothing was posted.`,
    };
  }
}
