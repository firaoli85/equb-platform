"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { activateCycle, deleteDraftCycle } from "@/app/actions/cycles";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Card, Pill, buttonCls } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { formatMoney } from "@/lib/format";

// DRAFT CYCLES — the way out, on screen (Cycle-2 build, feature A).
//
// `createCycle` writes DRAFT whenever a cycle is already ACTIVE, and the form
// says "Saved as a draft" — and then NOTHING listed, activated or deleted it.
// A draft and its week rows were permanent orphans the organizer could not
// even see. The three actions closing that hole (listDraftCycles,
// activateCycle, deleteDraftCycle) have existed, tested, since the audit
// found it; this section is what finally reaches them.
//
// THE WHOLE SECTION DISAPPEARS WHEN THERE ARE NO DRAFTS — header included.
// A draft is a between-cycles planning state, not a standing feature of the
// page; an empty "Drafts" section would read as something missing.

export type DraftCycleRow = {
  id: string;
  name: string;
  /** ISO day, e.g. "2026-10-04" — formatted here, in UTC like every date. */
  startDate: string;
  plannedWeeks: number;
  unitAmount: number;
  weekCount: number;
  memberCount: number;
};

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function DraftCycles({ drafts }: { drafts: DraftCycleRow[] }) {
  const router = useRouter();
  // ONE SLOT, KEYED TO THE ROW (UI_STANDARDS rule 6) — same shape as the
  // member send panel, and for the same reason: one draft's refusal must
  // never render under another draft's button.
  const [save, setSave] = useState<{ id: string; state: SaveState } | null>(null);
  const busyId = save?.state.kind === "saving" ? save.id : null;

  // The delete dialog's state: which draft, and the refusal that keeps it
  // open (6b — the reason stays beside the button that caused it).
  const [deleting, setDeleting] = useState<DraftCycleRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (drafts.length === 0) return null;

  async function activate(row: DraftCycleRow) {
    setSave({ id: row.id, state: { kind: "saving" } });
    try {
      const result = await activateCycle({ cycleId: row.id });
      if (!result.ok) {
        // THE REFUSAL LANDS AT THE CONTROL. The one this button actually
        // meets in practice is the one_active_cycle rule — "X is already the
        // live cycle" — and it must be read where it was caused.
        setSave({ id: row.id, state: { kind: "err", message: `Not activated — ${result.error}` } });
        return;
      }
      setSave({ id: row.id, state: { kind: "ok", message: `“${row.name}” is now the live cycle.` } });
      router.refresh();
    } catch {
      setSave({
        id: row.id,
        state: { kind: "err", message: "Could not reach the server — nothing was changed." },
      });
    }
  }

  async function confirmDelete(typedName: string) {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      // WHAT WAS ACTUALLY TYPED is forwarded, never the phrase this component
      // already holds — see ConfirmDialog's onConfirm note for the replayed
      // call that made a typed check pass with nothing typed at all.
      const result = await deleteDraftCycle({ cycleId: deleting.id, typedName });
      if (!result.ok) {
        // The dialog STAYS OPEN with the reason beside the button (6b).
        setDeleteError(result.error);
        return;
      }
      setDeleting(null);
      router.refresh();
    } catch {
      setDeleteError("Could not reach the server — nothing was deleted.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const spec: ConfirmSpec | null = deleting
    ? {
        title: `Delete the draft “${deleting.name}”?`,
        body: (
          <>
            This deletes the draft cycle, its {deleting.weekCount} generated week
            {deleting.weekCount === 1 ? "" : "s"} and its numbering setting. A draft has no money,
            no draws and no members recorded against it, so nothing real is destroyed — but there
            is no undo.
          </>
        ),
        confirmLabel: "Delete this draft",
        destructive: true,
        // HIGH-STAKES SHAPE, LOW-STAKES OBJECT — the phrase is required by the
        // ACTION (typedName), so the dialog collects it rather than pretending
        // the server does not ask.
        requirePhrase: deleting.name,
      }
    : null;

  return (
    <section className="space-y-3 animate-fade-in-up-1" aria-labelledby="drafts">
      <h2
        id="drafts"
        className="px-1 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
      >
        Drafts — not running yet
      </h2>
      <ul className="space-y-3">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Card className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-base font-bold text-gray-900 dark:text-white">
                  {draft.name}
                </span>
                <Pill tone="neutral">draft</Pill>
                <span className="ml-auto text-xs tabular-nums text-gray-600 dark:text-gray-400">
                  {draft.memberCount} member{draft.memberCount === 1 ? "" : "s"} so far
                </span>
              </div>
              <p className="mt-1 text-xs tabular-nums text-gray-600 dark:text-gray-400">
                From {day(draft.startDate)} · {draft.plannedWeeks} weeks ·{" "}
                {formatMoney(draft.unitAmount)} unit
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-3">
                <SaveButton
                  state={save !== null && save.id === draft.id ? save.state : { kind: "idle" }}
                  onSave={() => void activate(draft)}
                  onStateSettled={() =>
                    setSave((current) =>
                      current !== null && current.id === draft.id && current.state.kind === "ok"
                        ? null
                        : current,
                    )
                  }
                  label={`Make “${draft.name}” the live cycle`}
                  savingLabel="Activating…"
                  disabled={busyId !== null && busyId !== draft.id}
                />
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleting(draft);
                  }}
                  className={buttonCls.danger + " disabled:opacity-40"}
                >
                  Delete draft…
                </button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        spec={spec}
        busy={deleteBusy}
        error={deleteError}
        onConfirm={(typedPhrase) => void confirmDelete(typedPhrase)}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
      />
    </section>
  );
}
