"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateSessionPolicy } from "@/app/actions/settings";
import { NumberInput } from "@/components/ui/controls";
import { Alert, buttonCls } from "@/components/ui/primitives";

// HOW LONG A SESSION LIVES (ruling 3), as settings — read at check time by
// lib/session-gate.ts, never hardcoded (2.6).
//
// The two roles are shown side by side on purpose. The numbers look wildly
// unequal (25 minutes against 7 days) and that inequality is the point: an
// abandoned member phone shows one person's savings, an abandoned organizer
// screen shows everyone's. Seeing them together is what makes the short admin
// window read as deliberate rather than as a bug.

export function SessionPolicyForm({
  initial,
}: {
  initial: {
    memberSessionIdleDays: number;
    memberSessionMaxDays: number;
    adminSessionIdleMinutes: number;
    adminSessionMaxHours: number;
  };
}) {
  const router = useRouter();
  const [memberIdle, setMemberIdle] = useState(String(initial.memberSessionIdleDays));
  const [memberMax, setMemberMax] = useState(String(initial.memberSessionMaxDays));
  const [adminIdle, setAdminIdle] = useState(String(initial.adminSessionIdleMinutes));
  const [adminMax, setAdminMax] = useState(String(initial.adminSessionMaxHours));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const dirty =
    memberIdle !== String(initial.memberSessionIdleDays) ||
    memberMax !== String(initial.memberSessionMaxDays) ||
    adminIdle !== String(initial.adminSessionIdleMinutes) ||
    adminMax !== String(initial.adminSessionMaxHours);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const result = await updateSessionPolicy({
        memberIdleDays: Number(memberIdle),
        memberMaxDays: Number(memberMax),
        adminIdleMinutes: Number(adminIdle),
        adminMaxHours: Number(adminMax),
      });
      if (!result.ok) {
        setMsg({ kind: "err", text: result.error });
        return;
      }
      setMsg({
        kind: "ok",
        text: "Saved — it applies to the next request, including sessions already open.",
      });
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing was saved." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded border border-gray-300 dark:border-gray-700 p-4">
      <h2 className="text-base font-semibold">How long a sign-in lasts</h2>
      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
        Two clocks run on every session and either one can end it. <strong>Idle</strong> resets
        each time the account is used; <strong>maximum</strong> counts from sign-in and is never
        extended. An expired session goes back to the sign-in page with an explanation — never an
        error.
      </p>

      {msg && (
        <div className="mt-3">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}

      <div className="mt-4 space-y-4">
        <fieldset>
          <legend className="text-sm font-semibold text-gray-900 dark:text-white">Members</legend>
          <p className="mb-2 text-xs text-gray-600 dark:text-gray-400">
            Generous on purpose — a member checking their savings should not be signed out between
            visits.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Idle days
              </span>
              <NumberInput
                value={memberIdle}
                onChange={setMemberIdle}
                ariaLabel="Member idle days before sign-out"
                className="w-24"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Maximum days
              </span>
              <NumberInput
                value={memberMax}
                onChange={setMemberMax}
                ariaLabel="Member maximum session days"
                className="w-24"
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-gray-900 dark:text-white">
            You (the organizer)
          </legend>
          <p className="mb-2 text-xs text-gray-600 dark:text-gray-400">
            Short on purpose — these screens hold every member&apos;s money, and a laptop gets left
            alone.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Idle minutes
              </span>
              <NumberInput
                value={adminIdle}
                onChange={setAdminIdle}
                ariaLabel="Organizer idle minutes before sign-out"
                className="w-24"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
                Maximum hours
              </span>
              <NumberInput
                value={adminMax}
                onChange={setAdminMax}
                ariaLabel="Organizer maximum session hours"
                className="w-24"
              />
            </label>
          </div>
        </fieldset>
      </div>

      <button type="submit" disabled={saving || !dirty} className={buttonCls.primary + " mt-4"}>
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
