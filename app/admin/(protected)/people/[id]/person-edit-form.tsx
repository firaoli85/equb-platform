"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePerson, updatePerson } from "@/app/actions/edits";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { buttonCls } from "@/components/ui/primitives";

type PersonFields = {
  id: string;
  nameAmharic: string;
  nameEnglishFirst: string;
  nameEnglishLast: string | null;
  phone: string | null;
  participationCount: number;
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

  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const result = await updatePerson({
        personId: person.id,
        nameAmharic: fields.nameAmharic,
        nameEnglishFirst: fields.nameEnglishFirst,
        nameEnglishLast: fields.nameEnglishLast || undefined,
        phone: fields.phone || undefined,
      });
      if (!result.ok) return setError(result.error);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server — not saved.");
    } finally {
      setSaving(false);
    }
  }

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  async function doDelete() {
    setSaving(true);
    setError(null);
    try {
      const result = await deletePerson({ personId: person.id });
      if (!result.ok) return setError(result.error);
      router.push("/admin/people");
      router.refresh();
    } catch {
      setError("Could not reach the server — not removed.");
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  }

  function handleDelete() {
    setConfirm({
      title: `Remove ${person.nameEnglishFirst} from the directory permanently?`,
      body: (
        <>
          <p>
            This deletes {person.nameAmharic} ({person.nameEnglishFirst}
            {person.nameEnglishLast ? ` ${person.nameEnglishLast}` : ""})&apos;s name and phone. It
            is only possible because they are in no cycle and carry no ledger balance.
          </p>
          <p>An audit entry records the removal.</p>
        </>
      ),
      confirmLabel: "Remove permanently",
      requirePhrase: person.nameEnglishFirst,
    });
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
        <button
          type="button"
          onClick={handleDelete}
          disabled={saving || person.participationCount > 0}
          title={
            person.participationCount > 0
              ? "In a cycle — remove the participation first"
              : "Remove from the directory"
          }
          className={buttonCls.danger}
        >
          Remove from directory
        </button>
      </div>
      <ConfirmDialog
        spec={confirm}
        busy={saving}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirm(null)}
      />
    </form>
  );
}
