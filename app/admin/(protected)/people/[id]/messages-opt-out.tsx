"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setNoMessages } from "@/app/actions/messages";

// The hardship flag (2.20): one switch that silences EVERY message to this
// person — the automatic confirmation included. Enforced server-side at
// send time; this control only records the decision.

export function MessagesOptOut({
  personId,
  noMessages,
}: {
  personId: string;
  noMessages: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(noMessages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleChange(next: boolean) {
    setValue(next);
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const result = await setNoMessages({ personId, noMessages: next });
      if (!result.ok) {
        setError(result.error);
        setValue(noMessages);
        return;
      }
      setSuccess(next ? "✓ Saved — no messages will be sent to them." : "✓ Saved — messages are on again.");
      router.refresh();
    } catch {
      setError("Could not reach the server — the change was not confirmed.");
      setValue(noMessages);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={value}
          disabled={saving}
          onChange={(e) => handleChange(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="block text-sm font-medium">No messages (hardship)</span>
          <span className="block text-xs text-gray-600 dark:text-gray-400">
            Nothing is ever sent to them — not the automatic payment confirmation, not any
            batch, even if checked there. For someone dealing with a difficult time (2.20).
          </span>
        </span>
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
    </div>
  );
}
