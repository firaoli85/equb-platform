"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { broadcastAnnouncement, sendGroupAnnouncement } from "@/app/actions/messages";
import { Card, CardHeader, inputCls } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { TELEGRAM_MESSAGE_LIMIT } from "@/lib/telegram";

// The server refuses over 1,000 for the WhatsApp side (Meta's rendered-body
// cap minus the template's fixed text and a name) — the card must not learn
// that limit by hitting it.
const WHATSAPP_ANNOUNCEMENT_LIMIT = 1000;

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
  // TWO CHANNELS, TWO SLOTS (UI_STANDARDS rule 6): each button's outcome
  // renders under the button that was pressed, and one send never speaks for
  // the other.
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [waSave, setWaSave] = useState<SaveState>({ kind: "idle" });
  const length = text.trim().length;
  const over = length > TELEGRAM_MESSAGE_LIMIT;
  // TWO CHANNELS, TWO LIMITS. WhatsApp's is far tighter (the server refuses
  // over 1,000, and Meta additionally refuses line breaks in template text) —
  // the counter and the button must say so BEFORE the press, not answer it.
  const overWhatsApp = length > WHATSAPP_ANNOUNCEMENT_LIMIT;
  const multiline = /[\n\r\t]| {4,}/.test(text.trim());
  const busy = save.kind === "saving" || waSave.kind === "saving";

  async function send() {
    setSave({ kind: "saving" });
    try {
      const result = await sendGroupAnnouncement({ text });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not sent — ${result.error}` });
        return;
      }
      setSave({ kind: "ok", message: "Posted to the Telegram group." });
      router.refresh();
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was posted." });
    }
  }

  // THE WHATSAPP SIDE (v2 set): the same text, delivered per member through
  // the Meta-approved group_announcement template — each recipient reads
  // their own name. The counts are the honest outcome: hardship-flagged and
  // phoneless members are skipped by the same gates every statement obeys.
  async function broadcast() {
    setWaSave({ kind: "saving" });
    try {
      const result = await broadcastAnnouncement({ text });
      if (!result.ok) {
        setWaSave({ kind: "err", message: `Not sent — ${result.error}` });
        return;
      }
      const { left, skipped, failed, total } = result.data;
      // A count is not a reason: the per-member reasons live in the log, and
      // this line must not guess them. And zero handed over is never a green
      // outcome, whatever the skip reasons were.
      setWaSave(
        failed > 0 || (left === 0 && total > 0)
          ? {
              kind: "err",
              message:
                left === 0
                  ? `Nothing was handed to WhatsApp — all ${total} were ${failed > 0 ? "refused or skipped" : "skipped"}. The log below has each member's reason.`
                  : `Handed to WhatsApp for ${left} of ${total} members — ${failed} failed, ${skipped} skipped. The log below has each reason.`,
            }
          : {
              kind: "ok",
              message: `Handed to WhatsApp for ${left} of ${total} members${skipped > 0 ? ` — ${skipped} skipped, each reason in the log below` : ""}.`,
            },
      );
      router.refresh();
    } catch {
      setWaSave({ kind: "err", message: "Could not reach the server — nothing was sent." });
    }
  }

  return (
    <Card>
      <CardHeader
        title="Group announcement"
        sub="One message to everyone, composed once. WhatsApp delivers it to each member personally through the approved template; Telegram posts it to the group chat."
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
            // BOTH slots reset: a confirmation or error describing the
            // PREVIOUS announcement must not sit under a button about to send
            // a different one.
            setSave({ kind: "idle" });
            setWaSave({ kind: "idle" });
          }}
          rows={4}
          placeholder="e.g. Week 14 draw is this Sunday at 8pm on the usual Zoom link."
          className={`mt-2 ${inputCls}`}
        />
        <p
          className={`mt-1 text-xs tabular-nums ${over || overWhatsApp || multiline ? "font-semibold text-red-700 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}
        >
          {length.toLocaleString("en-US")} / {WHATSAPP_ANNOUNCEMENT_LIMIT.toLocaleString("en-US")}{" "}
          for WhatsApp · {TELEGRAM_MESSAGE_LIMIT.toLocaleString("en-US")} for Telegram
          {over && " — too long for one Telegram message"}
          {!over && overWhatsApp && " — too long for WhatsApp; Telegram can still carry it"}
          {multiline && " — line breaks only reach Telegram; WhatsApp needs one line"}
        </p>
        <div className="mt-3 space-y-2">
          {/* WhatsApp first — the per-member channel every statement uses. */}
          <SaveButton
            state={waSave}
            onSave={() => void broadcast()}
            onStateSettled={() =>
              setWaSave((current) => (current.kind === "ok" ? { kind: "idle" } : current))
            }
            label="Send on WhatsApp to every member"
            savingLabel="Sending to each member…"
            disabled={length === 0 || overWhatsApp || multiline || busy}
          />
          <SaveButton
            state={save}
            onSave={() => void send()}
            onStateSettled={() =>
              setSave((current) => (current.kind === "ok" ? { kind: "idle" } : current))
            }
            label="Post to the Telegram group"
            savingLabel="Posting…"
            tone="secondary"
            disabled={length === 0 || over || busy}
          />
        </div>
      </div>
    </Card>
  );
}
