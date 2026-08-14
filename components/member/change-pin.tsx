"use client";

import { useId, useState } from "react";
import { changeMyPin } from "@/app/actions/auth";
import { SaveButton, type SaveState } from "@/components/ui/save-button";

// CHANGE MY PIN — Door 1 of PIN self-service, in the member's Account area.
//
// Three masked numeric fields and one save. The heavy machinery is all
// reused, none of it is here: the server action proves the CURRENT PIN with
// the same comparator sign-in uses, validates the new one with the same
// 4–8-digit rule forced setup uses, and hashes with the same bcrypt path.
// This component's whole job is collecting three strings and rendering the
// outcome at the control (UI_STANDARDS 6/6b).
//
// The confirm-mismatch refusal is decided HERE, before the server is asked:
// it is a typing problem, not a rule, and the server never needs to see a
// PIN pair that already disagrees.

const inputCls =
  "mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm tracking-widest " +
  "text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 " +
  "dark:border-gray-800 dark:bg-black/20 dark:text-gray-100 dark:focus:ring-indigo-950";

export function ChangePin() {
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const digits = (raw: string) => raw.replace(/\D/g, "").slice(0, 8);
  const complete = currentPin.length >= 4 && newPin.length >= 4 && confirmPin.length >= 4;

  async function change() {
    if (newPin !== confirmPin) {
      setSave({
        kind: "err",
        message: "The two new PINs don't match — retype them and try again.",
      });
      return;
    }
    setSave({ kind: "saving" });
    try {
      const result = await changeMyPin({ currentPin, newPin });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not changed — ${result.error}` });
        return;
      }
      setSave({
        kind: "ok",
        message:
          `Your new ${newPin.length}-digit PIN is set. Use it the next time you sign in — ` +
          `you are still signed in here. Anywhere else you were signed in has been signed out.`,
      });
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — your PIN is unchanged." });
    }
  }

  return (
    <section className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm px-3.5 py-3.5">
      <h2 className="text-sm font-bold text-gray-900 dark:text-white">Change my PIN</h2>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 text-pretty">
        Your current PIN first, then the new one twice. 4 to 8 digits.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor={currentId}
            className="text-xs font-semibold text-gray-700 dark:text-gray-300"
          >
            Current PIN
          </label>
          <input
            id={currentId}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={currentPin}
            onChange={(e) => {
              setCurrentPin(digits(e.target.value));
              setSave({ kind: "idle" });
            }}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor={newId} className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            New PIN
          </label>
          <input
            id={newId}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={newPin}
            onChange={(e) => {
              setNewPin(digits(e.target.value));
              setSave({ kind: "idle" });
            }}
            className={inputCls}
          />
        </div>
        <div>
          <label
            htmlFor={confirmId}
            className="text-xs font-semibold text-gray-700 dark:text-gray-300"
          >
            New PIN, again
          </label>
          <input
            id={confirmId}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={confirmPin}
            onChange={(e) => {
              setConfirmPin(digits(e.target.value));
              setSave({ kind: "idle" });
            }}
            className={inputCls}
          />
        </div>
      </div>

      <SaveButton
        className="mt-3 flex-col [&>button]:w-full"
        state={save}
        onSave={() => void change()}
        onStateSettled={() => setSave({ kind: "idle" })}
        label="Change my PIN"
        savingLabel="Changing…"
        dirty={complete}
        notDirtyHint="Fill in all three boxes first — at least 4 digits each."
      />
    </section>
  );
}
