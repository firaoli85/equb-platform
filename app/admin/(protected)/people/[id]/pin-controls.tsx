"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  resetMemberPin,
  setMemberPin,
  setPinLoginAllowed,
  unlockMemberPin,
} from "@/app/actions/auth";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";

export function PinControls({
  personId,
  personName,
  pinSet,
  pinLoginAllowed,
  pinFailedAttempts,
  lockedMinutesLeft,
  lockedUntilLabel,
}: {
  personId: string;
  personName: string;
  pinSet: boolean;
  pinLoginAllowed: boolean | null;
  pinFailedAttempts: number;
  /** Minutes left on an active lock (computed server-side), or null. */
  lockedMinutesLeft: number | null;
  /** "1:35 PM"-style label for when the lock expires, or null. */
  lockedUntilLabel: string | null;
}) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [allowed, setAllowed] = useState<string>(
    pinLoginAllowed === null ? "global" : pinLoginAllowed ? "always" : "never",
  );
  const initialAllowed =
    pinLoginAllowed === null ? "global" : pinLoginAllowed ? "always" : "never";
  const [saving, setSaving] = useState<"pin" | "allowed" | "unlock" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  function ask(spec: ConfirmSpec, fn: () => Promise<void>) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void fn().finally(() => {
        setConfirm(null);
        setOnConfirm(null);
      });
    });
  }

  async function doUnlock() {
    setError(null);
    setSuccess(null);
    setSaving("unlock");
    try {
      const result = await unlockMemberPin({ personId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess("✓ Unlocked — they can sign in again right now.");
      router.refresh();
    } catch {
      setError("Could not reach the server — the unlock was not confirmed.");
    } finally {
      setSaving(null);
    }
  }

  function handleUnlock() {
    ask(
      {
        title: `Unlock ${personName}'s account now?`,
        destructive: false,
        body: (
          <p>
            The failure counter and the lock are cleared; they can try their PIN immediately. An
            audit entry records the unlock.
          </p>
        ),
        confirmLabel: "Unlock account",
      },
      doUnlock,
    );
  }

  async function doReset() {
    setError(null);
    setSuccess(null);
    setSaving("reset");
    try {
      const result = await resetMemberPin({ personId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess("✓ PIN reset — they are back on the phone-digit default.");
      router.refresh();
    } catch {
      setError("Could not reach the server — the reset was not confirmed.");
    } finally {
      setSaving(null);
    }
  }

  function handleReset() {
    ask(
      {
        title: `Reset ${personName}'s PIN?`,
        body: (
          <>
            <p>
              Their current PIN stops working immediately. They fall back to the default (last 4
              digits of their phone, while that setting is on) and can set a new PIN themselves.
            </p>
            <p>No PIN value is shown or chosen here.</p>
          </>
        ),
        confirmLabel: "Reset PIN",
      },
      doReset,
    );
  }

  async function handleSetPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving("pin");
    try {
      const result = await setMemberPin({ personId, pin });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(pinSet ? "✓ PIN replaced." : "✓ PIN set.");
      setPin("");
      router.refresh();
    } catch {
      setError("Could not reach the server — the PIN was not confirmed.");
    } finally {
      setSaving(null);
    }
  }

  async function handleAllowedChange(value: string) {
    setAllowed(value);
    setError(null);
    setSuccess(null);
    setSaving("allowed");
    try {
      const result = await setPinLoginAllowed({
        personId,
        allowed: value === "global" ? null : value === "always",
      });
      if (!result.ok) {
        setError(result.error);
        setAllowed(initialAllowed);
        return;
      }
      setSuccess("✓ PIN permission saved.");
      router.refresh();
    } catch {
      setError("Could not reach the server — the change was not confirmed.");
      setAllowed(initialAllowed);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Lock state — visible at a glance, never hunted for (2.23). */}
      <div
        className={`rounded border px-3 py-2 text-sm ${
          lockedMinutesLeft !== null
            ? "border-red-400 bg-red-50 text-red-900"
            : "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300"
        }`}
      >
        {lockedMinutesLeft !== null ? (
          <>
            <strong>Locked out.</strong> {pinFailedAttempts > 0 ? `${pinFailedAttempts} failed attempts on the counter; ` : ""}
            unlocks by itself in about {lockedMinutesLeft} minute
            {lockedMinutesLeft === 1 ? "" : "s"}
            {lockedUntilLabel ? ` (${lockedUntilLabel})` : ""}.
          </>
        ) : pinFailedAttempts > 0 ? (
          <>
            Not locked — {pinFailedAttempts} failed attempt
            {pinFailedAttempts === 1 ? "" : "s"} so far.
          </>
        ) : (
          <>Not locked — no failed attempts.</>
        )}
        {(lockedMinutesLeft !== null || pinFailedAttempts > 0) && (
          <button
            type="button"
            onClick={handleUnlock}
            disabled={saving !== null}
            className="ml-2 rounded border border-current px-2 py-0.5 text-xs font-semibold disabled:opacity-40"
          >
            {saving === "unlock" ? "Unlocking…" : "Unlock account"}
          </button>
        )}
      </div>

      <form onSubmit={handleSetPin} className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {pinSet ? "Replace PIN" : "Set PIN"} (4–8 digits)
          </span>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError(null);
              setSuccess(null);
            }}
            className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={saving !== null || !/^\d{4,8}$/.test(pin)}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving === "pin" ? "Saving…" : pinSet ? "Replace PIN" : "Set PIN"}
        </button>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Stored as a bcrypt hash only — the PIN itself is never saved. {pinSet ? "A PIN is currently set." : "No PIN set yet."}
        </p>
      </form>

      {pinSet && (
        <div>
          <button
            type="button"
            onClick={handleReset}
            disabled={saving !== null}
            className="rounded border border-red-400 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-40"
          >
            {saving === "reset" ? "Resetting…" : "Reset PIN (back to default)"}
          </button>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Clears their PIN so the last 4 digits of their phone work again (while the
            default setting is on) and they can choose a new PIN. Nothing is ever shown
            or picked for them.
          </p>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium">PIN sign-in for this member</span>
        <Select
          value={allowed}
          onChange={(value) => void handleAllowedChange(value)}
          disabled={saving !== null}
          ariaLabel="PIN sign-in permission for this member"
          options={[
            { value: "global", label: "Follow the global setting" },
            { value: "always", label: "Always allowed (even when globally off)" },
            { value: "never", label: "Never — must use the WhatsApp code" },
          ]}
        />
      </label>

      {error && (
        <p role="alert" className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800 dark:text-red-400">
          Not saved: {error}
        </p>
      )}
      {success && (
        <p role="status" className="rounded border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-900">
          {success}
        </p>
      )}
      <ConfirmDialog
        spec={confirm}
        busy={saving !== null}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}
