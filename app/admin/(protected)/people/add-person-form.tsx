"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPerson } from "@/app/actions/people";

const INITIAL = { nameAmharic: "", nameEnglishFirst: "", nameEnglishLast: "", phone: "" };

export function AddPersonForm() {
  const router = useRouter();
  const [fields, setFields] = useState(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const dirty = Object.entries(INITIAL).some(
    ([key, value]) => fields[key as keyof typeof INITIAL] !== value,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedName(null);
    setSaving(true);
    try {
      const result = await createPerson({
        nameAmharic: fields.nameAmharic,
        nameEnglishFirst: fields.nameEnglishFirst,
        nameEnglishLast: fields.nameEnglishLast || undefined,
        phone: fields.phone || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedName(
        `${result.data.nameEnglishFirst} ${result.data.nameEnglishLast ?? ""}`.trim(),
      );
      setFields(INITIAL);
      router.refresh();
    } catch {
      setError(
        "The save could not be confirmed — check your connection and the directory before trying again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
              setSavedName(null);
            }}
            className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
          />
        </label>
      ))}

      {error && (
        <p role="alert" className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800">
          Not saved: {error}
        </p>
      )}
      {savedName && (
        <p role="status" className="rounded border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-900">
          ✓ Added {savedName} to the directory.
        </p>
      )}

      <button
        type="submit"
        disabled={!dirty || saving}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Add person"}
      </button>
    </form>
  );
}
