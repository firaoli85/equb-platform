"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateWeek } from "@/app/actions/edits";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { buttonCls, Field, inputCls, Pill, Table, Td, Th } from "@/components/ui/primitives";
import { isWithinBounds, outOfBoundsMessage, parseIsoDay } from "@/lib/date-bounds";
import { formatDateLongUTC, formatDateUTC } from "@/lib/format";
import {
  boundsForWeek,
  describeWeekDateChange,
  outOfSequenceWeeks,
  weekClock,
  weekClockLabel,
  weekWindowClosesOn,
  type WeekDateRow,
} from "./week-dates";

// THE AUTHORITATIVE DATES, SHOWN — AND ONE OF THEM CORRECTABLE (2.23, rule 7).
//
// ADMIN_IA §3 puts "the stored dates that are authoritative (rule 7), and the
// position they produce" on this page. It had the second half only. Every
// elapsed/late/behind figure above comes from these days, and until now there
// was no screen anywhere that printed one, let alone changed one — the editor
// died with `/admin/cycle/weeks` and `updateWeek` was left with no callers at
// all. A mis-dated week therefore needed raw SQL, which 2.23 forbids by name.
//
// NO SKIP CONTROL, and none may be added. docs/CYCLE_POSITION_SPEC.md PART 2:
// "there are no skipped weeks in an Equb, every week is a commitment", and
// docs/MANUAL_QA_CHECKLIST.md makes "no control anywhere on this screen offers
// to skip a week" a PASS condition. `updateWeek` takes `isSkipped` optionally
// now precisely so this screen never has to send a value it does not own.
//
// ONE WEEK AT A TIME. A bulk date editor would let the organizer commit a
// ladder of changes whose combined effect on who is overdue nobody could state
// beforehand — and stating it beforehand is the whole point of the dialog.

