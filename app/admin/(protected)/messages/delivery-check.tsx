"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reconcileDeliveries } from "@/app/actions/messages";
import { SaveButton, type SaveState } from "@/components/ui/save-button";

// "ACCEPTED" IS NOT "DELIVERED", AND ONLY TWILIO KNOWS WHICH.
//
// A row rests at ACCEPTED until a StatusCallback resolves it, and no callback
// can arrive while APP_BASE_URL is unset — which it is. So the log fills with
// messages whose real fate nobody has asked about: on 15 Aug 2026, 75 of 81
// rows disagreed with Twilio, most of them actually delivered and one dropped
// by Meta while the log still read Accepted.
//
// The organizer cannot be expected to know that, or to run a script about it.
// One button, and it says what changed rather than just that it ran.

export function DeliveryCheck() {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  async function check() {
    setState({ kind: "saving" });
    const result = await reconcileDeliveries();
    if (!result.ok) {
      setState({ kind: "err", message: result.error });
      return;
    }
    const { checked, corrected, unreadable } = result.data;
    // WHAT CHANGED, IN FIGURES. "Done" would leave him no wiser about whether
    // anything was wrong, which is the whole reason to press it.
    const parts = [
      checked === 0
        ? "Nothing was waiting on an answer."
        : `Checked ${checked} message${checked === 1 ? "" : "s"} with Twilio.`,
    ];
    if (corrected > 0) {
      parts.push(`${corrected} ${corrected === 1 ? "was" : "were"} wrong and ${corrected === 1 ? "has" : "have"} been corrected.`);
    } else if (checked > 0) {
      parts.push("They all matched.");
    }
    if (unreadable > 0) {
      parts.push(`${unreadable} could not be read back from Twilio and ${unreadable === 1 ? "was" : "were"} left alone.`);
    }
    setState({ kind: "ok", message: parts.join(" ") });
    router.refresh();
  }

  return (
    <SaveButton
      state={state}
      onSave={() => void check()}
      onStateSettled={() => setState({ kind: "idle" })}
      label="Check delivery with Twilio"
      savingLabel="Asking Twilio…"
      tone="secondary"
    />
  );
}
