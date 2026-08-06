"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCycle } from "@/app/actions/cycles";
import { DatePicker } from "@/components/ui/date-picker";
import { AmountInput, NumberInput, Radio } from "@/components/ui/controls";
import { Alert, buttonCls, Card, Field } from "@/components/ui/primitives";
import { cycleFinishPreview, finishLine, parseWeekField } from "@/lib/commitment";
import { formatDateLongUTC, formatDateUTC, formatMoney, parseDateInput, parseDollarsToCents } from "@/lib/format";
import { calculateFee, calculateGross, MAX_MONEY_CENTS, MAX_WEEKS } from "@/lib/money";

const INITIAL = {
  name: "",
  startDate: "",
  plannedWeeks: "20",
  unitDollars: "1000",
  feePercent: "2",
  // A deliberate choice, never an assumption (no preselection).
  numbering: "" as "" | "fresh" | "carryover",
  /** Override for the assumed weekly pot, in dollars; "" = use the baseline. */
  potOverrideDollars: "",
};

export type ProjectionBaseline = {
  cycleName: string;
  members: { id: string; weeklyAmount: number }[];
} | null;

/**
 * Project real money for a candidate weeks count (2.1: never "$0" as an
 * answer). With a roster baseline the fee is exact per member (fees are
 * charged per member payout); with an overridden or typed pot it is the
 * aggregate fee on the pot — labelled approximate.
 */
function project(input: {
  weeks: number;
  feePercent: number;
  baseline: ProjectionBaseline;
  potOverride: number | null;
}): { weeklyPot: number; total: number; fees: number; feesPerWeek: number; exact: boolean } | null {
  const { weeks, feePercent, baseline, potOverride } = input;
  if (!Number.isSafeInteger(weeks) || weeks < 1 || !Number.isFinite(feePercent)) return null;

  if (potOverride === null && baseline && baseline.members.length > 0) {
    let weeklyPot = 0;
    let total = 0;
    let fees = 0;
    for (const m of baseline.members) {
      const gross = calculateGross(m.weeklyAmount, weeks);
      weeklyPot += m.weeklyAmount;
      total += gross;
      fees += calculateFee(gross, feePercent);
    }
    // The organizer checks the figure PER WEEK — that is how he holds it.
    return { weeklyPot, total, fees, feesPerWeek: Math.round(fees / weeks), exact: true };
  }

  const pot = potOverride;
  if (pot === null || pot < 1) return null;
  const total = calculateGross(pot, weeks);
  const fees = calculateFee(total, feePercent);
  return { weeklyPot: pot, total, fees, feesPerWeek: Math.round(fees / weeks), exact: false };
}

