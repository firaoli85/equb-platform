"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCycle } from "@/app/actions/cycles";
import { DatePicker } from "@/components/ui/date-picker";
import { AmountInput, NumberInput, Radio } from "@/components/ui/controls";
import { Card, Field } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { cycleFinishPreview, finishLine, parseWeekField } from "@/lib/commitment";
import { defaultWithinBounds, isWithinBounds, type DateBounds } from "@/lib/date-bounds";
import { formatDateLongUTC, formatDateUTC, formatMoney, parseDateInput, parseDollarsToCents } from "@/lib/format";
import { MAX_MONEY_CENTS, MAX_WEEKS } from "@/lib/money";
import { cycleFeeProjection } from "@/lib/projection";

const INITIAL = {
  name: "",
  startDate: "",
  plannedWeeks: "20",
  unitDollars: "1000",
  feePercent: "2",
  // A deliberate choice, never an assumption (no preselection).
  numbering: "" as "" | "fresh" | "carryover",
  /** Override for the weekly pot, in dollars; "" = use weeks × unitAmount. */
  potOverrideDollars: "",
};

export function NewCycleForm({ startBounds }: { startBounds: DateBounds }) {
  const router = useRouter();
  // Never blank: the picker opens on the first date that is actually allowed,
  // which with an active cycle is the day after it ends rather than today.
  const [fields, setFields] = useState(() => ({
    ...INITIAL,
    startDate: defaultWithinBounds(startBounds),
  }));
  // ONE state for the save; everything else is derived from it (rule 6). The
  // four it replaces — saving / error / savedAsDraft / savedActive — rendered
  // their message ABOVE a form of eight controls, which on this screen is also
  // above the fold: exactly the place the organizer is not looking after
  // pressing the button at the bottom.
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  /**
   * An ACTIVE cycle was created and we are on our way to it.
   *
   * NOT a duplicate of `save`: `save` returns to idle the moment a field is
   * edited, and a keystroke landing during the navigation must not re-arm the
   * button and let a second cycle be created.
   */
  const [created, setCreated] = useState(false);

  const dirty = Object.entries(INITIAL).some(
    ([key, value]) => fields[key as keyof typeof INITIAL] !== value,
  );

  const set = (key: keyof typeof INITIAL) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    // Editing withdraws a stale message — but never the "opening it now" one:
    // that form has already created its cycle and stays locked.
    if (!created) setSave({ kind: "idle" });
  };

  // 2.22: the organizer never calculates a finish. Same pure preview and same
  // sentence as the add-member wizard and the participation editor — a cycle
  // simply always starts at its own week 1.
  const startDate = parseDateInput(fields.startDate);
  const weeks = parseWeekField(fields.plannedWeeks);
  const weeksValid = weeks !== null && weeks <= MAX_WEEKS;
  const preview =
    startDate && weeksValid
      ? // No cycle exists yet, so there are no stored week rows to prefer —
        // createCycle writes them with this same rhythm on submit.
        cycleFinishPreview({ cycleStartDate: startDate, plannedWeeks: weeks, stored: null })
      : null;
  const startLabel = startDate ? formatDateUTC(startDate) : null;

  // ————— The money projection (live) —————
  //
  // STRUCTURAL, not roster-based. One slot pays out per week, so an N-week
  // cycle has N slots and collects N × unitAmount every week — whoever fills
  // them. The previous version projected from last cycle's members ("if the
  // same 28 join"), which held the pot fixed and therefore reported that a
  // 30-week cycle was worth only 1.5× a 20-week one. It is worth 2.25×.
  const feePercentNum = Number.parseFloat(fields.feePercent || "0");
  const unitAmount = parseDollarsToCents(fields.unitDollars);
  const potOverride =
    fields.potOverrideDollars.trim() === ""
      ? null
      : parseDollarsToCents(fields.potOverrideDollars);
  const overrideInvalid = fields.potOverrideDollars.trim() !== "" && potOverride === null;

  const projectAt = (w: number) =>
    unitAmount === null
      ? null
      : cycleFeeProjection({
          plannedWeeks: w,
          unitAmount,
          feePercent: feePercentNum,
          weeklyPotOverride: potOverride,
        });

  const mainProjection = weeksValid ? projectAt(weeks) : null;
  const compareWeeks = [...new Set([20, 25, 30, ...(weeksValid ? [weeks] : [])])].sort(
    (a, b) => a - b,
  );

  async function handleSubmit() {
    // REFUSALS KNOWABLE WITHOUT A ROUND TRIP are said at the button rather
    // than sent to the server and shown on the way back (UI_STANDARDS 6b).
    if (!weeksValid) {
      setSave({
        kind: "err",
        message: `Not saved: Planned weeks must be a whole number between 1 and ${MAX_WEEKS}.`,
      });
      return;
    }
    // The picker refuses out-of-range dates, but a value can still arrive
    // through a stale state or a paste; the reason shown is the same one.
    if (!isWithinBounds(fields.startDate, startBounds)) {
      setSave({
        kind: "err",
        message: `Not saved: ${startBounds.reason ?? "That start date is not available."}`,
      });
      return;
    }
    const unitAmount = parseDollarsToCents(fields.unitDollars);
    if (unitAmount === null || unitAmount < 1 || unitAmount > MAX_MONEY_CENTS) {
      setSave({ kind: "err", message: "Not saved: Unit amount must be a valid dollar amount." });
      return;
    }
    if (fields.numbering === "") {
      setSave({
        kind: "err",
        message: "Not saved: Choose how lucky numbers are assigned — fresh, or carried over.",
      });
      return;
    }
    const feePercent = Number.parseFloat(fields.feePercent);

    setSave({ kind: "saving" });
    try {
      const result = await createCycle({
        name: fields.name,
        startDate: fields.startDate,
        plannedWeeks: weeks,
        unitAmount,
        feePercent,
        numbering: fields.numbering,
      });
      if (!result.ok) {
        setSave({ kind: "err", message: `Not saved: ${result.error}` });
        return;
      }
      // THE FIGURES COME BACK FROM THE SERVER, not from the fields still on
      // screen. The organizer reads this line to check he created what he
      // meant to, so it has to be the record that now exists.
      const figures = `${result.data.plannedWeeks} weeks at ${formatMoney(result.data.unitAmount)}, ${result.data.feePercent}% fee`;
      if (result.data.status === "ACTIVE") {
        // Show the confirmation, keep the button locked, then land on the
        // cycle page displaying the new cycle.
        setCreated(true);
        setSave({
          kind: "ok",
          message: `Created “${result.data.name}” — ${figures}, week 1 on ${startLabel ?? fields.startDate}. Opening it now…`,
        });
        router.push("/admin/cycle");
        router.refresh();
      } else {
        // Reset to pristine so a second click cannot create a duplicate.
        setFields(INITIAL);
        setSave({
          kind: "ok",
          message: `Saved “${result.data.name}” as a draft — ${figures}, week 1 on ${startLabel ?? fields.startDate}. Another cycle is currently active, so this one did not become active.`,
        });
      }
    } catch {
      // NOT "Not saved": the request may well have landed. Claiming otherwise
      // is how a duplicate cycle gets created on the retry — say what to check.
      setSave({
        kind: "err",
        message:
          "The save could not be confirmed — check your connection and look at the cycle list before trying again.",
      });
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-6">
      {/* The form stays: Enter is how anyone finishes typing a name, and it
          must reach the same handler the SaveButton press does. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !created && save.kind !== "saving") void handleSubmit();
        }}
        className="w-full max-w-md space-y-4"
      >
        <Field label="Name">
          <input
            type="text"
            value={fields.name}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="Cycle 2"
            className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600"
          />
        </Field>

        <Field label="Start date">
          <DatePicker
            value={fields.startDate}
            onChange={set("startDate")}
            ariaLabel="Cycle start date"
            bounds={startBounds}
          />
        </Field>

        <Field label="Planned weeks">
          <NumberInput
            value={fields.plannedWeeks}
            onChange={set("plannedWeeks")}
            min={1}
            ariaLabel="Planned weeks"
          />
        </Field>

        <Field
          label="Unit amount (dollars)"
          hint="Contributions above this split into multiple lucky numbers."
        >
          <AmountInput
            value={fields.unitDollars}
            onChange={set("unitDollars")}
            ariaLabel="Unit amount in dollars"
          />
        </Field>

        <Field label="Fee percent">
          <NumberInput
            value={fields.feePercent}
            onChange={set("feePercent")}
            min={0}
            max={100}
            step="0.1"
            ariaLabel="Fee percent"
          />
        </Field>

        <fieldset className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 text-sm">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Lucky numbers
          </legend>
          <div className="space-y-2">
            <Radio
              name="numbering"
              checked={fields.numbering === "fresh"}
              onSelect={() => set("numbering")("fresh")}
              label="Assign fresh numbers — everyone starts new this cycle."
            />
            <Radio
              name="numbering"
              checked={fields.numbering === "carryover"}
              onSelect={() => set("numbering")("carryover")}
              label="Carry numbers over — each person keeps their previous cycle's numbers when free (fresh numbers otherwise)."
            />
          </div>
        </fieldset>

        {preview !== null ? (
          <p
            className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-3 text-base font-bold text-indigo-900 dark:text-indigo-200"
            data-testid="cycle-preview"
          >
            Runs week 1 ({startLabel}) — {finishLine(preview, formatDateLongUTC, preview.finishWeek)}
          </p>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
            Enter a start date and a length to see when the cycle finishes.
          </p>
        )}

        {/* Name, start date, weeks, unit amount, fee, the numbering choice and
            the finish preview all sit above this. The confirmation renders AT
            the button, never at the top of the form (rule 6). */}
        <SaveButton
          state={save}
          onSave={() => void handleSubmit()}
          onStateSettled={() => setSave({ kind: "idle" })}
          label="Create cycle"
          savingLabel="Saving…"
          dirty={dirty}
          disabled={created}
          notDirtyHint="Nothing has been entered yet."
        />
      </form>

      {/* ————— The money projection ————— */}
      <Card className="w-full max-w-sm" tone="hero">
        <div className="px-5 py-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">What this cycle means in money</h2>

          {/* The rule, stated — because it is the thing that makes the length
              choice make sense, and it is not obvious. */}
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 text-pretty">
            {potOverride !== null ? (
              <>Using the weekly pot you typed, over {weeksValid ? weeks : "—"} weeks.</>
            ) : (
              <>
                One slot pays out each week, so {weeksValid ? weeks : "—"} weeks means{" "}
                {weeksValid ? weeks : "—"} slots — collected every week, however many members
                fill them.
              </>
            )}
          </p>

          {mainProjection && (
            <div className="mt-3 tabular-nums" data-testid="fee-projection">
              <p className="text-sm text-gray-800 dark:text-gray-200">
                <strong className="text-2xl font-black text-gray-900 dark:text-white">
                  {formatMoney(mainProjection.weeklyPot)}/week
                </strong>
                <span className="ml-2 rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                  {mainProjection.overridden
                    ? "your typed pot"
                    : `${weeks} × ${formatMoney(unitAmount ?? 0)}`}
                </span>
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                {formatMoney(mainProjection.weeklyFee)}/week in fees
              </p>
              <p className="mt-0.5 text-sm text-gray-800 dark:text-gray-200">
                {formatMoney(mainProjection.cycleTotal)} over {weeks} weeks,{" "}
                <strong>{formatMoney(mainProjection.totalFees)}</strong> in fees total.
              </p>
            </div>
          )}

          {/* The length comparison. This is the decision the screen exists to
              support, and the roster version could not show it: because BOTH
              the weekly pot and the number of weeks grow with length, the
              total grows with the square — 30 weeks is 2.25× a 20-week
              cycle, not 1.5×. */}
          {!overrideInvalid && unitAmount !== null && (
            <table className="mt-3 w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr>
                  {["Weeks", "Per week", "Total", "Fees"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-gray-200 dark:border-gray-800 py-1.5 pr-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody data-testid="weeks-comparison">
                {compareWeeks.map((w) => {
                  const p = projectAt(w);
                  if (!p) return null;
                  const isChosen = weeksValid && w === weeks;
                  return (
                    <tr key={w} className={isChosen ? "font-bold text-indigo-800 dark:text-indigo-300" : "text-gray-700 dark:text-gray-300"}>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5 pr-2">
                        {w}
                        {isChosen ? " ←" : ""}
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5 pr-2">
                        {formatMoney(p.weeklyPot)}
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5 pr-2">
                        {formatMoney(p.cycleTotal)}
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5">
                        {formatMoney(p.totalFees)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="mt-3">
            {/* Kept, because reality can differ from the structure — a slot
                left deliberately empty, or a non-standard unit. It is an
                override of a known figure now, not the source of one. */}
            <Field
              label="Override the weekly pot (optional)"
              hint={
                weeksValid && unitAmount !== null
                  ? `Structure says ${formatMoney(weeks * unitAmount)}/week (${weeks} × ${formatMoney(unitAmount)}). Leave empty to use it.`
                  : "Leave empty to use weeks × unit amount."
              }
            >
              <AmountInput
                value={fields.potOverrideDollars}
                onChange={set("potOverrideDollars")}
                ariaLabel="Weekly pot override in dollars"
                placeholder={
                  weeksValid && unitAmount !== null ? String((weeks * unitAmount) / 100) : "20000"
                }
              />
            </Field>
            {overrideInvalid && (
              <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                That isn&apos;t a valid dollar amount.
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
