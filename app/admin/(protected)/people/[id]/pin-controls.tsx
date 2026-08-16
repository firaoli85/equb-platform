"use client";

import { useRouter } from "next/navigation";
import { NEW_PIN_LENGTH } from "@/lib/pin-constants";
import { useState } from "react";
import {
  resetMemberPin,
  setMemberPin,
  setPinLoginAllowed,
  unlockMemberPin,
} from "@/app/actions/auth";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { buttonCls, inputCls } from "@/components/ui/primitives";

// FOUR CREDENTIAL CONTROLS, FOUR CONFIRMATIONS — each beside its own control
// (§2.10, UI_STANDARDS rule 6).
//
// Every one of these changes how a member gets in, so "did that work?" is not
// a curiosity here: an unlock he thinks failed gets done again, and a PIN he
// thinks failed gets typed again as something else. All four used to share ONE
// `error` and ONE `success` paragraph at the very BOTTOM of this panel — so
// pressing "Unlock account", which sits in the lock strip at the TOP, drew its
// answer past the PIN form, the reset button and the permission select.
//
// The confirmation now belongs to the control that was pressed:
//   Unlock / Reset PIN — a dialog does the saving, so `SaveFeedback` sits
//                        where the trigger is, and the dialog keeps refusals.
//   Set / Replace PIN  — its own button, so `SaveButton` owns all four beats.
//   PIN sign-in select — not a button at all, so `SaveFeedback` again.
//
// TWO OF THEM DELETE THEIR OWN TRIGGER, and that decides where the message
// goes. A successful unlock clears the lock and the counter, and a successful
// reset clears `pinSet` — so the refresh that PROVES it worked unmounts the
// button. Both confirmations are rendered OUTSIDE the condition that draws
// their button, or success would erase its own receipt.

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
  // ONE SaveState PER CONTROL — these are four independent facts, not one.
  // A single (saving, error, success) triple could only ever say "something
  // happened somewhere on this panel", which is why its message had nowhere to
  // live but the bottom.
  const [pinSave, setPinSave] = useState<SaveState>({ kind: "idle" });
  const [allowedSave, setAllowedSave] = useState<SaveState>({ kind: "idle" });
  const [unlockSave, setUnlockSave] = useState<SaveState>({ kind: "idle" });
  const [resetSave, setResetSave] = useState<SaveState>({ kind: "idle" });

  // DERIVED, never a second flag. `saving` was its own state holding WHICH
  // action was running — the same fact as `kind === "saving"` on these four,
  // kept twice, which is how the button that says "Resetting…" and the one
  // that is actually resetting stop being the same button.
  const busy =
    pinSave.kind === "saving" ||
    allowedSave.kind === "saving" ||
    unlockSave.kind === "saving" ||
    resetSave.kind === "saving";

  /** Beat 1: the button is dead until there is something valid to save. */
  // SETTING is exactly four digits — the same rule the member-facing screens
  // apply, so the organizer cannot hand out a PIN of a shape the member could
  // never choose for themselves. Existing longer PINs keep working at
  // SIGN-IN; that is the other half of the split (lib/pin-constants.ts).
  const pinIsValid = pin.length === NEW_PIN_LENGTH && /^\d+$/.test(pin);

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  /** `fn` returns its refusal, or nothing on success (UI_STANDARDS 6b). */
  function ask(spec: ConfirmSpec, fn: () => Promise<string | null | void>) {
    setConfirm(spec);
    setDialogError(null);
    setOnConfirm(() => () => {
      void (async () => {
        const reported = await fn();
        const refused = typeof reported === "string" && reported.length > 0 ? reported : null;
        // CLOSE ONLY ON SUCCESS. This closed in a `finally`, whatever
        // happened — so a server refusal from "Unlock account" or "Reset PIN"
        // was thrown away with the dialog that could have shown it, and
        // `dialogError` was wired to the dialog below but set by nothing at
        // all. Pressing the button and watching the dialog vanish is
        // indistinguishable from success (UI_STANDARDS 6b).
        if (refused === null) {
          setConfirm(null);
          setOnConfirm(null);
        } else {
          setDialogError(refused);
        }
      })();
    });
  }

  async function doUnlock(): Promise<string | null> {
    setUnlockSave({ kind: "saving" });
    try {
      const result = await unlockMemberPin({ personId });
      if (!result.ok) {
        // BOTH: the dialog holds it open where he pressed, and the panel keeps
        // it after he cancels out. Neither alone survives the whole gesture.
        setUnlockSave({ kind: "err", message: `Not unlocked: ${result.error}` });
        return result.error;
      }
      setUnlockSave({
        kind: "ok",
        message:
          `Unlocked — ${personName} can try their PIN right now` +
          (pinFailedAttempts > 0
            ? `; ${pinFailedAttempts} failed attempt${pinFailedAttempts === 1 ? "" : "s"} cleared.`
            : "."),
      });
      router.refresh();
      return null;
    } catch {
      const reason = "Could not reach the server — the unlock was not confirmed.";
      setUnlockSave({ kind: "err", message: reason });
      return reason;
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

  async function doReset(): Promise<string | null> {
    setResetSave({ kind: "saving" });
    try {
      const result = await resetMemberPin({ personId });
      if (!result.ok) {
        setResetSave({ kind: "err", message: `PIN not reset: ${result.error}` });
        return result.error;
      }
      setResetSave({
        kind: "ok",
        message: `PIN reset — ${personName}'s old PIN stopped working; they are back on the last 4 digits of their phone and can set a new one themselves.`,
      });
      router.refresh();
      return null;
    } catch {
      const reason = "Could not reach the server — the reset was not confirmed.";
      setResetSave({ kind: "err", message: reason });
      return reason;
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

  async function handleSetPin() {
    // The field is captured BEFORE the await: the confirmation names the
    // length he actually typed, and `pin` is cleared on the way out.
    const digits = pin.length;
    setPinSave({ kind: "saving" });
    try {
      const result = await setMemberPin({ personId, pin });
      if (!result.ok) {
        setPinSave({ kind: "err", message: `Not saved: ${result.error}` });
        return;
      }
      setPinSave({
        kind: "ok",
        message: `${pinSet ? "PIN replaced" : "PIN set"} — ${digits} digits, stored as a hash. ${personName} signs in with it from now on${pinSet ? "; their old PIN stopped working" : ""}.`,
      });
      setPin("");
      router.refresh();
    } catch {
      setPinSave({
        kind: "err",
        message: "Could not reach the server — the PIN was NOT changed. Their old one still works.",
      });
    }
  }

  async function handleAllowedChange(value: string) {
    setAllowed(value);
    setAllowedSave({ kind: "saving" });
    try {
      const result = await setPinLoginAllowed({
        personId,
        allowed: value === "global" ? null : value === "always",
      });
      if (!result.ok) {
        setAllowedSave({ kind: "err", message: `Not saved: ${result.error}` });
        setAllowed(initialAllowed);
        return;
      }
      // WHICH of the three, in words. "PIN permission saved" left him reading
      // the select back to find out what he had just chosen.
      setAllowedSave({
        kind: "ok",
        message:
          value === "always"
            ? `Saved — ${personName} can sign in with a PIN even while PIN sign-in is globally off.`
            : value === "never"
              ? `Saved — ${personName} must use the WhatsApp code; a PIN attempt is refused on the server.`
              : `Saved — ${personName} follows the global PIN sign-in setting.`,
      });
      router.refresh();
    } catch {
      setAllowedSave({
        kind: "err",
        message: "Could not reach the server — the change was not confirmed.",
      });
      setAllowed(initialAllowed);
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
            disabled={busy}
            className={buttonCls.ghost + " ml-2 !px-2.5 !py-1 !text-xs disabled:opacity-40"}
          >
            {unlockSave.kind === "saving" ? "Unlocking…" : "Unlock account"}
          </button>
        )}
        {/* OUTSIDE the condition above, on purpose. A successful unlock clears
            the lock AND the counter, so the refresh that proves it worked is
            the thing that removes the button — a confirmation rendered inside
            that branch would be destroyed by its own success. */}
        <SaveFeedback state={unlockSave} className="mt-2" />
      </div>

      {/* Still a form: this is a typed field, and Enter is how anyone finishes
          typing. The SaveButton press is the submit. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pinIsValid) void handleSetPin();
        }}
        className="space-y-2"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {pinSet ? "Replace PIN" : "Set PIN"} (4 digits)
          </span>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/D/g, "").slice(0, NEW_PIN_LENGTH));
              setPinSave({ kind: "idle" });
            }}
            className={inputCls}
          />
        </label>
        <SaveButton
          state={pinSave}
          onSave={() => void handleSetPin()}
          onStateSettled={() => setPinSave({ kind: "idle" })}
          label={pinSet ? "Replace PIN" : "Set PIN"}
          savingLabel="Saving…"
          dirty={pinIsValid}
          disabled={busy}
          notDirtyHint="Type 4 digits first."
        />
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Stored as a bcrypt hash only — the PIN itself is never saved. {pinSet ? "A PIN is currently set." : "No PIN set yet."}
        </p>
      </form>

      {/* The wrapper survives the reset even though the button does not — but
          it is not drawn at all when there is nothing to draw, or an empty box
          would open a gap in the stack on every member without a PIN. */}
      {(pinSet || resetSave.kind !== "idle") && (
        <div className="space-y-2">
          {pinSet && (
            <div>
              <button
                type="button"
                onClick={handleReset}
                disabled={busy}
                className={buttonCls.dangerQuiet + " disabled:opacity-40"}
              >
                {resetSave.kind === "saving" ? "Resetting…" : "Reset PIN (back to default)"}
              </button>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Clears their PIN so the last 4 digits of their phone work again (while the
                default setting is on) and they can choose a new PIN. Nothing is ever shown
                or picked for them.
              </p>
            </div>
          )}
          {/* OUTSIDE the `pinSet` branch, for the same reason as the unlock
              confirmation: a successful reset makes `pinSet` false, so the
              button and everything drawn with it disappears on the refresh
              that proves the reset happened. */}
          <SaveFeedback state={resetSave} />
        </div>
      )}

      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">PIN sign-in for this member</span>
          <Select
            value={allowed}
            onChange={(value) => void handleAllowedChange(value)}
            disabled={busy}
            ariaLabel="PIN sign-in permission for this member"
            options={[
              { value: "global", label: "Follow the global setting" },
              { value: "always", label: "Always allowed (even when globally off)" },
              { value: "never", label: "Never — must use the WhatsApp code" },
            ]}
          />
        </label>
        {/* A select is not a button you press to save, so the same message
            without one — beside the control, never at the foot of the panel. */}
        <SaveFeedback state={allowedSave} />
      </div>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}
