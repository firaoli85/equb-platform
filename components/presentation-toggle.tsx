"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setPresentationMode } from "@/app/actions/settings";
import { SaveFeedback, type SaveState } from "@/components/ui/save-button";

/**
 * The screen-share switch (2.4/D-6), reachable from every admin header in one
 * click. ON shows a calm, unmistakable pill — visible to the organizer,
 * unremarkable to anyone watching the share.
 *
 * SaveFeedback, NOT SaveButton (UI_STANDARDS rule 6). The pill IS the control,
 * and its own classes carry contrast measured for both themes (see below) that
 * SaveButton's generic button styling would throw away. Beat 1 does not apply
 * — a toggle is dirty the instant it is pressed. Beat 3 needs no message: the
 * confirmation is the pill turning solid amber and the whole screen redacting,
 * and a success line in a permanent header would never clear (SaveFeedback has
 * no fade — only SaveButton's timer does).
 *
 * Beat 4 is what was missing. The failure was `setError(true)` and a label that
 * read "Could not switch — try again": the SERVER'S REASON WAS DISCARDED, so a
 * refusal ("Not signed in as an organizer.") and a database outage were the
 * same sentence. The reason now renders beside the pill, as an alert, and stays
 * until the next press.
 *
 * The failure also left the LABEL not saying which state the toggle was in.
 * This is a safety control: it must always answer "is the screen safe to
 * share?", so the label now keeps reading the true state and the reason sits
 * next to it.
 */
export function PresentationToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const busy = save.kind === "saving";

  async function flip() {
    setSave({ kind: "saving" });
    try {
      const result = await setPresentationMode({ on: !on });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not switched: ${result.error}` });
        return;
      }
      setSave({ kind: "idle" });
      router.refresh();
    } catch {
      setSave({
        kind: "err",
        message: "Not switched: could not reach the server. The old setting still applies.",
      });
    }
  }

  return (
    // A SPAN, and inline-flex, deliberately: one caller renders this toggle
    // inside a <p> used as a layout row (app/admin/wheel/setup/page.tsx), and a
    // <div> there would be closed out of the paragraph by the HTML parser and
    // mismatch on hydration. The reason wraps onto its own line rather than
    // being truncated — the headers are tight, and a truncated reason is the
    // swallowed reason again.
    <span className="inline-flex flex-wrap items-center gap-2 align-middle">
      <button
        type="button"
        disabled={busy}
        onClick={() => void flip()}
        aria-busy={busy}
        title={
          on
            ? "Presentation mode is ON: names, money, plans, phones and the audit log are hidden. Click to show them again."
            : "Hide names, money, plans, phones and the audit log before screen-sharing. Click to turn on."
        }
        // Both themes, measured: the OFF state used gray-500 with no dark
        // variant, which fell to 4.09:1 on the dark shell. ON is a safety state
        // (2.4), so it is a solid fill nobody can mistake for off.
        className={
          "min-h-11 md:min-h-8 rounded-full border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none " +
          (on
            ? "border-amber-500 bg-amber-500 text-amber-950 hover:bg-amber-400 dark:border-amber-400 dark:bg-amber-400 dark:text-amber-950"
            : "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-white/5")
        }
      >
        {busy ? "Switching…" : on ? "● Presentation" : "○ Presentation off"}
      </button>

      <SaveFeedback state={save} className="text-xs font-semibold" />
    </span>
  );
}
