"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePerson, updatePerson } from "@/app/actions/edits";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { buttonCls } from "@/components/ui/primitives";
import {
  canRemovePerson,
  personRemovalBlockers,
  personRemovalConsequences,
  phoneChange,
  type PersonRemovalFacts,
  type PinState,
} from "@/lib/person-record";

type PersonFields = {
  id: string;
  nameAmharic: string;
  nameEnglishFirst: string;
  nameEnglishLast: string | null;
  phone: string | null;
  participationCount: number;
  /**
   * Whether their PIN is their own, derived from the phone, or absent —
   * computed server-side on the page (pinHash plus the defaultPinFromPhone
   * setting). The form cannot warn about a credential it cannot see.
   */
  pinState: PinState;
  /** Ledger rows, messages sent-or-attempted, and sign-in history. */
  ledgerEntryCount: number;
  messageCount: number;
  sessionCount: number;
};

export function PersonEditForm({ person }: { person: PersonFields }) {
  const router = useRouter();
  const initial = {
    nameAmharic: person.nameAmharic,
    nameEnglishFirst: person.nameEnglishFirst,
    nameEnglishLast: person.nameEnglishLast ?? "",
    phone: person.phone ?? "",
  };
  const [fields, setFields] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  // The confirm handler carries what the organizer TYPED, so an action with
  // a server-side typed-name check gets the real value rather than a copy of
  // the expected one.
  const [onConfirm, setOnConfirm] = useState<((typed: string) => void) | null>(null);

  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);

  const facts: PersonRemovalFacts = {
    name: person.nameEnglishFirst,
    participationCount: person.participationCount,
    ledgerEntryCount: person.ledgerEntryCount,
    carriedBalance: 0,
    messageCount: person.messageCount,
    sessionCount: person.sessionCount,
  };
  const blockers = personRemovalBlockers(facts);
  const removable = canRemovePerson(facts);

  // WHAT SAVING THE PHONE ACTUALLY DOES. The phone is the member's sign-in
  // identity on every door, and for anyone still on the default it is also
  // their PIN. Formatting-only edits stay silent — see lib/person-record.ts.
  const phone = phoneChange({
    name: person.nameEnglishFirst,
    before: person.phone,
    after: fields.phone,
    pinState: person.pinState,
  });

  async function doSave() {
    setError(null);
    setSaved(false);
    setSaving(true);
    /** The refusal, if any — the dialog closes only while this stays null. */
    let refused: string | null = null;
    try {
      const result = await updatePerson({
        personId: person.id,
        nameAmharic: fields.nameAmharic,
        nameEnglishFirst: fields.nameEnglishFirst,
        nameEnglishLast: fields.nameEnglishLast || undefined,
        phone: fields.phone || undefined,
      });
      if (!result.ok) {
        refused = result.error;
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server — not saved.");
    } finally {
      setSaving(false);
      // CLOSE ONLY ON SUCCESS. This used to close whatever happened, so a
      // refusal was thrown away with the dialog that could have shown it
      // (UI_STANDARDS 6b).
      if (refused === null) {
        setConfirm(null);
        setOnConfirm(null);
      } else {
        setDialogError(refused);
      }
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // A name correction is an ordinary save. A phone change is a credential
    // change, so it gets the same confirmation any other credential change
    // would — and it names the new PIN rather than hinting at one.
    if (!phone.changed) return void doSave();
    setConfirm({
      title: phone.locksOut
        ? `Remove ${person.nameEnglishFirst}'s phone number?`
        : `Change ${person.nameEnglishFirst}'s phone number?`,
      destructive: phone.locksOut,
      consequence: phone.consequence ?? undefined,
      body: (
        <p>
          The directory entry, the names and everything else about them stay exactly as they are.
          An audit entry records the old and new number.
        </p>
      ),
      alternative: phone.newDefaultPin
        ? {
            label: "Give them a PIN of their own first",
            description:
              "Set a PIN below, under “PIN sign-in”. Their PIN then stops following their phone " +
              "number, and this edit becomes an ordinary correction.",
            onChoose: () => setConfirm(null),
          }
        : undefined,
      confirmLabel: phone.locksOut ? "Remove the number" : "Change the number",
      requirePhrase: phone.locksOut ? person.nameEnglishFirst : undefined,
    });
    setOnConfirm(() => () => void doSave());
  }

  async function doDelete(typedPhrase: string) {
    setSaving(true);
    setError(null);
    /** The refusal, if any — the dialog closes only while this stays null. */
    let refused: string | null = null;
    try {
      // The typed name goes to the SERVER too. The dialog alone does not
      // survive a double-submit or a stale replay, and this deletes the
      // directory row together with every sign-in record.
      const result = await deletePerson({ personId: person.id, typedName: typedPhrase });
      if (!result.ok) {
        refused = result.error;
        setError(result.error);
        return;
      }
      router.push("/admin/people");
      router.refresh();
    } catch {
      setError("Could not reach the server — not removed.");
    } finally {
      setSaving(false);
      // CLOSE ONLY ON SUCCESS. This used to close whatever happened, so a
      // refusal was thrown away with the dialog that could have shown it
      // (UI_STANDARDS 6b).
      if (refused === null) {
        setConfirm(null);
        setOnConfirm(null);
      } else {
        setDialogError(refused);
      }
    }
  }

  function handleDelete() {
    // BLOCKED — say so here, with every reason at once, instead of letting
    // them type the name and then meet a refusal. The message log is the one
    // nothing can clear, so the honest offer is the thing they usually meant:
    // stop contacting them, and leave the record intact (2.20).
    if (!removable) {
      setConfirm({
        title: `${person.nameEnglishFirst} cannot be removed from the directory`,
        destructive: false,
        consequence: blockers.map((b) => b.reason).join(" "),
        body: (
          <>
            <p>
              People are permanent once they have a history (2.5). What is left of that history
              is what makes the books readable years later, so the product keeps it rather than
              pretending it never happened.
            </p>
            {blockers.every((b) => !b.clearable) && (
              <p>
                Nothing you can do here clears {blockers.length === 1 ? "that" : "those"} — and
                that is deliberate, not a missing feature.
              </p>
            )}
          </>
        ),
        alternative: {
          label: "Stop messaging them instead",
          description:
            "The “No messages” switch below stops every message to " +
            `${person.nameEnglishFirst}, automatic and manual, without touching their record. ` +
            "That is usually what “remove them” means.",
          onChoose: () => setConfirm(null),
        },
        confirmLabel: "Close",
      });
      setOnConfirm(() => () => setConfirm(null));
      return;
    }

    setConfirm({
      title: `Remove ${person.nameEnglishFirst} from the directory permanently?`,
      consequence: personRemovalConsequences(facts).join(" "),
      body: (
        <>
          <p>
            This deletes {person.nameAmharic} ({person.nameEnglishFirst}
            {person.nameEnglishLast ? ` ${person.nameEnglishLast}` : ""})&apos;s name and phone.
            It is possible because they are in no cycle, carry no ledger record and have never
            been messaged.
          </p>
          <p>An audit entry records the removal.</p>
        </>
      ),
      confirmLabel: "Remove permanently",
      requirePhrase: person.nameEnglishFirst,
    });
    setOnConfirm(() => (typedPhrase: string) => void doDelete(typedPhrase));
  }

  return (
    <form onSubmit={handleSave} className="max-w-md space-y-3">
      {(
        [
          ["nameAmharic", "Amharic name *"],
          ["nameEnglishFirst", "English first name *"],
          ["nameEnglishLast", "English last name"],
          ["phone", "Phone"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="block">
          <span className="mb-1 block text-sm font-medium">{label}</span>
          <input
            type="text"
            value={fields[key]}
            onChange={(e) => {
              setFields((f) => ({ ...f, [key]: e.target.value }));
              setError(null);
              setSaved(false);
            }}
            className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
          />
          {/* The warning belongs BESIDE the field being changed, not only in
              the dialog that appears after they have decided. */}
          {key === "phone" && phone.changed && (
            <span className="mt-1 block text-xs leading-snug text-amber-700 dark:text-amber-500">
              {phone.consequence}
            </span>
          )}
          {key === "phone" && !phone.changed && person.pinState === "default" && (
            <span className="mt-1 block text-xs leading-snug text-gray-600 dark:text-gray-400">
              This number is how they sign in, and the last 4 digits are their PIN.
            </span>
          )}
        </label>
      ))}

      {error && (
        <p role="alert" className="rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-400">
          Not saved: {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-900">
          ✓ Saved.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!dirty || saving}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {/* NOT disabled when blocked. A dead button teaches nothing; pressing
            it now explains every blocker and offers the thing they meant. */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={saving}
          title={
            removable
              ? "Remove from the directory"
              : "Not possible — press to see why, and what to do instead"
          }
          className={removable ? buttonCls.danger : buttonCls.ghost}
        >
          Remove from directory
        </button>
      </div>
      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={saving}
        onConfirm={(typedPhrase) => onConfirm?.(typedPhrase)}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </form>
  );
}
