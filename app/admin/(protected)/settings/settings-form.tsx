"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  updateDefaultPinFromPhone,
  updateNotifyOnLockout,
  updatePinLockoutPolicy,
  updatePinLoginEnabled,
  updateWhatsappEnabled,
} from "@/app/actions/settings";
// From setting-defaults, NOT lib/settings: the latter imports Prisma, which
// imports `pg`, which imports node:dns — pulling that into a client bundle is
// a hard build failure that takes this whole page down.
import { WHATSAPP_DISABLED_REASON } from "@/lib/setting-defaults";

export function SettingsForm({
  initial,
}: {
  initial: {
    pinLoginEnabled: boolean;
    defaultPinFromPhone: boolean;
    pinMaxAttempts: number;
    pinLockMinutes: number;
    notifyOnLockout: boolean;
    whatsappEnabled: boolean;
  };
}) {
  const router = useRouter();
  const [pinLoginEnabled, setPinLoginEnabled] = useState(initial.pinLoginEnabled);
  const [defaultPinFromPhone, setDefaultPinFromPhone] = useState(initial.defaultPinFromPhone);
  const [maxAttempts, setMaxAttempts] = useState(String(initial.pinMaxAttempts));
  const [lockMinutes, setLockMinutes] = useState(String(initial.pinLockMinutes));
  const [notifyOnLockout, setNotifyOnLockout] = useState(initial.notifyOnLockout);
  const [whatsappEnabled, setWhatsappEnabled] = useState(initial.whatsappEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    pinLoginEnabled !== initial.pinLoginEnabled ||
    defaultPinFromPhone !== initial.defaultPinFromPhone ||
    maxAttempts !== String(initial.pinMaxAttempts) ||
    lockMinutes !== String(initial.pinLockMinutes) ||
    notifyOnLockout !== initial.notifyOnLockout ||
    whatsappEnabled !== initial.whatsappEnabled;

  function clearFeedback() {
    setError(null);
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearFeedback();
    setSaving(true);
    try {
      if (pinLoginEnabled !== initial.pinLoginEnabled) {
        const result = await updatePinLoginEnabled({ enabled: pinLoginEnabled });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      if (defaultPinFromPhone !== initial.defaultPinFromPhone) {
        const result = await updateDefaultPinFromPhone({ enabled: defaultPinFromPhone });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      if (
        maxAttempts !== String(initial.pinMaxAttempts) ||
        lockMinutes !== String(initial.pinLockMinutes)
      ) {
        const result = await updatePinLockoutPolicy({
          maxAttempts: Number(maxAttempts),
          lockMinutes: Number(lockMinutes),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      if (notifyOnLockout !== initial.notifyOnLockout) {
        const result = await updateNotifyOnLockout({ enabled: notifyOnLockout });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      if (whatsappEnabled !== initial.whatsappEnabled) {
        const result = await updateWhatsappEnabled({ enabled: whatsappEnabled });
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server — the setting was not confirmed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4">
      {/* The channel switch sits FIRST while it is off: it explains at a
          glance why no message is leaving the platform. */}
      <div
        className={`rounded border p-3 text-sm ${
          whatsappEnabled
            ? "border-gray-300 dark:border-gray-700"
            : "border-red-400 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
        }`}
      >
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={whatsappEnabled}
            onChange={(e) => {
              setWhatsappEnabled(e.target.checked);
              clearFeedback();
            }}
            className="mt-0.5"
          />
          <span>
            <strong>WhatsApp enabled</strong>
            <br />
            The master switch for the whole WhatsApp channel — payment confirmations, every
            manual statement, and WhatsApp login codes. While it is OFF nothing is attempted:
            sends are refused before they reach Twilio, so none are billed and no member is
            offered a code that cannot arrive.
          </span>
        </label>
        <p className="mt-2 font-semibold">
          Currently:{" "}
          {whatsappEnabled ? (
            <span className="text-emerald-700 dark:text-emerald-400">ON — sends are attempted</span>
          ) : (
            <span className="text-red-800 dark:text-red-400">OFF — nothing is sent</span>
          )}
        </p>
        {!whatsappEnabled && (
          <p className="mt-1 text-red-900 dark:text-red-300">{WHATSAPP_DISABLED_REASON}</p>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={pinLoginEnabled}
          onChange={(e) => {
            setPinLoginEnabled(e.target.checked);
            clearFeedback();
          }}
          className="mt-0.5"
        />
        <span>
          <strong>PIN login enabled</strong>
          <br />
          When off, members must use the WhatsApp code; PIN attempts are rejected
          server-side. Per-member overrides on their profile pages still apply.
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={defaultPinFromPhone}
          onChange={(e) => {
            setDefaultPinFromPhone(e.target.checked);
            clearFeedback();
          }}
          className="mt-0.5"
        />
        <span>
          <strong>Default PIN from phone</strong>
          <br />
          A member with no PIN set can sign in with the last 4 digits of their phone.
          Never stored — checked at sign-in only, and dead for anyone who sets their own
          PIN. Turn off when PIN login is retired.
        </span>
      </label>

      <div className="rounded border border-gray-300 dark:border-gray-700 p-3 text-sm">
        <p className="mb-2">
          <strong>PIN lockout</strong>
          <br />
          Read at every sign-in check — a change applies to the very next attempt (2.6).
          Wrong attempts on the phone-digit default count toward the same lock.
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Attempts before locking</span>
            <input
              type="number"
              min={1}
              max={20}
              value={maxAttempts}
              onChange={(e) => {
                setMaxAttempts(e.target.value);
                clearFeedback();
              }}
              className="w-28 rounded border border-gray-400 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Lock duration (minutes)</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={lockMinutes}
              onChange={(e) => {
                setLockMinutes(e.target.value);
                clearFeedback();
              }}
              className="w-28 rounded border border-gray-400 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={notifyOnLockout}
          onChange={(e) => {
            setNotifyOnLockout(e.target.checked);
            clearFeedback();
          }}
          className="mt-0.5"
        />
        <span>
          <strong>WhatsApp notice on lockout</strong>
          <br />
          When a member locks themselves out, send the Lockout notice template (calm
          it-unlocks-by-itself wording — editable under Messages). The hardship &ldquo;no
          messages&rdquo; flag still wins. Every send lands in the message log.
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800 dark:text-red-400">
          Not saved: {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-900">
          ✓ Saved — effective immediately.
        </p>
      )}

      <button
        type="submit"
        disabled={!dirty || saving}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
