"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateClosingWaitDays } from "@/app/actions/settings";
import { SettingList, SettingNumber } from "@/components/admin/setting-row";
import { Alert, buttonCls } from "@/components/ui/primitives";

// THE RULES A CYCLE RUNS BY.
//
// This page exists because of one specific complaint: the closing wait — a rule
// about whether last week's money lands on the week or becomes a permanent
// carried debt — was a number input sitting three inches below "WhatsApp notice
// on lockout". Money rules belong with money rules.

export function CycleRulesForm({ initial }: { initial: { closingWaitDays: number } }) {
  const router = useRouter();
  const [days, setDays] = useState(String(initial.closingWaitDays));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = days !== String(initial.closingWaitDays);
  const parsed = Number(days);
  const zero = Number.isSafeInteger(parsed) && parsed === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const r = await updateClosingWaitDays({ days: parsed });
      if (!r.ok) return setError(r.error);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server — nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
            setError(null);
            setSaved(false);
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

      {error && <Alert kind="err">Not saved: {error}</Alert>}
      {saved && <Alert kind="ok">✓ Saved. The pre-close review reads this immediately.</Alert>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={!dirty || saving} className={buttonCls.primary}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {!dirty && !saved && (
          <span className="text-xs text-gray-600 dark:text-gray-400">Nothing changed yet.</span>
        )}
      </div>
    </form>
  );
}