export function WeekDatePanel({
  weeks,
  todayIso,
}: {
  weeks: WeekDateRow[];
  /** YYYY-MM-DD, from the server, so the clock is one fact and not two. */
  todayIso: string;
}) {
  // THE DRAFT LIVES HERE, not inside the editor, and that is deliberate.
  //
  // It makes what the editor renders a function of its props. There is no
  // jsdom in this repo — assertions are made on rendered HTML — so a control
  // whose output depends on state nothing can set is a control nothing can
  // assert, and the consequence sentence is the single most important thing on
  // this screen to get in front of the organizer before he saves.
  //
  // It also means opening a different week discards the previous draft by
  // construction rather than by remembering to clear it.
  const [draft, setDraft] = useState<{ weekId: string; date: string; notes: string } | null>(null);
  const today = parseIsoDay(todayIso);
  const faults = new Set(outOfSequenceWeeks(weeks));

  if (weeks.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
        This cycle has no week rows yet. They are created with the cycle, and every date shown
        anywhere in the platform comes from them.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Table>
        <thead>
          <tr>
            <Th>Week</Th>
            <Th>Stored date</Th>
            <Th>Payment window</Th>
            <Th align="right">Members short</Th>
            <Th>Note</Th>
            <Th align="right">
              <span className="sr-only">Correct the date</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => {
            const day = parseIsoDay(week.date);
            const clock = today === null ? null : weekClock({ date: week.date, today });
            const closes = weekWindowClosesOn(week.date);
            const closesDay = closes === null ? null : parseIsoDay(closes);
            const open = draft?.weekId === week.id;
            return [
              <tr key={week.id} data-testid="week-date-row" data-week={week.weekNumber}>
                <Td numeric>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    Week {week.weekNumber}
                  </span>
                  {faults.has(week.weekNumber) && (
                    // Named at the row rather than only counted in the nav: a
                    // dot on a tab tells him something is wrong, this tells him
                    // which week and why (audit finding 29).
                    <span className="ml-2">
                      <Pill tone="problem">out of order</Pill>
                    </span>
                  )}
                </Td>
                <Td numeric>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {day === null ? week.date : formatDateUTC(day)}
                  </span>
                </Td>
                <Td>
                  {clock === null ? (
                    <span className="text-gray-600 dark:text-gray-400">unreadable</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <Pill tone={clock === "open" ? "attention" : "neutral"}>
                        {weekClockLabel(clock)}
                      </Pill>
                      <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
                        {clock === "closed" ? "shut" : "shuts"}{" "}
                        {closesDay === null ? closes : formatDateUTC(closesDay)}
                      </span>
                    </span>
                  )}
                </Td>
                <Td numeric align="right">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {week.membersShort}
                  </span>
                  <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">
                    of {week.membersExpected}
                  </span>
                </Td>
                <Td>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {week.notes ?? ""}
                  </span>
                </Td>
                <Td align="right">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setDraft(
                        open
                          ? null
                          : { weekId: week.id, date: week.date, notes: week.notes ?? "" },
                      )
                    }
                    className={buttonCls.ghost}
                  >
                    {open ? "Close" : `Correct week ${week.weekNumber}…`}
                  </button>
                </Td>
              </tr>,
              open && draft ? (
                <tr key={`${week.id}-editor`}>
                  {/* The editor opens IN the row it belongs to, so the refusal
                      it can produce lands where the button was pressed
                      (UI_STANDARDS 6b) rather than in a panel elsewhere. */}
                  <td
                    colSpan={6}
                    className="border-b border-gray-100 bg-gray-50/60 px-4 py-4 dark:border-gray-800/60 dark:bg-white/[0.02]"
                  >
                    <WeekDateEditor
                      row={week}
                      weeks={weeks}
                      todayIso={todayIso}
                      date={draft.date}
                      notes={draft.notes}
                      onDate={(date) => setDraft((d) => (d === null ? d : { ...d, date }))}
                      onNotes={(notes) => setDraft((d) => (d === null ? d : { ...d, notes }))}
                      onClose={() => setDraft(null)}
                    />
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </Table>

      {/* WHO IS IN THE TWO NUMBERS, exactly. This said "money not yet in for
          that week, out of everyone whose own window covers it" and was wrong
          twice: the column is a COUNT OF PEOPLE, not an amount, and it is not
          everyone in window — `lib/dashboard.ts` `weekReceipts` runs
          `if (payment?.isDeferred) continue;` BEFORE `membersExpected++`, so a
          deferred member is missing from the denominator and the numerator
          alike. A footnote explaining a column has to describe that column.

          IT WAS THEN WRONG A THIRD TIME, in the correction: "decided by the
          week's own stored date, and by NOTHING ELSE". True until the
          organizer gained a late mark of his own (2.2) — `paymentStatus`
          returns LATE on that mark BEFORE it looks at the window, and
          `weekCountsAsDue` makes the week due whatever the date says. A
          marked-late member sits inside this very column, since `weekReceipts`
          ignores the mark entirely. */}
      <p className="text-xs text-gray-600 dark:text-gray-400 text-pretty">
        &ldquo;Members short&rdquo; counts the members who have not paid their full weekly amount
        for that week, out of everyone whose own window covers it —{" "}
        <strong>except anyone whose week you have deferred</strong>, who is counted in neither
        figure. Being short only becomes <strong>overdue</strong> once that week&apos;s payment
        window has shut — which the week&apos;s own stored date above decides (rule 7), unless
        you have marked the week late by hand, which decides it whatever the date says.
      </p>
    </div>
  );
}

/**
 * The correction itself — controlled, and exported.
 *
 * Both for the same reason: there is no jsdom here, so a control that only
 * appears after a click is a control no test can see, and a sentence that only
 * appears after typing is a sentence no test can read. The draft comes in as
 * props (owned by the panel), so everything this renders can be asserted.
 */
export function WeekDateEditor({
  row,
  weeks,
  todayIso,
  date,
  notes,
  onDate,
  onNotes,
  onClose,
}: {
  row: WeekDateRow;
  /** Every week of the cycle — the neighbours are what bound this date. */
  weeks: readonly WeekDateRow[];
  todayIso: string;
  /** The proposed date, YYYY-MM-DD. Opens on the stored one. */
  date: string;
  notes: string;
  onDate: (iso: string) => void;
  onNotes: (notes: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran. Set it and the dialog stays
   * open with the reason inside, beside the button that caused it — never only
   * in a banner elsewhere on the page (UI_STANDARDS 6b).
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  // DERIVED: the dialog's busy state and the button's are the same fact.
  const busy = save.kind === "saving";

  const bounds = boundsForWeek(weeks, row.weekNumber);
  const today = parseIsoDay(todayIso);
  const dirty = date !== row.date || notes.trim() !== (row.notes ?? "").trim();
  const change =
    today === null
      ? null
      : describeWeekDateChange({ row, to: date, today, formatDay: formatDateLongUTC });

  function askToSave() {
    // A refusal that is knowable BEFORE the request is said at the control
    // instead of round-tripped (UI_STANDARDS 6b). The picker already blocks
    // these days, but the field also accepts typing.
    if (!isWithinBounds(date, bounds)) {
      setSave({
        kind: "err",
        message:
          outOfBoundsMessage(bounds) ?? "That date is outside the range allowed for this week.",
      });
      return;
    }
    setConfirm({
      title: change
        ? `Move week ${row.weekNumber} to ${formatDateUTC(parseIsoDay(date)!)}?`
        : `Save week ${row.weekNumber}'s note?`,
      destructive: false,
      // THE CONSEQUENCE SLOT carries who this moves — the one thing about a
      // date edit that is invisible and expensive. Everything else is in the
      // body, where background belongs.
      consequence: change ? <p>{change.standing}</p> : null,
      body: (
        <>
          {change ? (
            change.facts.map((fact) => <p key={fact}>{fact}</p>)
          ) : (
            <p>
              The date is unchanged — only week {row.weekNumber}&apos;s note is saved. Nobody&apos;s
              standing moves.
            </p>
          )}
          {/* BOTH HALVES OF WHAT THE DATE DOES, in one sentence: the receipt
              rows that stay exactly where they are, and the late/behind
              figures that do not. This slot used to hold a bare "nothing
              changes" line, which was true of the rows and false of every
              figure the day itself decides (rule 7). The whole story lives on
              `WeekDateChange.whatMoves` in week-dates.ts — one place, because
              a second copy of it would be a second thing to keep true. */}
          {change && <p>{change.whatMoves}</p>}
          <p>
            An audit entry records the old and new date, and every figure that derives from it
            recalculates at once.
          </p>
        </>
      ),
      confirmLabel: change ? `Move week ${row.weekNumber}` : "Save note",
    });
  }

  async function doSave() {
    setSave({ kind: "saving" });
    /** The refusal, if any — the dialog closes only while this stays null. */
    let refused: string | null = null;
    try {
      const result = await updateWeek({
        weekId: row.id,
        date,
        // `isSkipped` is deliberately NOT sent. There is no skip control here
        // and there must not be one; omitting it leaves the stored value
        // exactly as it is, so this screen cannot flip a flag it never showed.
        notes,
      });
      if (!result.ok) {
        refused = `Not saved: ${result.error}`;
        setSave({ kind: "err", message: refused });
      } else {
        setSave({
          kind: "ok",
          message: `Saved — week ${row.weekNumber} is ${formatDateUTC(parseIsoDay(date)!)}.`,
        });
        // The editor deliberately STAYS OPEN. Closing it on success would take
        // the confirmation with it and return the organizer to the same view
        // with nothing changed on screen, which is the silent save rule 6 beat
        // 3 exists to forbid. The row above it re-renders with the new date.
        router.refresh();
      }
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was saved." });
    } finally {
      // CLOSE ONLY ON SUCCESS. Closing regardless throws the refusal away with
      // the dialog that could have shown it (UI_STANDARDS 6b).
      if (refused === null) {
        setConfirm(null);
      } else {
        setDialogError(refused);
      }
    }
  }

  return (
    <div className="max-w-xl space-y-3" data-testid="week-date-editor">
      <div className="flex flex-wrap items-start gap-3">
        <Field label={`Week ${row.weekNumber} fell on`}>
          <DatePicker
            value={date}
            onChange={(iso) => {
              onDate(iso);
              setSave({ kind: "idle" });
            }}
            ariaLabel={`Week ${row.weekNumber}'s date`}
            bounds={bounds}
          />
        </Field>
        <Field label="Note (optional)">
          <input
            value={notes}
            onChange={(e) => {
              onNotes(e.target.value);
              setSave({ kind: "idle" });
            }}
            placeholder="e.g. moved for the holiday"
            aria-label={`Week ${row.weekNumber}'s note`}
            className={inputCls + " w-64"}
          />
        </Field>
      </div>

      {/* The bound, in words, before he opens the calendar. A picker that
          greys out days without saying why reads as a broken app (rule 11). */}
      {bounds.reason && (
        <p className="text-xs text-amber-800 dark:text-amber-300 text-pretty">{bounds.reason}</p>
      )}

      {/* The consequence is previewed HERE too, not only in the dialog: he
          should be able to see what a date does before committing to opening a
          confirmation about it. */}
      {change && (
        <p
          data-testid="week-date-consequence"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 text-pretty"
        >
          {change.standing}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SaveButton
          state={save}
          onSave={askToSave}
          onStateSettled={() => setSave({ kind: "idle" })}
          label={`Save week ${row.weekNumber}`}
          dirty={dirty}
          notDirtyHint="The date and the note are unchanged."
        />
        <button type="button" onClick={onClose} className={buttonCls.ghost}>
          Close
        </button>
      </div>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy}
        onConfirm={() => void doSave()}
        onCancel={() => {
          setDialogError(null);
          setConfirm(null);
        }}
      />
    </div>
  );
}