export function NewCycleForm({ baseline }: { baseline: ProjectionBaseline }) {
  const router = useRouter();
  const [fields, setFields] = useState(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAsDraft, setSavedAsDraft] = useState<string | null>(null);
  const [savedActive, setSavedActive] = useState(false);

  const dirty = Object.entries(INITIAL).some(
    ([key, value]) => fields[key as keyof typeof INITIAL] !== value,
  );

  const set = (key: keyof typeof INITIAL) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setError(null);
    setSavedAsDraft(null);
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
  const feePercentNum = Number.parseFloat(fields.feePercent || "0");
  const potOverride =
    fields.potOverrideDollars.trim() === ""
      ? null
      : parseDollarsToCents(fields.potOverrideDollars);
  const overrideInvalid = fields.potOverrideDollars.trim() !== "" && potOverride === null;
  const needsTypedPot = (baseline === null || baseline.members.length === 0) && potOverride === null;

  const mainProjection = weeksValid
    ? project({ weeks, feePercent: feePercentNum, baseline, potOverride })
    : null;
  const compareWeeks = [...new Set([20, 25, 30, ...(weeksValid ? [weeks] : [])])].sort(
    (a, b) => a - b,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedAsDraft(null);

    if (!weeksValid) {
      setError(`Planned weeks must be a whole number between 1 and ${MAX_WEEKS}.`);
      return;
    }
    const unitAmount = parseDollarsToCents(fields.unitDollars);
    if (unitAmount === null || unitAmount < 1 || unitAmount > MAX_MONEY_CENTS) {
      setError("Unit amount must be a valid dollar amount.");
      return;
    }
    if (fields.numbering === "") {
      setError("Choose how lucky numbers are assigned — fresh, or carried over.");
      return;
    }
    const feePercent = Number.parseFloat(fields.feePercent);

    setSaving(true);
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
        setError(result.error);
        return;
      }
      if (result.data.status === "ACTIVE") {
        // Show the confirmation, keep the button locked, then land on the
        // cycle page displaying the new cycle.
        setSavedActive(true);
        router.push("/admin/cycle");
        router.refresh();
      } else {
        // Reset to pristine so a second click cannot create a duplicate.
        setFields(INITIAL);
        setSavedAsDraft(result.data.name);
      }
    } catch {
      setError(
        "The save could not be confirmed — check your connection and look at the cycle list before trying again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
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
          <DatePicker value={fields.startDate} onChange={set("startDate")} ariaLabel="Cycle start date" />
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

        {error && <Alert kind="err">Not saved: {error}</Alert>}
        {savedAsDraft && (
          <Alert kind="ok">
            ✓ Saved “{savedAsDraft}” as a draft — another cycle is currently active, so this one
            did not become active.
          </Alert>
        )}
        {savedActive && <Alert kind="ok">✓ Cycle created — opening it now…</Alert>}

        <button type="submit" disabled={!dirty || saving || savedActive} className={buttonCls.primary}>
          {saving ? "Saving…" : "Create cycle"}
        </button>
      </form>

      {/* ————— The money projection ————— */}
      <Card className="w-full max-w-sm" tone="hero">
        <div className="px-5 py-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">What this cycle means in money</h2>

          {baseline && baseline.members.length > 0 && potOverride === null ? (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              If the same {baseline.members.length} members from {baseline.cycleName} join:
            </p>
          ) : needsTypedPot ? (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              No previous cycle to project from — enter the weekly pot you expect below.
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Using your overridden weekly pot (approximate — fees are charged per member).
            </p>
          )}

          {mainProjection && (
            <div className="mt-3 tabular-nums" data-testid="fee-projection">
              {/* The assumed pot is what the whole projection rests on. */}
              <p className="text-sm text-gray-800 dark:text-gray-200">
                <strong className="text-2xl font-black text-gray-900 dark:text-white">
                  {formatMoney(mainProjection.weeklyPot)}/week
                </strong>
                <span className="ml-2 rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                  {potOverride !== null
                    ? "your typed pot"
                    : baseline && baseline.members.length > 0
                      ? `assumed pot — ${baseline.cycleName}`
                      : "assumed pot"}
                </span>
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                {formatMoney(mainProjection.feesPerWeek)}/week in fees
                {mainProjection.exact ? "" : " (approx.)"}
              </p>
              <p className="mt-0.5 text-sm text-gray-800 dark:text-gray-200">
                {formatMoney(mainProjection.total)} over {weeks} weeks,{" "}
                <strong>{formatMoney(mainProjection.fees)}</strong> in fees total.
              </p>
            </div>
          )}

          {/* Comparison so the weeks choice is visible at a glance */}
          {!needsTypedPot && !overrideInvalid && (
            <table className="mt-3 w-full border-collapse text-xs tabular-nums">
              <thead>
                <tr>
                  {["Weeks", "Total", "Fees", "Fees/week"].map((h) => (
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
                  const p = project({ weeks: w, feePercent: feePercentNum, baseline, potOverride });
                  if (!p) return null;
                  const isChosen = weeksValid && w === weeks;
                  return (
                    <tr key={w} className={isChosen ? "font-bold text-indigo-800 dark:text-indigo-300" : "text-gray-700 dark:text-gray-300"}>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5 pr-2">
                        {w}
                        {isChosen ? " ←" : ""}
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5 pr-2">
                        {formatMoney(p.total)}
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5 pr-2">
                        {formatMoney(p.fees)}
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-1.5">
                        {formatMoney(p.feesPerWeek)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="mt-3">
            <Field
              label={
                baseline && baseline.members.length > 0
                  ? "Override the assumed weekly pot (optional)"
                  : "Expected weekly pot"
              }
              hint={
                baseline && baseline.members.length > 0
                  ? `Baseline: ${formatMoney(
                      baseline.members.reduce((s, m) => s + m.weeklyAmount, 0),
                    )}/week from ${baseline.cycleName}. Leave empty to use it.`
                  : "The combined weekly contribution you expect from everyone."
              }
            >
              <AmountInput
                value={fields.potOverrideDollars}
                onChange={set("potOverrideDollars")}
                ariaLabel="Expected weekly pot in dollars"
                placeholder={
                  baseline && baseline.members.length > 0
                    ? (baseline.members.reduce((s, m) => s + m.weeklyAmount, 0) / 100).toString()
                    : "20000"
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
