"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateWeek } from "@/app/actions/edits";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { Alert, buttonCls } from "@/components/ui/primitives";
import { parseIsoDay, weekDateBounds } from "@/lib/date-bounds";
import { formatDateLongUTC, parseDateInput } from "@/lib/format";

export function WeekEditor({
  week,
  plannedWeeks,
  previousWeek = null,
  nextWeek = null,
}: {
  week: { id: string; weekNumber: number; date: string; isSkipped: boolean; notes: string | null };
  /** The cycle length, so the LAST week can say it is the finish (2.22). */
  plannedWeeks: number;
  /** The rows either side, so this date cannot jump out of sequence. */
  previousWeek?: { weekNumber: number; date: string } | null;
  nextWeek?: { weekNumber: number; date: string } | null;
}) {
  const router = useRouter();
  const [date, setDate] = useState(week.date);
  const [isSkipped, setIsSkipped] = useState(week.isSkipped);
  const [notes, setNotes] = useState(week.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  // 2.14: elapsed weeks are decided by each week's OWN stored date, so a
  // date out of sequence does not merely look wrong — it changes who is in
  // arrears. Bounded strictly between the neighbouring rows.
  const bounds = weekDateBounds({
    previousWeek: previousWeek
      ? { weekNumber: previousWeek.weekNumber, date: parseIsoDay(previousWeek.date)! }
      : null,
    nextWeek: nextWeek
      ? { weekNumber: nextWeek.weekNumber, date: parseIsoDay(nextWeek.date)! }
      : null,
  });

  const dirty = date !== week.date || isSkipped !== week.isSkipped || notes !== (week.notes ?? "");
  const skipChanged = isSkipped !== week.isSkipped;

  // 2.22: this row IS the cycle's finish. Retyping its date moves when the
  // whole group finishes, so the consequence is stated here rather than left
  // for the organizer to work out from a list of dates.
  const isFinishWeek = week.weekNumber === plannedWeeks;
  const liveDate = isFinishWeek ? parseDateInput(date) : null;
  const savedDate = isFinishWeek ? parseDateInput(week.date) : null;
  const dateChanged = isFinishWeek && date !== week.date;

  async function doSave() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await updateWeek({ weekId: week.id, date, isSkipped, notes: notes || undefined });
      if (!result.ok) setMsg({ kind: "err", text: `Not saved: ${result.error}` });
      else {
        setMsg({ kind: "ok", text: "✓ Saved." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing confirmed." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] px-3 py-2 text-sm shadow-sm">
      <span className="w-16 font-semibold text-gray-900 dark:text-white">Week {week.weekNumber}</span>
      <DatePicker
        value={date}
        onChange={setDate}
        ariaLabel={`Date of week ${week.weekNumber}`}
        bounds={bounds}
      />
      <Checkbox checked={isSkipped} onChange={setIsSkipped} label="skipped" />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="notes"
        className="w-48 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
      />
      <button
        type="button"
        onClick={() =>
          setConfirm({
            title: `Save week ${week.weekNumber}?`,
            destructive: false,
            body: (
              <>
                {dateChanged && liveDate !== null && savedDate !== null && (
                  <p>
                    This is the cycle&apos;s <strong>finish week</strong>. The cycle finishes{" "}
                    <strong>{formatDateLongUTC(savedDate)}</strong> today and would finish{" "}
                    <strong>{formatDateLongUTC(liveDate)}</strong> after this change.
                  </p>
                )}
                {skipChanged ? (
                  <p>
                    Skipped changes to{" "}
                    <strong>{isSkipped ? "YES — nobody owes this week" : "NO — this week is owed again"}</strong>.
                    EVERY member&apos;s receipts re-allocate immediately, and an audit entry records
                    the change.
                  </p>
                ) : (
                  <p>An audit entry records the change.</p>
                )}
              </>
            ),
            confirmLabel: `Save week ${week.weekNumber}`,
          })
        }
        disabled={busy || !dirty}
        className={buttonCls.secondary + " !px-3 !py-1.5"}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {isFinishWeek && (
        <p className="basis-full text-xs font-semibold text-indigo-800 dark:text-indigo-300">
          {liveDate !== null
            ? `The cycle's finish week — the cycle finishes ${formatDateLongUTC(liveDate)}.`
            : "The cycle's finish week — enter a date to see when the cycle finishes."}
        </p>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => void doSave()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
