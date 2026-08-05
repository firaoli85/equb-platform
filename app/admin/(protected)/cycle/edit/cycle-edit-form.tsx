"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateCycle } from "@/app/actions/edits";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { AmountInput, NumberInput } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { buttonCls, Field, inputCls } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney, parseDollarsToCents, parseDateInput } from "@/lib/format";
import { dateOfWeek } from "@/lib/money";
import { cycleProjection, type ProjectionMember } from "@/lib/projection";

export function CycleEditForm({
  cycle,
  members,
}: {
  cycle: {
    id: string;
    name: string;
    startDate: string;
    plannedWeeks: number;
    unitAmount: number;
    feePercent: number;
  };
  members: ProjectionMember[];
}) {
  const router = useRouter();
  const initial = {
    name: cycle.name,
    startDate: cycle.startDate,
    plannedWeeks: String(cycle.plannedWeeks),
    unitDollars: String(cycle.unitAmount / 100),
    feePercent: String(cycle.feePercent),
  };
  const [fields, setFields] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const set = (key: keyof typeof initial) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setMsg(null);
  };
  const setValue = (key: keyof typeof initial) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setMsg(null);
  };

  // Live figures (2.1: real money, not percentages; dates compute themselves).
  const liveFee = Number.parseFloat(fields.feePercent);
  const projection =
    Number.isFinite(liveFee) && liveFee >= 0
      ? cycleProjection({ members, feePercent: liveFee })
      : null;
  const liveStart = parseDateInput(fields.startDate);
  const liveWeeks = Number.parseInt(fields.plannedWeeks, 10);
  const span =
    liveStart && Number.isSafeInteger(liveWeeks) && liveWeeks >= 1 && liveWeeks <= 1000
      ? `${formatDateUTC(liveStart)} to ${formatDateUTC(dateOfWeek(liveStart, liveWeeks))}, ${liveWeeks} week${liveWeeks === 1 ? "" : "s"}`
      : null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    const unitAmount = parseDollarsToCents(fields.unitDollars);
    if (unitAmount === null || unitAmount < 1) {
      return setMsg({ kind: "err", text: "Unit amount must be a valid dollar amount." });
    }
    const plannedWeeks = Number.parseInt(fields.plannedWeeks, 10);
    const weeksChanged = plannedWeeks !== cycle.plannedWeeks;
    const dateChanged = fields.startDate !== cycle.startDate;
    setConfirm({
      title: "Save cycle changes?",
      destructive: false,
      body: (
        <>
          {weeksChanged &&
            (plannedWeeks > cycle.plannedWeeks ? (
              <p>
                Planned weeks grows {cycle.plannedWeeks} → {plannedWeeks}: the new weeks are
                created.
              </p>
            ) : (
              <p>
                Planned weeks shrinks {cycle.plannedWeeks} → {plannedWeeks}: the removed weeks
                are deleted — blocked with a clear reason if they carry any payments, draws, or
                member commitments.
              </p>
            ))}
          {dateChanged && (
            <p>
              Start date changes: existing week dates are KEPT as historical facts; only the
              current-week calculation shifts.
            </p>
          )}
          <p>An audit entry records old and new values, and every derived figure recalculates.</p>
        </>
      ),
      confirmLabel: "Save cycle",
    });
  }

  async function doSave() {
    const unitAmount = parseDollarsToCents(fields.unitDollars)!;
    const plannedWeeks = Number.parseInt(fields.plannedWeeks, 10);
    setBusy(true);
    setMsg(null);
    try {
      const result = await updateCycle({
        cycleId: cycle.id,
        name: fields.name,
        startDate: fields.startDate,
        plannedWeeks,
        unitAmount,
        feePercent: Number.parseFloat(fields.feePercent),
      });
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
    <form onSubmit={save} className="max-w-md space-y-4">
      <Field label="Name">
        <input value={fields.name} onChange={set("name")} className={inputCls} />
      </Field>
      <Field label="Start date">
        <DatePicker value={fields.startDate} onChange={setValue("startDate")} ariaLabel="Cycle start date" />
      </Field>
      <Field label="Planned weeks">
        <NumberInput value={fields.plannedWeeks} onChange={setValue("plannedWeeks")} min={1} ariaLabel="Planned weeks" className="w-full" />
      </Field>
      <Field label="Unit amount">
        <AmountInput value={fields.unitDollars} onChange={setValue("unitDollars")} ariaLabel="Unit amount in dollars" className="w-full" />
      </Field>
      <Field label="Fee percent">
        <NumberInput value={fields.feePercent} onChange={setValue("feePercent")} min={0} max={100} step={0.1} ariaLabel="Fee percent" className="w-full" />
      </Field>

      {span && (
        <p className="rounded bg-gray-100 px-3 py-2 text-sm" data-testid="cycle-span">
          {span}
        </p>
      )}

      {projection && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 p-3 text-sm tabular-nums">
          {/* Per week first — that is how the organizer checks the figure. */}
          <p className="text-gray-900 dark:text-white">
            <strong className="text-lg font-black">{formatMoney(projection.weeklyPot)}/week</strong>
            <span className="text-gray-600 dark:text-gray-400"> assumed pot · </span>
            <strong>{formatMoney(projection.weeklyFee)}/week in fees</strong> at {fields.feePercent}%
          </p>
          <p className="mt-1 text-gray-700 dark:text-gray-300">
            Approximately {formatMoney(projection.totalFees)} in fees over this cycle (
            {members.length} member{members.length === 1 ? "" : "s"}) · total gross{" "}
            {formatMoney(projection.totalGross)} · total net {formatMoney(projection.totalNet)}
          </p>
        </div>
      )}

      {msg && (
        <p
          role={msg.kind === "err" ? "alert" : "status"}
          className={`rounded border px-3 py-2 text-sm ${msg.kind === "err" ? "border-red-400 bg-red-50 text-red-800" : "border-green-500 bg-green-50 text-green-900"}`}
        >
          {msg.text}
        </p>
      )}

      <button type="submit" disabled={!dirty || busy} className={buttonCls.primary}>
        {busy ? "Saving…" : "Save cycle"}
      </button>

      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => void doSave()}
        onCancel={() => setConfirm(null)}
      />

      {projection && projection.perMember.length > 0 && (
        <section className="pt-4">
          <h2 className="mb-2 text-base font-semibold">Each member at {fields.feePercent}%</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th className="py-1 pr-3 font-medium">Member</th>
                <th className="py-1 pr-3 font-medium">Gross</th>
                <th className="py-1 pr-3 font-medium">Fee</th>
                <th className="py-1 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {projection.perMember.map((m) => (
                <tr key={m.id} className="border-b border-gray-200">
                  <td className="py-1 pr-3">{m.name}</td>
                  <td className="py-1 pr-3">{formatMoney(m.gross)}</td>
                  <td className="py-1 pr-3">{formatMoney(m.fee)}</td>
                  <td className="py-1">{formatMoney(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </form>
  );
}
