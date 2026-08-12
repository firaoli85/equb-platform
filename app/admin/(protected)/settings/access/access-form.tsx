"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  updateDefaultPinFromPhone,
  updatePinLockoutPolicy,
  updatePinLoginEnabled,
  updateSessionPolicy,
} from "@/app/actions/settings";
import { SettingList, SettingNumber, SettingSwitch } from "@/components/admin/setting-row";
import { SaveButton, type SaveState } from "@/components/ui/save-button";

// WHO CAN GET IN, AND FOR HOW LONG.
//
// Every row here is read at CHECK TIME (2.6), so a change applies to the very
// next attempt — no restart, no cache. That is worth saying once at the top
// rather than repeating per row.

export type AccessInitial = {
  pinLoginEnabled: boolean;
  defaultPinFromPhone: boolean;
  pinMaxAttempts: number;
  pinLockMinutes: number;
  memberSessionIdleDays: number;
  memberSessionMaxDays: number;
  adminSessionIdleMinutes: number;
  adminSessionMaxHours: number;
};

export function AccessForm({ initial }: { initial: AccessInitial }) {
  const router = useRouter();
  const [pinLoginEnabled, setPinLoginEnabled] = useState(initial.pinLoginEnabled);
  const [defaultPinFromPhone, setDefaultPinFromPhone] = useState(initial.defaultPinFromPhone);
  const [maxAttempts, setMaxAttempts] = useState(String(initial.pinMaxAttempts));
  const [lockMinutes, setLockMinutes] = useState(String(initial.pinLockMinutes));
  const [memberIdle, setMemberIdle] = useState(String(initial.memberSessionIdleDays));
  const [memberMax, setMemberMax] = useState(String(initial.memberSessionMaxDays));
  const [adminIdle, setAdminIdle] = useState(String(initial.adminSessionIdleMinutes));
  const [adminMax, setAdminMax] = useState(String(initial.adminSessionMaxHours));

  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  function touched() {
    setSave({ kind: "idle" });
  }

  const dirty =
    pinLoginEnabled !== initial.pinLoginEnabled ||
    defaultPinFromPhone !== initial.defaultPinFromPhone ||
    maxAttempts !== String(initial.pinMaxAttempts) ||
    lockMinutes !== String(initial.pinLockMinutes) ||
    memberIdle !== String(initial.memberSessionIdleDays) ||
    memberMax !== String(initial.memberSessionMaxDays) ||
    adminIdle !== String(initial.adminSessionIdleMinutes) ||
    adminMax !== String(initial.adminSessionMaxHours);

  // FOUR WRITES BEHIND ONE BUTTON, and an earlier one can land while a later
  // one is refused. Each refusal names the group it belongs to, because a bare
  // "not saved" over a half-applied policy is the message that gets acted on
  // wrongly — he would re-enter settings that are already in force.
  async function handleSubmit() {
    setSave({ kind: "saving" });
    try {
      if (pinLoginEnabled !== initial.pinLoginEnabled) {
        const r = await updatePinLoginEnabled({ enabled: pinLoginEnabled });
        if (!r.ok) return setSave({ kind: "err", message: `PIN sign-in not saved: ${r.error}` });
      }
      if (defaultPinFromPhone !== initial.defaultPinFromPhone) {
        const r = await updateDefaultPinFromPhone({ enabled: defaultPinFromPhone });
        if (!r.ok)
          return setSave({
            kind: "err",
            message: `The phone-digit default was not saved: ${r.error}`,
          });
      }
      if (
        maxAttempts !== String(initial.pinMaxAttempts) ||
        lockMinutes !== String(initial.pinLockMinutes)
      ) {
        const r = await updatePinLockoutPolicy({
          maxAttempts: Number(maxAttempts),
          lockMinutes: Number(lockMinutes),
        });
        if (!r.ok)
          return setSave({ kind: "err", message: `The lockout rule was not saved: ${r.error}` });
      }
      if (
        memberIdle !== String(initial.memberSessionIdleDays) ||
        memberMax !== String(initial.memberSessionMaxDays) ||
        adminIdle !== String(initial.adminSessionIdleMinutes) ||
        adminMax !== String(initial.adminSessionMaxHours)
      ) {
        const r = await updateSessionPolicy({
          memberIdleDays: Number(memberIdle),
          memberMaxDays: Number(memberMax),
          adminIdleMinutes: Number(adminIdle),
          adminMaxHours: Number(adminMax),
        });
        if (!r.ok)
          return setSave({ kind: "err", message: `The session windows were not saved: ${r.error}` });
      }
      setSave({ kind: "ok", message: "Saved. It applies to the next attempt." });
      router.refresh();
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was saved." });
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Signing in</h2>
          <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">
            Read at every sign-in attempt, so a change here applies to the very next one.
          </p>
        </div>
        <SettingList>
          <SettingSwitch
            label="PIN sign-in"
            checked={pinLoginEnabled}
            onChange={(v) => {
              setPinLoginEnabled(v);
              touched();
            }}
            description={
              <>
                When off, members must use the WhatsApp code and PIN attempts are rejected on the
                server — not merely hidden. A per-member override on their profile still wins
                either way.
              </>
            }
            state={
              pinLoginEnabled ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  ON — members can sign in with a PIN
                </span>
              ) : (
                <span className="text-gray-700 dark:text-gray-300">
                  off — the WhatsApp code is the only door
                </span>
              )
            }
          />
          <SettingSwitch
            label="Default PIN from phone"
            tone={defaultPinFromPhone ? "attention" : "neutral"}
            checked={defaultPinFromPhone}
            onChange={(v) => {
              setDefaultPinFromPhone(v);
              touched();
            }}
            description={
              <>
                A member who has never set a PIN can sign in with the last 4 digits of their
                phone. Never stored — derived at the moment of the check, and dead for good once
                they set their own. It is useful for onboarding and it is a real weakening:
                anyone holding their number knows those digits.
              </>
            }
            state={
              defaultPinFromPhone ? (
                <span className="text-amber-800 dark:text-amber-400">
                  ON — a phone number is enough to sign in as someone without a PIN
                </span>
              ) : (
                <span className="text-gray-700 dark:text-gray-300">
                  off — only a PIN they set themselves works
                </span>
              )
            }
          />
          <SettingNumber
            label="Attempts before locking"
            description="Wrong PINs in a row before the account locks itself. Attempts on the phone-digit default count toward the same lock."
            value={maxAttempts}
            onChange={(v) => {
              setMaxAttempts(v);
              touched();
            }}
            min={1}
            max={20}
            unit="tries"
          />
          <SettingNumber
            label="How long a lock lasts"
            description="The lock lifts by itself; nobody has to clear it. The member is told when."
            value={lockMinutes}
            onChange={(v) => {
              setLockMinutes(v);
              touched();
            }}
            min={1}
            max={1440}
            unit="minutes"
          />
        </SettingList>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">
            How long a session lasts
          </h2>
          <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">
            Two clocks per role. The <strong>idle</strong> clock slides — using the account resets
            it. The <strong>maximum</strong> never extends, which is what makes the sliding one
            safe.
          </p>
        </div>
        <SettingList>
          <SettingNumber
            label="Member — idle"
            description="Days without using the portal before they are signed out."
            value={memberIdle}
            onChange={(v) => {
              setMemberIdle(v);
              touched();
            }}
            min={1}
            max={365}
            unit="days"
          />
          <SettingNumber
            label="Member — maximum"
            description="Days from signing in, whatever they do. Must be at least the idle window, or the idle setting would never be reached."
            value={memberMax}
            onChange={(v) => {
              setMemberMax(v);
              touched();
            }}
            min={1}
            max={365}
            unit="days"
          />
          <SettingNumber
            label="Organizer — idle"
            description="Minutes, not days: these screens hold every member's money and the laptop gets left alone."
            value={adminIdle}
            onChange={(v) => {
              setAdminIdle(v);
              touched();
            }}
            min={1}
            max={1440}
            unit="minutes"
          />
          <SettingNumber
            label="Organizer — maximum"
            description="Hours from signing in, never extended."
            value={adminMax}
            onChange={(v) => {
              setAdminMax(v);
              touched();
            }}
            min={1}
            max={720}
            unit="hours"
          />
        </SettingList>
      </section>

      {/* Eight controls over two sections sit above this. The confirmation
          renders AT the button, never at the top of the form (rule 6). */}
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
