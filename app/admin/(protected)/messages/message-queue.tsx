"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { discardQueued, sendQueued } from "@/app/actions/messages";
import { Card, CardHeader, buttonCls } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { LABELS_BY_KEY, isMessageKey } from "@/lib/messages";

// WAITING TO BE SENT — 2.20's preview, for the messages a payment originates.
//
// THE EXACT SENTENCE, NOT A DESCRIPTION OF IT. The body below was rendered by
// the send path itself at the moment the money landed, and it is the body that
// will leave; nothing recomposes it when the button is pressed. That is the
// whole promise of a preview, and a summary ("a partial notice for Markos")
// would break it while looking like it kept it.
//
// AT THE TOP OF THE PAGE, NOT BEHIND A TAB. A message nobody knows is waiting
// is a message that never goes out, and the member it was about is left with
// the silence this build exists to remove.

export type QueuedRow = {
  id: string;
  personName: string;
  templateKey: string;
  body: string;
  toPhone: string;
  reason: string;
  createdAt: string;
};

// SaveState, NOT A HAND-ROLLED PAIR. The shared control is what puts the
// outcome AT the button that was pressed (UI_STANDARDS 6) — and this card has
// one button per member, which is precisely the case where a page-level banner
// leaves the reader working out which row it meant.

export function MessageQueue({
  queued,
  error,
}: {
  queued: readonly QueuedRow[];
  /** Set when the queue could not be READ — never the same as being empty. */
  error?: string | null;
}) {
  const router = useRouter();
  // ONE STATE PER ROW, keyed by id (UI_STANDARDS 6): the outcome of sending
  // one member's message must render beside that member's message, never in a
  // shared banner that leaves the reader working out which one it meant.
  const [state, setState] = useState<Record<string, SaveState>>({});

  // AN UNREADABLE QUEUE IS SAID OUT LOUD. "Nothing is waiting" and "I could
  // not find out what is waiting" are different facts, and only one of them
  // means the organizer has nothing to do.
  if (error) {
    return (
      <Card className="border-red-300 dark:border-red-800">
        <CardHeader
          title="The waiting list could not be read"
          sub="This is not the same as nothing waiting. Messages may be held back and unseen until this is fixed."
        />
        <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
      </Card>
    );
  }
  if (queued.length === 0) return null;

  function set(id: string, value: SaveState) {
    setState((prev) => ({ ...prev, [id]: value }));
  }

  async function send(id: string) {
    set(id, { kind: "saving" });
    const result = await sendQueued({ id });
    if (!result.ok) {
      set(id, { kind: "err", message: result.error });
      return;
    }
    const { status, reason } = result.data;
    if (status === "SENT" || status === "ACCEPTED") {
      // GONE FROM THE LIST because it is gone from the queue — the row is
      // deleted server-side only when the message actually left.
      router.refresh();
      return;
    }
    set(id, {
      kind: "err",
      // ACCEPTED and SENT are handled above; anything else did NOT leave, and
      // says why. It stays queued, so the button is still there to press again.
      message: reason ?? "It did not send, and no reason came back.",
    });
  }

  async function discard(id: string) {
    set(id, { kind: "saving" });
    const result = await discardQueued({ id });
    if (!result.ok) {
      set(id, { kind: "err", message: result.error });
      return;
    }
    router.refresh();
  }

  return (
    <Card className="border-amber-300 dark:border-amber-700">
      <CardHeader
        title={`Waiting for you (${queued.length})`}
        sub={
          "Prepared when a payment was recorded, and held back because the setting for that " +
          "message says you send it by hand. This is the exact wording that will go out."
        }
      />
      <ul className="space-y-3">
        {queued.map((row) => {
          const rowState = state[row.id] ?? { kind: "idle" };
          const busy = rowState.kind === "saving";
          return (
            <li
              key={row.id}
              className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {row.personName}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {isMessageKey(row.templateKey)
                    ? LABELS_BY_KEY[row.templateKey]
                    : row.templateKey}{" "}
                  · {row.toPhone}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                {row.body}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{row.reason}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SaveButton
                  state={rowState}
                  onSave={() => void send(row.id)}
                  onStateSettled={() => set(row.id, { kind: "idle" })}
                  label="Send it"
                  savingLabel="Sending…"
                />
                <button
                  type="button"
                  className={buttonCls.ghost}
                  disabled={busy}
                  onClick={() => void discard(row.id)}
                >
                  Do not send
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
