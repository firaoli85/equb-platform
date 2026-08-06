"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setPresentationMode } from "@/app/actions/settings";

/**
 * The screen-share switch (2.4/D-6), reachable from every admin header in one
 * click. ON shows a calm, unmistakable pill — visible to the organizer,
 * unremarkable to anyone watching the share.
 */
export function PresentationToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function flip() {
    setBusy(true);
    setError(false);
    try {
      const result = await setPresentationMode({ on: !on });
      if (!result.ok) setError(true);
      else router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void flip()}
      title={
        on
          ? "Presentation mode is ON: names, money, plans, phones and the audit log are hidden. Click to show them again."
          : "Hide names, money, plans, phones and the audit log before screen-sharing. Click to turn on."
      }
      // Both themes, measured: the OFF state used gray-500 with no dark
      // variant, which fell to 4.09:1 on the dark shell. ON is a safety state
      // (2.4), so it is a solid fill nobody can mistake for off.
      className={
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none " +
        (on
          ? "border-amber-500 bg-amber-500 text-amber-950 hover:bg-amber-400 dark:border-amber-400 dark:bg-amber-400 dark:text-amber-950"
          : "border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-white/5")
      }
    >
      {error ? "Could not switch — try again" : busy ? "Switching…" : on ? "● Presentation" : "○ Presentation off"}
    </button>
  );
}
