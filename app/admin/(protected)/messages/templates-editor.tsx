"use client";

import { useState } from "react";
import { previewMessage, updateMessageTemplate } from "@/app/actions/messages";
import { PLACEHOLDER_DOCS } from "@/lib/messages";
import { Select } from "@/components/ui/controls";
import { Alert, buttonCls, Card, CardHeader, inputCls } from "@/components/ui/primitives";

// Template editing (2.20: the organizer owns the wording) with live preview
// against a REAL member — the preview renders the current draft through the
// same placeholder engine the send uses, so what is shown is what would
// leave.

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
  const [body, setBody] = useState(template.body);
  const [metaSid, setMetaSid] = useState(template.metaTemplateSid ?? "");
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ rendered: string; sampleNote: string | null } | null>(
    null,
  );

  const dirty = body !== template.body || metaSid !== (template.metaTemplateSid ?? "");

  async function handlePreview() {
    if (!previewParticipationId) {
      setNotice({ kind: "err", text: "Pick a member to preview against first." });
      return;
    }
    setBusy("preview");
    setNotice(null);
    try {
      const result = await previewMessage({
        key: template.key,
        participationId: previewParticipationId,
        body,
      });
      if (!result.ok) {
        setNotice({ kind: "err", text: result.error });
        return;
      }
      setPreview({ rendered: result.data.rendered, sampleNote: result.data.sampleNote });
      if (result.data.unknownPlaceholders.length > 0) {
        setNotice({
          kind: "err",
          text: `Unknown placeholder(s): ${result.data.unknownPlaceholders
            .map((t) => `{${t}}`)
            .join(", ")} — they would go out literally.`,
        });
      }
    } catch {
      setNotice({ kind: "err", text: "Could not reach the server. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    setNotice(null);
    try {
      const result = await updateMessageTemplate({
        id: template.id,
        body,
        metaTemplateSid: metaSid || null,
      });
      if (!result.ok) {
        setNotice({ kind: "err", text: `Not saved: ${result.error}` });
        return;
      }
      setNotice({
        kind: "ok",
        text:
          result.data.unknownPlaceholders.length > 0
            ? `✓ Saved — but {${result.data.unknownPlaceholders.join("}, {")}} is not a known placeholder and would go out literally.`
            : "✓ Saved.",
      });
    } catch {
      setNotice({ kind: "err", text: "Could not reach the server — the template was not saved." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{template.name}</h3>
        <span className="text-[11px] font-mono text-gray-500 dark:text-gray-500">
          {template.key}
        </span>
      </div>

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setNotice(null);
        }}
        rows={3}
        className={`${inputCls} font-mono text-xs leading-relaxed`}
        aria-label={`${template.name} template text`}
      />

      <label className="mt-3 block">
        <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          Meta-approved template name / SID
        </span>
        <input
          value={metaSid}
          onChange={(e) => {
            setMetaSid(e.target.value);
            setNotice(null);
          }}
          placeholder="Empty until Meta approves this wording"
          className={inputCls}
        />
        <span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-500">
          Needed for sends outside the 24-hour window (2.28). Record it here once Meta
          approves, so this message type maps to its approved template.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handlePreview}
          disabled={busy !== null}
          className={buttonCls.secondary}
        >
          {busy === "preview" ? "Rendering…" : "Preview with real data"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy !== null || !dirty}
          className={buttonCls.primary}
        >
          {busy === "save" ? "Saving…" : "Save wording"}
        </button>
      </div>

      {notice && (
        <div className="mt-2">
          <Alert kind={notice.kind}>{notice.text}</Alert>
        </div>
      )}

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
                      label: `${m.nameAmharic} (${m.nameEnglish})`,
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
