"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { sendGroupAnnouncement } from "@/app/actions/messages";
import { Card, CardHeader } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { TELEGRAM_MESSAGE_LIMIT } from "@/lib/telegram";

// GROUP ANNOUNCEMENT — the whole Telegram feature, on purpose (D-10, D-37:
// one bot, one chat, one message to everyone). Manual only: the organizer
// types it and presses send, nothing fires itself, and there is no
// per-member variant — WhatsApp is the per-member channel (2.28).
//
// The outcome lands AT THE CONTROL (UI_STANDARDS 6): sent fades, a refusal
// stays in Telegram's own words — "chat not found" from a wrong chat id, or
// which env variable is missing while the bot does not exist yet.

export function GroupAnnouncement({
  /** From telegramMissingConfig() — shown before typing, not after sending. */
  missingConfig,
}: {
  missingConfig: readonly string[];
}) {
  const router = useRouter();
  const textareaId = useId();
  const [text, setText] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const length = text.trim().length;
  const over = length > TELEGRAM_MESSAGE_LIMIT;

  async function send() {
    setSave({ kind: "saving" });
    try {
      const result = await sendGroupAnnouncement({ text });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not sent — ${result.error}` });
        return;
      }
      setSave({ kind: "ok", message: "Posted to the group." });
      setText("");
      router.refresh();
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was posted." });
    }
  }

  return (
    <Card>
      <CardHeader
        title="Group announcement"
        sub="One message to the whole Telegram group — the weekly broadcast. Members are not messaged individually from here."
      />
      <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800/60">
        {missingConfig.length > 0 && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 text-pretty">
            Telegram is not configured — {missingConfig.join(" and ")}{" "}
            {missingConfig.length === 1 ? "is" : "are"} not set. Create the bot with BotFather, add
            it to the group, and set {missingConfig.length === 1 ? "the variable" : "both"} in{" "}
            <code className="font-mono">.env.local</code>. Sending will refuse until then.
          </p>
        )}
        <label
          htmlFor={textareaId}
          className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
        >
          The announcement
        </label>
        <textarea
          id={textareaId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSave({ kind: "idle" });
          }}
          rows={4}
          placeholder="e.g. Week 14 draw is this Sunday at 8pm on the usual Zoom link."
          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-gray-800 dark:bg-black/20 dark:text-gray-100 dark:focus:ring-indigo-950"
        />
        <p
          className={`mt-1 text-xs tabular-nums ${over ? "font-semibold text-red-700 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}
        >
          {length.toLocaleString("en-US")} / {TELEGRAM_MESSAGE_LIMIT.toLocaleString("en-US")}
          {over && " — too long for one Telegram message"}
        </p>
        <SaveButton
          className="mt-3"
          state={save}
          onSave={() => void send()}
          onStateSettled={() =>
            setSave((current) => (current.kind === "ok" ? { kind: "idle" } : current))
          }
          label="Send to the group"
          savingLabel="Posting…"
          disabled={length === 0 || over}
        />
      </div>
    </Card>
  );
}
