"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateClosingWaitDays } from "@/app/actions/settings";
import { SettingList, SettingNumber } from "@/components/admin/setting-row";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { Alert } from "@/components/ui/primitives";

// THE RULES A CYCLE RUNS BY.
//
// This page exists because of one specific complaint: the closing wait — a rule
// about whether last week's money lands on the week or becomes a permanent
// carried debt — was a number input sitting three inches below "WhatsApp notice
// on lockout". Money rules belong with money rules.

export function CycleRulesForm({ initial }: { initial: { closingWaitDays: number } }) {
  const router = useRouter();
  const [days, setDays] = useState(String(initial.closingWaitDays));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const dirty = days !== String(initial.closingWaitDays);
  const parsed = Number(days);
  const zero = Number.isSafeInteger(parsed) && parsed === 0;

  async function handleSubmit() {
    setSave({ kind: "saving" });
    try {
      const r = await updateClosingWaitDays({ days: parsed });
      if (!r.ok) return setSave({ kind: "err", message: `Not saved: ${r.error}` });
      setSave({
        kind: "ok",
        message: `Saved — a cycle can be closed ${parsed === 0 ? "as soon as its last week passes" : `${parsed} day${parsed === 1 ? "" : "s"} after its last week`}.`,
      });
      router.refresh();
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was saved." });
    }
  }

  return (
    <div className="space-y-4">
      <SettingList>
        <SettingNumber
          label="Wait before a cycle can be closed"
          description={
            <>
              Closing writes every shortfall onto the members&apos; carried ledgers and freezes
              the books for good. Money for the last week routinely arrives days late — the
              payment window itself is 5 days — so this holds closing open long enough for it to
              land on the week instead of becoming a debt somebody carries for years.
            </>
          }
          value={days}
          onChange={(v) => {
            setDays(v);
            setSave({ kind: "idle" });
          }}
          min={0}
          max={90}
          unit="days"
        />
      </SettingList>

      {zero && (
        <Alert kind="info">
          At <strong>0</strong> the cycle can be closed the moment its last week passes. Anything
          that arrives afterwards becomes a carried balance rather than a paid week.
        </Alert>
      )}

      {/* The confirmation belongs to the button, not to the page (rule 6). */}
      <SaveButton
        state={save}
        onSave={() => void handleSubmit()}
        onStateSettled={() => setSave({ kind: "idle" })}
        label="Save changes"
        dirty={dirty}
        notDirtyHint="Nothing has changed yet."
      />
    </div>
  );
}
