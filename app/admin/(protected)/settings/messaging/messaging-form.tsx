"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateNotifyOnLockout, updateWhatsappEnabled } from "@/app/actions/settings";
import { SettingList, SettingSwitch } from "@/components/admin/setting-row";
import { Alert, buttonCls } from "@/components/ui/primitives";
// From setting-defaults, NOT lib/settings: the latter imports Prisma, which
// imports `pg`, which imports node:dns — pulling that into a client bundle is
// a hard build failure that takes this whole page down with it.
import {
  WHATSAPP_DISABLED_REASON,
  WHATSAPP_STATEMENTS_BLOCKED_REASON,
} from "@/lib/setting-defaults";

export function MessagingForm({
  initial,
}: {
  initial: { whatsappEnabled: boolean; notifyOnLockout: boolean };
}) {
  const router = useRouter();
  const [whatsappEnabled, setWhatsappEnabled] = useState(initial.whatsappEnabled);
  const [notifyOnLockout, setNotifyOnLockout] = useState(initial.notifyOnLockout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function touched() {
    setError(null);
    setSaved(false);
  }

  const dirty =
    whatsappEnabled !== initial.whatsappEnabled || notifyOnLockout !== initial.notifyOnLockout;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    touched();
    setSaving(true);
    try {
      if (whatsappEnabled !== initial.whatsappEnabled) {
        const r = await updateWhatsappEnabled({ enabled: whatsappEnabled });
        if (!r.ok) return setError(r.error);
      }
      if (notifyOnLockout !== initial.notifyOnLockout) {
        const r = await updateNotifyOnLockout({ enabled: notifyOnLockout });
        if (!r.ok) return setError(r.error);
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server — nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <SettingList>
        <SettingSwitch
          label="WhatsApp"
          tone={whatsappEnabled ? "neutral" : "danger"}
          checked={whatsappEnabled}
          onChange={(v) => {
            setWhatsappEnabled(v);
            touched();
          }}
          description={
            <>
              The switch for WhatsApp <strong>sign-in codes</strong>. While it is off nothing
              is attempted: sends are refused before they reach Twilio, so none are billed and
              no member is offered a code that cannot arrive.
              <br />
              <span className="mt-1 block">
                It does <strong>not</strong> control statements or payment confirmations —
                those are blocked for a different reason that no setting can change, explained
                below.
              </span>
            </>
          }
          state={
            whatsappEnabled ? (
              <span className="text-emerald-700 dark:text-emerald-400">
                ON — sign-in codes are sent
              </span>
            ) : (
              <span className="text-red-800 dark:text-red-400">
                OFF — no codes are sent, and the sign-in screen does not offer it
              </span>
            )
          }
        />
        <SettingSwitch
          label="Notice when a member locks themselves out"
          checked={notifyOnLockout}
          onChange={(v) => {
            setNotifyOnLockout(v);
            touched();
          }}
          description={
            <>
              Sends the Lockout notice template — calm, it-unlocks-by-itself wording, editable
              under Messages. The hardship &ldquo;no messages&rdquo; flag on a person still wins.
              Every send lands in the message log, successful or not.
            </>
          }
        />
      </SettingList>

      {/* Unconditional: true whether the switch above is on or off. */}
      <Alert kind="err">
        <strong>{WHATSAPP_STATEMENTS_BLOCKED_REASON}</strong>
        <span className="mt-1 block">
          Meta accepts a freeform message only within 24 hours of the member&apos;s own last
          reply to the Equb sender, and this account has had one inbound message ever (19 May
          2026) — so that window is open for nobody. Sign-in codes are unaffected: Twilio
          Verify sends a pre-approved template, which needs no window. Making statements
          deliverable means registering each one as a Content template — it is not a switch.
        </span>
      </Alert>

      {!whatsappEnabled && (
        <Alert kind="info">
          <strong>Why codes are off:</strong> {WHATSAPP_DISABLED_REASON}
        </Alert>
      )}

      {error && <Alert kind="err">Not saved: {error}</Alert>}
      {saved && <Alert kind="ok">✓ Saved.</Alert>}

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
