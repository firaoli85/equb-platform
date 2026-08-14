"use client";

import { useState } from "react";
import { previewMessage, updateMessageTemplate } from "@/app/actions/messages";
import { PLACEHOLDER_DOCS } from "@/lib/messages";
import { APPROVED_WORDING_NOTE, isApprovedTemplateKey } from "@/lib/whatsapp-templates";
import { Select } from "@/components/ui/controls";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { Card, CardHeader, inputCls } from "@/components/ui/primitives";

// TEMPLATE EDITING — AND WHERE IT STOPS (2.20, 2.11).
//
// The organizer owns the wording, with live preview against a REAL member,
// rendered through the same placeholder engine the send uses.
//
// FOR FIVE OF THESE, HE DOES NOT. WhatsApp sends the Meta-approved templates
// by ContentSid, so an edit to those bodies never reaches a member — it only
// changes what the preview shows, what the message log stores, and what the
// compose screen quotes. This file used to claim "what is shown is what would
// leave", which stopped being true the day the platform moved to Content
// templates, and nothing on screen said so: the organizer could change a word,
// press Save, get a green tick, and quietly be reading his own sentence while
// members read Meta's.
//
// So the five are LOCKED, with the reason and the route to changing them
// stated where the box would be. `updateMessageTemplate` refuses a divergent
// body as well — this screen is one caller, and the boundary is the action.

type TemplateRow = {
  id: string;
  key: string;
  name: string;
  body: string;
  metaTemplateSid: string | null;
};

type MemberOption = {
  participationId: string;
  nameAmharic: string;
  nameEnglish: string;
};

