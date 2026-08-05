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
      className={
        on
          ? "rounded-full border border-gray-500 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800 disabled:opacity-40"
          : "rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-500 hover:border-gray-500 disabled:opacity-40"
      }
    >
      {error ? "Could not switch — try again" : busy ? "Switching…" : on ? "● Presentation" : "○ Presentation off"}
    </button>
  );
}
