"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPerson } from "@/app/actions/people";
import { SaveButton, type SaveState } from "@/components/ui/save-button";

const INITIAL = { nameAmharic: "", nameEnglishFirst: "", nameEnglishLast: "", phone: "" };

export function AddPersonForm() {
  const router = useRouter();
  const [fields, setFields] = useState(INITIAL);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const dirty = Object.entries(INITIAL).some(
    ([key, value]) => fields[key as keyof typeof INITIAL] !== value,
  );

  async function handleSubmit() {
    setSave({ kind: "saving" });
    try {
      const result = await createPerson({
        nameAmharic: fields.nameAmharic,
        nameEnglishFirst: fields.nameEnglishFirst,
        nameEnglishLast: fields.nameEnglishLast || undefined,
        phone: fields.phone || undefined,
      });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not saved: ${result.error}` });
        return;
      }
      const name = `${result.data.nameEnglishFirst} ${result.data.nameEnglishLast ?? ""}`.trim();
      setSave({ kind: "ok", message: `Added ${name} to the directory.` });
      setFields(INITIAL);
      router.refresh();
    } catch {
      setSave({
        kind: "err",
        message:
          "The save could not be confirmed — check your connection and the directory before trying again.",
      });
    }
  }

  return (
    // Still a form: four text fields, and Enter is how anyone finishes typing
    // a name. The SUBMIT is the SaveButton's own press — the form element only
    // keeps the keyboard's habit working.
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void handleSubmit();
      }}
    >
      {(
        [
          ["nameEnglishFirst", "First name *"],
          ["nameEnglishLast", "Last name"],
          ["nameAmharic", "Amharic name (optional)"],
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
              setSave({ kind: "idle" });
            }}
            className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
          />
        </label>
      ))}

      {/* The form clears itself on success, so the confirmation is the ONLY
          evidence the person was added — it belongs at the button. */}
      <SaveButton
        state={save}
        onSave={() => void handleSubmit()}
        onStateSettled={() => setSave({ kind: "idle" })}
        label="Add person"
        savingLabel="Adding…"
        dirty={dirty}
        notDirtyHint="Fill in at least the first name."
      />
    </form>
  );
}