function TemplateCard({
  template,
  previewParticipationId,
}: {
  template: TemplateRow;
  previewParticipationId: string | null;
}) {
  // Meta owns this sentence — the wording is read-only and the Save button
  // with it. The Meta id below stays editable: that is a record of THEIR
  // reference, not wording of ours.
  const locked = isApprovedTemplateKey(template.key);
  const [body, setBody] = useState(template.body);
  const [metaSid, setMetaSid] = useState(template.metaTemplateSid ?? "");
  // TWO BUTTONS, TWO MESSAGES. One shared notice under both meant a preview
  // failure and a save failure landed in the same place, and the organizer had
  // to read the words to learn which button he had pressed. Each control now
  // carries its own (rule 6, and 6b for the refusal).
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [previewState, setPreviewState] = useState<SaveState>({ kind: "idle" });
  const busy = save.kind === "saving" || previewState.kind === "saving";
  const [preview, setPreview] = useState<{ rendered: string; sampleNote: string | null } | null>(
    null,
  );

  const dirty = body !== template.body || metaSid !== (template.metaTemplateSid ?? "");

  async function handlePreview() {
    if (!previewParticipationId) {
      setPreviewState({ kind: "err", message: "Pick a member to preview against first." });
      return;
    }
    setPreviewState({ kind: "saving" });
    try {
      const result = await previewMessage({
        key: template.key,
        participationId: previewParticipationId,
        body,
      });
      if (!result.ok) {
        setPreviewState({ kind: "err", message: result.error });
        return;
      }
      setPreview({ rendered: result.data.rendered, sampleNote: result.data.sampleNote });
      // The rendered panel below IS the success; only a problem needs words.
      setPreviewState(
        result.data.unknownPlaceholders.length > 0
          ? {
              kind: "err",
              message: `Unknown placeholder(s): ${result.data.unknownPlaceholders
                .map((t) => `{${t}}`)
                .join(", ")} — they would go out literally.`,
            }
          : { kind: "idle" },
      );
    } catch {
      setPreviewState({ kind: "err", message: "Could not reach the server. Try again." });
    }
  }

  async function handleSave() {
    setSave({ kind: "saving" });
    try {
      const result = await updateMessageTemplate({
        id: template.id,
        body,
        metaTemplateSid: metaSid || null,
      });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not saved: ${result.error}` });
        return;
      }
      // AN UNKNOWN PLACEHOLDER IS NOT A SUCCESS. It saved, but the wording
      // would go out with a literal `{thing}` in it, and a green tick that
      // fades in six seconds is the wrong home for that. It stays as a
      // refusal-coloured message until he acts on it.
      setSave(
        result.data.unknownPlaceholders.length > 0
          ? {
              kind: "err",
              message: `Saved — but {${result.data.unknownPlaceholders.join("}, {")}} is not a known placeholder and would go out literally.`,
            }
          : { kind: "ok", message: `Saved the wording for ${template.name}.` },
      );
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — the template was not saved." });
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{template.name}</h3>
        <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
          {template.key}
        </span>
      </div>

      {/* A LOCKED SENTENCE IS SHOWN, NOT HIDDEN. He still needs to read what
          members receive — that is what this screen is for. It is the EDITING
          that is withdrawn, with the reason in the same place. */}
      {locked ? (
        <div>
          <p
            data-testid="approved-wording"
            className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-white/5 dark:text-gray-200"
          >
            {body}
          </p>
          <p className="mt-1.5 flex gap-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-400">
            <span aria-hidden="true">🔒</span>
            <span>{APPROVED_WORDING_NOTE}</span>
          </p>
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSave({ kind: "idle" });
          }}
          rows={3}
          className={`${inputCls} font-mono text-xs leading-relaxed`}
          aria-label={`${template.name} template text`}
        />
      )}

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          Meta-approved template name / SID
        </span>
        <input
          value={metaSid}
          onChange={(e) => {
            setMetaSid(e.target.value);
            setSave({ kind: "idle" });
          }}
          placeholder="Empty until Meta approves this wording"
          className={inputCls}
        />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-400">
          Needed for sends outside the 24-hour window (2.28). Record it here once Meta
          approves, so this message type maps to its approved template.
        </span>
      </label>

      <div className="mt-3 space-y-2">
        <SaveButton
          state={previewState}
          onSave={() => void handlePreview()}
          onStateSettled={() => setPreviewState({ kind: "idle" })}
          label="Preview with real data"
          savingLabel="Rendering…"
          tone="secondary"
          disabled={busy}
          // Previewing wording he has not changed is the normal case — this
          // is how he checks what already goes out.
          dirty
        />
        <SaveButton
          state={save}
          onSave={() => void handleSave()}
          onStateSettled={() => setSave({ kind: "idle" })}
          // The button says what it saves. On a locked template the wording is
          // not in play at all, and calling it "Save wording" would promise
          // exactly the thing the lock above just refused.
          label={locked ? "Save Meta id" : "Save wording"}
          dirty={dirty}
          disabled={busy}
          notDirtyHint={
            locked ? "The Meta id has not changed." : "The wording has not changed."
          }
        />
      </div>

      {preview && (
        <div className="mt-3 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
            Preview — real derived data
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100">
            {preview.rendered}
          </p>
          {preview.sampleNote && (
            <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
              {preview.sampleNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function TemplatesEditor({
  templates,
  members,
}: {
  templates: TemplateRow[];
  members: MemberOption[];
}) {
  const [previewId, setPreviewId] = useState<string | null>(
    members[0]?.participationId ?? null,
  );

  return (
    <Card>
      <CardHeader
        title="Templates"
        sub="Your wording, filled from each member's derived state at send time — the numbers are never typed (2.21)."
        right={
          <label className="block text-right">
            <span className="mb-1 block text-[11px] font-semibold text-gray-600 dark:text-gray-400">
              Preview against
            </span>
            <Select
              value={previewId ?? ""}
              onChange={(value) => setPreviewId(value || null)}
              ariaLabel="Preview against member"
              className="w-56"
              options={
                members.length === 0
                  ? [{ value: "", label: "No active members" }]
                  : members.map((m) => ({
                      value: m.participationId,
                      label: m.nameAmharic ? `${m.nameEnglish} (${m.nameAmharic})` : m.nameEnglish,
                    }))
              }
            />
          </label>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <details className="rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
            Available placeholders
          </summary>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {PLACEHOLDER_DOCS.map((p) => (
              <div key={p.token} className="flex gap-2">
                <dt className="shrink-0 font-mono text-indigo-700 dark:text-indigo-300">
                  {p.token}
                </dt>
                <dd className="text-gray-600 dark:text-gray-400">{p.description}</dd>
              </div>
            ))}
          </dl>
        </details>

        {templates.map((t) => (
          <TemplateCard key={t.id} template={t} previewParticipationId={previewId} />
        ))}
      </div>
    </Card>
  );
}
