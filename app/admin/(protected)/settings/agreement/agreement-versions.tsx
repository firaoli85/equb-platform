"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { publishAgreementVersion } from "@/app/actions/agreement";
import { agreementClauses, AGREEMENT_PLACEHOLDERS } from "@/lib/agreement";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";

// THE AGREEMENT'S WORDING, ON SCREEN (Cycle-2 build, feature C).
//
// PUBLISHING IS CREATE-ONLY, AND THE SCREEN SAYS SO BEFORE THE BUTTON. A
// signature is bound by hash to the exact text it was shown; editing a version
// in place would leave every past signature pointing at wording that no
// longer exists. So there is no edit and no delete here — a change mints the
// next version, old signatures stay bound to the version they saw, and the
// finality is stated inline where it is about to happen, not discovered
// afterwards.
//
// THE PREVIEW IS THE REAL PIPELINE. What renders below the editor is
// `agreementClauses` over the typed body — the same function the signing
// screen uses — with the {tokens} left visible, because their values are each
// member's own and do not exist here. What the organizer previews is the
// document's structure exactly as a member will receive it, holes and all.

export type VersionRow = {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  signatures: number;
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function AgreementVersionsScreen({
  currentVersion,
  currentBody,
  versions,
}: {
  currentVersion: number;
  currentBody: string;
  versions: VersionRow[];
}) {
  const router = useRouter();
  const bodyId = useId();
  const noteId = useId();
  // The editor STARTS FROM the wording in force — publishing is almost always
  // an amendment, and starting from blank invites re-typing (and drifting)
  // nine clauses to change one.
  const [body, setBody] = useState(currentBody);
  const [note, setNote] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const dirty = body.trim() !== currentBody.trim();
  const clauses = agreementClauses(body);

  async function publish() {
    setSave({ kind: "saving" });
    try {
      const result = await publishAgreementVersion({ body, note: note.trim() || undefined });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not published — ${result.error}` });
        return;
      }
      setSave({
        kind: "ok",
        message: `Version ${currentVersion + 1} is now what every member signs.`,
      });
      setNote("");
      router.refresh();
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was published." });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="The wording members sign"
          sub={`Version ${currentVersion} is in force. Every member who signs today signs this text, filled with their own figures.`}
        />
        <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800/60">
          <label
            htmlFor={bodyId}
            className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Agreement text
          </label>
          <textarea
            id={bodyId}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSave({ kind: "idle" });
            }}
            rows={16}
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-gray-800 dark:bg-black/20 dark:text-gray-100 dark:focus:ring-indigo-950"
          />
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 text-pretty">
            Values in braces fill per member:{" "}
            <code className="font-mono">
              {AGREEMENT_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}
            </code>
            . Anything else in braces is refused rather than delivered as a hole.
          </p>

          <label
            htmlFor={noteId}
            className="mt-4 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            Why this version exists <span className="font-normal normal-case">(optional — for the list below)</span>
          </label>
          <input
            id={noteId}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="e.g. Clause 4 reworded after the fee ruling"
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-gray-800 dark:bg-black/20 dark:text-gray-100 dark:focus:ring-indigo-950"
          />

          {/* THE FINALITY, INLINE, BEFORE THE BUTTON — not in a dialog after
              it. Publishing cannot be edited or deleted; it can only be
              superseded by the next version. */}
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 text-pretty">
            Publishing is permanent: versions are never edited and never deleted, because every
            signature is bound to the exact text it was shown. This becomes version{" "}
            {currentVersion + 1}, every member who signs after this moment signs it, and the only
            way to change it later is to publish version {currentVersion + 2}.
          </p>

          <SaveButton
            className="mt-3"
            state={save}
            onSave={() => void publish()}
            onStateSettled={() =>
              setSave((current) => (current.kind === "ok" ? { kind: "idle" } : current))
            }
            label={`Publish as version ${currentVersion + 1}`}
            savingLabel="Publishing…"
            disabled={!dirty}
          />
          {!dirty && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              This is the wording already in force — change it to publish a new version.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Preview — what a member will sign"
          sub="The same clause structure the signing screen renders. Brace values fill with each member's own figures at signing time."
        />
        <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800/60">
          {clauses.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Nothing to preview yet — the text above is empty.
            </p>
          ) : (
            <ol className="space-y-4">
              {clauses.map((clause, i) => (
                <li key={i}>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                    {clause.heading}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {clause.body}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Every version"
          sub="Newest first. Signatures stay bound to the version they were shown, so old versions are records, not drafts."
        />
        <ul className="border-t border-gray-100 dark:border-gray-800/60">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100 px-5 py-3 last:border-b-0 dark:border-gray-800/60"
            >
              <span className="font-mono text-sm font-bold text-gray-900 dark:text-white">
                v{v.version}
              </span>
              {v.version === currentVersion && <Pill tone="good">in force</Pill>}
              <span className="text-xs text-gray-600 dark:text-gray-400">
                published {day(v.createdAt)}
              </span>
              <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
                · {v.signatures} signature{v.signatures === 1 ? "" : "s"}
              </span>
              {v.note && (
                <span className="w-full text-xs text-gray-600 dark:text-gray-400">{v.note}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
