"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  addLuckyNumber,
  deleteLuckyNumber,
  deletePaymentEvent,
  removeParticipation,
  updateLuckyNumber,
  updateParticipation,
  updatePaymentEvent,
  updatePaymentRow,
} from "@/app/actions/edits";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { AmountInput, Checkbox, NumberInput, Radio, Select } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { Alert, buttonCls, Field, inputCls } from "@/components/ui/primitives";
import {
  commitmentCap,
  finishLine,
  finishPreview,
  parseWeekField,
  storedWeekDates,
  weeksToFinishWithGroup,
} from "@/lib/commitment";
import { formatDateLongUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import { nameConfirmed } from "@/lib/settlement";

type Method = "ZELLE" | "CASH" | "OTHER" | null;

const METHOD_OPTIONS: { value: "" | "ZELLE" | "CASH" | "OTHER"; label: string }[] = [
  { value: "", label: "—" },
  { value: "ZELLE", label: "Zelle" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" },
];

/** The real figures behind a drawn member's terms change (from the server). */
type NeedsSettlement = {
  memberName: string;
  nameEnglishLast: string | null;
  nameAmharic: string;
  cycleName: string;
  feePercent: number;
  oldWeeklyAmount: number;
  oldWeeksCommitted: number;
  oldEntitlementGross: number;
  newEntitlementGross: number;
  newFee: number;
  newEntitlementNet: number;
  alreadyReceived: number;
  /** What is STILL to settle now (total gap minus what earlier edits settled). */
  gap: number;
  /** The whole position against the new terms, before prior settlements. */
  totalGap: number;
  /** Already recognised on the ledger for this cycle (audit H4). */
  priorSettled: number;
  balancingWeeksExact: number;
  balancingWeeksWhole: number;
};

export function ParticipationEditor(props: {
  participation: {
    id: string;
    weeklyAmount: number;
    startWeek: number;
    weeksCommitted: number;
    plannedWeeks: number;
    /** The cycle's week-1 date, ISO — the fallback when a week has no row. */
    cycleStartDate: string;
    /**
     * The cycle's stored week rows. A week row records the day that actually
     * happened, so it WINS over any projection off the start date (2.14, 2.7)
     * — the start date is editable and existing rows are kept deliberately.
     */
    cycleWeeks: { weekNumber: number; date: string }[];
    personName: string;
    cycleName: string;
  };
  luckyNumbers: { id: string; number: number; amount: number }[];
  events: { id: string; amount: number; method: Method; receivedAt: string; notes: string | null }[];
  weeks: {
    paymentId: string;
    weekNumber: number;
    date: string;
    amountPaid: number;
    isDeferred: boolean;
    method: Method;
    paidAt: string | null;
    notes: string | null;
  }[];
  /**
   * Which sections to render. The member page splits this editor across its
   * tabs — participation + lucky numbers live in SETTINGS, the receipt list
   * in RECEIPTS — so each capability appears in exactly one place. Omitted =
   * everything, which is how any other caller gets the whole editor.
   */
  show?: {
    participation?: boolean;
    luckyNumbers?: boolean;
    receipts?: boolean;
    weeks?: boolean;
  };
}) {
  const { participation } = props;
  const show = {
    participation: props.show?.participation ?? true,
    luckyNumbers: props.show?.luckyNumbers ?? true,
    receipts: props.show?.receipts ?? true,
    weeks: props.show?.weeks ?? true,
  };
  const router = useRouter();
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBanner(null);
    setBusy(true);
    try {
      const result = await fn();
      if (!result.ok) setBanner({ kind: "err", text: `Not saved: ${result.error}` });
      else {
        setBanner({ kind: "ok", text: `✓ ${label}` });
        router.refresh();
      }
    } catch {
      setBanner({ kind: "err", text: "Could not reach the server — nothing was confirmed." });
    } finally {
      setBusy(false);
    }
  }

  function ask(spec: ConfirmSpec, label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setConfirm(spec);
    setOnConfirm(() => () => {
      void run(label, fn).finally(() => {
        setConfirm(null);
        setOnConfirm(null);
      });
    });
  }

  // ————— Participation fields —————
  const [weeklyDollars, setWeeklyDollars] = useState(String(participation.weeklyAmount / 100));
  const [startWeek, setStartWeek] = useState(String(participation.startWeek));
  const [weeks, setWeeks] = useState(String(participation.weeksCommitted));
  const [extend, setExtend] = useState(false);

  // ————— 2.22: the organizer never calculates a finish —————
  //
  // Identical to the add-member wizard, through the same pure module: "Finish
  // with the group" is ON by default and KEEPS TRACKING the start week, and
  // the finish week + date are shown live whether the toggle is on or off.
  const [finishWithGroup, setFinishWithGroup] = useState(true);

  function chooseStartWeek(value: string) {
    setStartWeek(value);
    if (!finishWithGroup) return;
    const next = parseWeekField(value);
    if (next === null) return;
    setWeeks(String(weeksToFinishWithGroup(participation.plannedWeeks, next)));
  }

  function toggleFinishWithGroup(on: boolean) {
    setFinishWithGroup(on);
    if (!on) return;
    const from = parseWeekField(startWeek) ?? participation.startWeek;
    setWeeks(String(weeksToFinishWithGroup(participation.plannedWeeks, from)));
  }

  const startWeekNum = parseWeekField(startWeek);
  const weeksNum = parseWeekField(weeks);
  const cycleStart = new Date(participation.cycleStartDate);
  const storedDates = useMemo(
    () => storedWeekDates(participation.cycleWeeks),
    [participation.cycleWeeks],
  );
  const preview = finishPreview({
    cycleStartDate: cycleStart,
    plannedWeeks: participation.plannedWeeks,
    startWeek: startWeekNum,
    weeksCommitted: weeksNum,
    stored: storedDates,
  });
  const cap = commitmentCap({
    plannedWeeks: participation.plannedWeeks,
    startWeek: startWeekNum,
    weeksCommitted: weeksNum,
    extendPastPlannedEnd: extend,
  });

  // ————— The settlement step (2.18 / 2.23): shown when the server refuses
  // a drawn member's terms change until the gap is settled. —————
  const [settlement, setSettlement] = useState<NeedsSettlement | null>(null);
  const [choice, setChoice] = useState<"returned" | "ledger" | "credit" | "decline-credit">("returned");
  const [returnedDollars, setReturnedDollars] = useState("");
  const [typedName, setTypedName] = useState("");

  function baseInput() {
    const cents = parseDollarsToCents(weeklyDollars);
    if (cents === null || cents < 1) {
      setBanner({ kind: "err", text: "Weekly amount is invalid." });
      return null;
    }
    return {
      participationId: participation.id,
      weeklyAmount: cents,
      startWeek: Number.parseInt(startWeek, 10),
      weeksCommitted: Number.parseInt(weeks, 10),
      extendPastPlannedEnd: extend,
    };
  }

  async function submitParticipation(withSettlement?: {
    choice: "returned" | "ledger" | "credit" | "decline-credit";
    returnedAmount?: number;
    typedName: string;
  }) {
    const input = baseInput();
    if (!input) return;
    setBanner(null);
    setBusy(true);
    try {
      const result = await updateParticipation(
        withSettlement ? { ...input, settlement: withSettlement } : input,
      );
      if (result.ok) {
        setSettlement(null);
        setTypedName("");
        setReturnedDollars("");
        setBanner({ kind: "ok", text: "✓ Participation saved — receipts re-allocated." });
        router.refresh();
      } else if ("needsSettlement" in result && result.needsSettlement) {
        setSettlement(result.needsSettlement);
        setChoice(result.needsSettlement.gap > 0 ? "returned" : "credit");
      } else {
        setBanner({ kind: "err", text: `Not saved: ${result.error}` });
      }
    } catch {
      setBanner({ kind: "err", text: "Could not reach the server — nothing was confirmed." });
    } finally {
      setBusy(false);
    }
  }

  function saveParticipation() {
    const input = baseInput();
    if (!input) return;
    setConfirm({
      title: `Save ${participation.personName}'s participation?`,
      destructive: false,
      body: (
        <>
          <p>
            Weekly <strong className="tabular-nums">{formatMoney(input.weeklyAmount)}</strong>, from
            week {input.startWeek} for {input.weeksCommitted} week
            {input.weeksCommitted === 1 ? "" : "s"}.
          </p>
          {/* The SAME sentence the live preview shows — the confirmation must
              never restate a finish in different words (2.22). */}
          {preview !== null && (
            <p>
              <strong>{finishLine(preview, formatDateLongUTC, participation.plannedWeeks)}</strong>
            </p>
          )}
          <p>
            Their receipts re-allocate oldest-first against the new shape and every derived figure
            recalculates immediately. If a receipt no longer fits, NOTHING changes and you see the
            reason. If they have already been drawn and the terms change what they were entitled
            to, a settlement step opens with the real numbers. An audit entry records the change.
          </p>
        </>
      ),
      confirmLabel: "Save participation",
    });
    setOnConfirm(() => () => {
      void submitParticipation().finally(() => {
        setConfirm(null);
        setOnConfirm(null);
      });
    });
  }

  function doRemove() {
    ask(
      {
        title: `Remove ${participation.personName} from ${participation.cycleName}?`,
        body: (
          <>
            <p>
              This DELETES their {props.luckyNumbers.length} lucky number
              {props.luckyNumbers.length === 1 ? "" : "s"}, {props.weeks.length} week row
              {props.weeks.length === 1 ? "" : "s"}, and {props.events.length} receipt
              {props.events.length === 1 ? "" : "s"} totalling{" "}
              <strong className="tabular-nums">
                {formatMoney(props.events.reduce((sum, e) => sum + e.amount, 0))}
              </strong>{" "}
              in this cycle.
            </p>
            <p>
              The person stays in the directory (2.5) and any carried balance survives (2.18). An
              audit entry records everything removed.
            </p>
          </>
        ),
        confirmLabel: "Remove from cycle",
        requirePhrase: props.events.length > 0 ? participation.personName : undefined,
      },
      "Removed from cycle.",
      async () => {
        const result = await removeParticipation({ participationId: participation.id });
        if (result.ok) router.push("/admin/cycle");
        return result;
      },
    );
  }

  // ————— Lucky numbers —————
  const [newNumber, setNewNumber] = useState("");
  const [newAmountDollars, setNewAmountDollars] = useState("");

  const nameOk =
    settlement !== null &&
    nameConfirmed(typedName, {
      nameEnglishFirst: settlement.memberName,
      nameEnglishLast: settlement.nameEnglishLast,
      nameAmharic: settlement.nameAmharic,
    });

  // ————— Render —————
  return (
    <div className="max-w-2xl space-y-8">
      {banner && <Alert kind={banner.kind}>{banner.text}</Alert>}

      <section className={`space-y-3 ${show.participation ? "" : "hidden"}`}>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Participation</h2>
        <div className="flex flex-wrap gap-3">
          <Field label="Weekly amount">
            <AmountInput value={weeklyDollars} onChange={setWeeklyDollars} ariaLabel="Weekly amount in dollars" className="w-28" />
          </Field>
          <Field label="Start week">
            <NumberInput value={startWeek} onChange={chooseStartWeek} min={1} ariaLabel="Start week" className="w-24" />
          </Field>
          <Field
            label="Weeks committed"
            hint={
              finishWithGroup
                ? "Filled from the weeks left in the cycle."
                : "Your own figure. The cap and its override still apply."
            }
          >
            <NumberInput
              value={weeks}
              // Typing a figure IS the override — the organizer never has to
              // find the toggle first (same rule as the add-member wizard).
              onChange={(v) => {
                setFinishWithGroup(false);
                setWeeks(v);
              }}
              min={1}
              ariaLabel="Weeks committed"
              className={`w-24 ${finishWithGroup ? "bg-gray-100 dark:bg-white/5" : ""}`}
            />
          </Field>
        </div>

        {/* 2.22: ON by default, and it KEEPS tracking the start week. */}
        <Checkbox
          checked={finishWithGroup}
          onChange={toggleFinishWithGroup}
          label={
            <span data-testid="finish-with-group-label">
              <strong>Finish with the group</strong> — commit them to the rest of the cycle
              {startWeekNum !== null && cap !== null && (
                <>
                  {" "}
                  ({weeksToFinishWithGroup(participation.plannedWeeks, startWeekNum)} week
                  {weeksToFinishWithGroup(participation.plannedWeeks, startWeekNum) === 1 ? "" : "s"}{" "}
                  from week {startWeekNum})
                </>
              )}
              . Uncheck, or just type a figure, to choose a different length.
            </span>
          }
        />

        {/* THE thing being decided — prominent, live, and shown whether the
            toggle is on or off (the organizer never computes a finish date). */}
        {preview !== null ? (
          <p
            data-testid="finish-preview"
            className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-3 text-base font-bold text-indigo-900 dark:text-indigo-200"
          >
            {finishLine(preview, formatDateLongUTC, participation.plannedWeeks)}
          </p>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
            Enter a start week and a length to see when they finish.
          </p>
        )}

        {cap !== null && cap.exceedsCap && (
          <p className="text-sm font-semibold text-red-800 dark:text-red-400">
            {cap.cap === 0
              ? `The planned ${participation.plannedWeeks} weeks are over — extending past the end needs the override below.`
              : `Only ${cap.cap} week${cap.cap === 1 ? "" : "s"} remain in the cycle (2.22). Use the override below to extend past the planned end.`}
          </p>
        )}

        <Checkbox
          checked={extend}
          onChange={setExtend}
          label={
            <>Allow extending past the planned {participation.plannedWeeks} weeks (2.22 override — creates the extra weeks)</>
          }
        />
        <div className="flex gap-3">
          <button type="button" onClick={saveParticipation} disabled={busy} className={buttonCls.primary}>
            Save participation
          </button>
          <button type="button" onClick={doRemove} disabled={busy} className={buttonCls.danger}>
            Remove from cycle
          </button>
        </div>

        {settlement && (
          <div
            className="space-y-3 rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-gray-900 dark:text-gray-100"
            data-testid="terms-settlement"
          >
            <h3 className="font-black">Settle before saving — {settlement.memberName} has already been drawn</h3>
            <p>
              They received{" "}
              <strong className="tabular-nums">{formatMoney(settlement.alreadyReceived)}</strong>{" "}
              under the old terms ({formatMoney(settlement.oldWeeklyAmount)}/week ×{" "}
              {settlement.oldWeeksCommitted} weeks). At the new terms they are entitled to{" "}
              <strong className="tabular-nums">{formatMoney(settlement.newEntitlementNet)}</strong>{" "}
              ({formatMoney(settlement.newEntitlementGross)} − {formatMoney(settlement.newFee)}{" "}
              fee).{" "}
              {settlement.totalGap > 0 ? (
                <>
                  They hold{" "}
                  <strong className="tabular-nums">{formatMoney(settlement.totalGap)}</strong> too
                  much.
                </>
              ) : settlement.totalGap < 0 ? (
                <>
                  They are owed{" "}
                  <strong className="tabular-nums">{formatMoney(-settlement.totalGap)}</strong> more.
                </>
              ) : (
                <>That matches what they took.</>
              )}
            </p>

            {settlement.priorSettled !== 0 && (
              <p className="rounded-xl bg-white/70 dark:bg-black/20 px-3 py-2">
                An earlier edit already settled{" "}
                <strong className="tabular-nums">
                  {formatMoney(Math.abs(settlement.priorSettled))}
                </strong>{" "}
                of this in {settlement.cycleName} (it is on their carried ledger). Only the{" "}
                difference is settled now:{" "}
                <strong className="tabular-nums">
                  {settlement.gap > 0
                    ? `${formatMoney(settlement.gap)} still to settle`
                    : `${formatMoney(-settlement.gap)} to give back to them`}
                </strong>
                .
              </p>
            )}

            {settlement.gap > 0 ? (
              <div className="space-y-2">
                <Radio
                  checked={choice === "returned"}
                  onSelect={() => setChoice("returned")}
                  name="settle"
                  label="They returned money — enter the amount; any remainder goes to the carried ledger (2.18)"
                />
                {choice === "returned" && (
                  <div className="ml-6">
                    <AmountInput
                      value={returnedDollars}
                      onChange={setReturnedDollars}
                      ariaLabel="Returned amount in dollars"
                      className="w-32"
                      placeholder={String(settlement.gap / 100)}
                    />
                  </div>
                )}
                <Radio
                  checked={choice === "ledger"}
                  onSelect={() => setChoice("ledger")}
                  name="settle"
                  label={`They returned nothing — the whole ${formatMoney(settlement.gap)} becomes a carried ledger debt`}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      // A balancing figure is a deliberate custom length, so it
                      // must release "finish with the group" — otherwise the
                      // next start-week edit would silently overwrite it.
                      setFinishWithGroup(false);
                      setWeeks(String(settlement.balancingWeeksWhole));
                      setSettlement(null);
                      setBanner({
                        kind: "ok",
                        text: `Weeks set to ${settlement.balancingWeeksWhole} — at ${weeklyDollars ? `$${weeklyDollars}` : "the new weekly"} that entitles them to ${
                          Number.isInteger(settlement.balancingWeeksExact)
                            ? "exactly what they took"
                            : "the closest match to what they took"
                        }. Press Save participation again.`,
                      });
                    }}
                    className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}
                  >
                    Adjust weeks instead → {settlement.balancingWeeksWhole} weeks
                    {Number.isInteger(settlement.balancingWeeksExact) ? " (balances exactly)" : " (closest)"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Radio
                  checked={choice === "credit"}
                  onSelect={() => setChoice("credit")}
                  name="settle"
                  label={`Record ${formatMoney(-settlement.gap)} as owed TO them (ledger credit — offsets carried debt)`}
                />
                <Radio
                  checked={choice === "decline-credit"}
                  onSelect={() => setChoice("decline-credit")}
                  name="settle"
                  label="Don't record a credit — the audit entry still keeps the figures"
                />
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Type <strong>{settlement.memberName}</strong> to confirm the settlement
              </span>
              <input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className={inputCls + " max-w-60"}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  busy ||
                  !nameOk ||
                  (choice === "returned" && parseDollarsToCents(returnedDollars) === null)
                }
                onClick={() =>
                  void submitParticipation({
                    choice,
                    returnedAmount:
                      choice === "returned"
                        ? (parseDollarsToCents(returnedDollars) ?? undefined)
                        : undefined,
                    typedName,
                  })
                }
                className={buttonCls.primary}
              >
                Apply settlement and save
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettlement(null);
                  setTypedName("");
                }}
                className={buttonCls.secondary}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={`space-y-3 ${show.luckyNumbers ? "" : "hidden"}`}>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Lucky numbers</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {props.luckyNumbers.map((n) => (
              <LuckyRow key={n.id} n={n} busy={busy} run={run} ask={ask} />
            ))}
          </tbody>
        </table>
        <div className="flex items-end gap-2 text-sm">
          <Field label="New #">
            <NumberInput value={newNumber} onChange={setNewNumber} min={1} ariaLabel="New lucky number" className="w-20" />
          </Field>
          <Field label="Amount">
            <AmountInput value={newAmountDollars} onChange={setNewAmountDollars} ariaLabel="New number amount in dollars" className="w-28" />
          </Field>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const cents = parseDollarsToCents(newAmountDollars);
              if (cents === null || cents < 1) return setBanner({ kind: "err", text: "New number amount is invalid." });
              void run(`Added #${newNumber}.`, () =>
                addLuckyNumber({
                  participationId: participation.id,
                  number: Number.parseInt(newNumber, 10),
                  amount: cents,
                }),
              );
            }}
            className={buttonCls.secondary}
          >
            Add number
          </button>
        </div>
      </section>

      <section className={`space-y-3 ${show.receipts ? "" : "hidden"}`}>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Receipts (payment events)</h2>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Week amounts are derived from receipts — edit or delete a receipt and every week
          recalculates immediately (D-32).
        </p>
        {props.events.length === 0 ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">No receipts recorded.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {props.events.map((event) => (
                <EventRow key={event.id} event={event} busy={busy} run={run} ask={ask} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={`space-y-3 ${show.weeks ? "" : "hidden"}`}>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Weeks</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 dark:border-gray-700 text-left">
              <th className="py-1 pr-3 font-medium text-gray-700 dark:text-gray-300">Week</th>
              <th className="py-1 pr-3 font-medium text-gray-700 dark:text-gray-300">Paid</th>
              <th className="py-1 pr-3 font-medium text-gray-700 dark:text-gray-300">Deferred</th>
              <th className="py-1 font-medium text-gray-700 dark:text-gray-300">Notes</th>
            </tr>
          </thead>
          <tbody>
            {props.weeks.map((w) => (
              <WeekRow key={w.paymentId} w={w} busy={busy} run={run} ask={ask} />
            ))}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </div>
  );
}

type Ask = (
  spec: ConfirmSpec,
  label: string,
  fn: () => Promise<{ ok: boolean; error?: string }>,
) => void;
type Run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;

function LuckyRow({
  n,
  busy,
  run,
  ask,
}: {
  n: { id: string; number: number; amount: number };
  busy: boolean;
  run: Run;
  ask: Ask;
}) {
  const [number, setNumber] = useState(String(n.number));
  const [dollars, setDollars] = useState(String(n.amount / 100));
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <td className="py-1.5 pr-3">
        <span className="mr-1 text-gray-600 dark:text-gray-400">#</span>
        <NumberInput value={number} onChange={setNumber} min={1} ariaLabel={`Lucky number ${n.number}`} className="w-20" />
      </td>
      <td className="py-1.5 pr-3">
        <AmountInput value={dollars} onChange={setDollars} ariaLabel={`Amount for number ${n.number}`} className="w-28" />
      </td>
      <td className="py-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const cents = parseDollarsToCents(dollars);
            if (cents === null) return;
            void run(`#${number} saved.`, () =>
              updateLuckyNumber({ luckyNumberId: n.id, number: Number.parseInt(number, 10), amount: cents }),
            );
          }}
          className={buttonCls.ghost + " mr-1 !px-2.5 !py-1 !text-xs"}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            ask(
              {
                title: `Delete lucky number #${n.number}?`,
                body: (
                  <p>
                    #{n.number} ({formatMoney(n.amount)}/week) disappears from the wheel and any
                    slot it sits in. Blocked with a clear reason if it has payout records. An
                    audit entry records the deletion.
                  </p>
                ),
                confirmLabel: `Delete #${n.number}`,
              },
              `#${n.number} deleted.`,
              () => deleteLuckyNumber({ luckyNumberId: n.id }),
            )
          }
          className={buttonCls.danger + " !px-2.5 !py-1 !text-xs"}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function EventRow({
  event,
  busy,
  run,
  ask,
}: {
  event: { id: string; amount: number; method: Method; receivedAt: string; notes: string | null };
  busy: boolean;
  run: Run;
  ask: Ask;
}) {
  const [dollars, setDollars] = useState(String(event.amount / 100));
  const [method, setMethod] = useState<"" | "ZELLE" | "CASH" | "OTHER">(event.method ?? "");
  const [receivedAt, setReceivedAt] = useState(event.receivedAt.slice(0, 10));
  const [notes, setNotes] = useState(event.notes ?? "");
  const isSettlement = event.notes?.includes("settled from the payout") ?? false;
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800 align-top">
      <td className="py-1.5 pr-2">
        <AmountInput value={dollars} onChange={setDollars} ariaLabel="Receipt amount in dollars" className="w-28" />
      </td>
      <td className="py-1.5 pr-2">
        <Select value={method} onChange={setMethod} ariaLabel="Receipt method" options={METHOD_OPTIONS} disabled={busy} className="w-24" />
      </td>
      <td className="py-1.5 pr-2">
        <DatePicker value={receivedAt} onChange={setReceivedAt} ariaLabel="Received date" />
      </td>
      <td className="py-1.5 pr-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="notes"
          className="w-36 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        {isSettlement && (
          <p className="mt-1 max-w-44 text-[10px] leading-tight text-amber-700 dark:text-amber-500">
            Payout settlement — undone automatically if the draw is undone
          </p>
        )}
      </td>
      <td className="whitespace-nowrap py-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const cents = parseDollarsToCents(dollars);
            if (cents === null || cents < 1) return;
            ask(
              {
                title: `Save this receipt as ${formatMoney(cents)}?`,
                destructive: false,
                body: (
                  <p>
                    All of this member&apos;s weeks recalculate from their receipts immediately.
                    An audit entry records old and new values.
                  </p>
                ),
                confirmLabel: "Save receipt",
              },
              "Receipt saved — weeks recalculated.",
              () =>
                updatePaymentEvent({
                  eventId: event.id,
                  amount: cents,
                  method: method === "" ? null : method,
                  receivedAt: `${receivedAt}T00:00:00.000Z`,
                  notes: notes || undefined,
                }),
            );
          }}
          className={buttonCls.ghost + " mr-1 !px-2.5 !py-1 !text-xs"}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            ask(
              {
                title: `Delete this ${formatMoney(event.amount)} receipt?`,
                body: (
                  <>
                    <p>
                      The money disappears from the member&apos;s record and every week
                      recalculates. An audit entry records the deleted receipt.
                    </p>
                    {isSettlement && (
                      <p className="text-amber-800 dark:text-amber-400">
                        This is a payout settlement — deleting it makes the drawn week owed again
                        while the payout keeps its reduced net. Usually you want &quot;Undo the
                        draw&quot; or &quot;Delete payout&quot; on Collections instead.
                      </p>
                    )}
                  </>
                ),
                confirmLabel: "Delete receipt",
              },
              "Receipt deleted — weeks recalculated.",
              () => deletePaymentEvent({ eventId: event.id }),
            )
          }
          className={buttonCls.danger + " !px-2.5 !py-1 !text-xs"}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function WeekRow({
  w,
  busy,
  run,
  ask,
}: {
  w: {
    paymentId: string;
    weekNumber: number;
    date: string;
    amountPaid: number;
    isDeferred: boolean;
    method: Method;
    paidAt: string | null;
    notes: string | null;
  };
  busy: boolean;
  run: Run;
  ask: Ask;
}) {
  const [isDeferred, setIsDeferred] = useState(w.isDeferred);
  const [notes, setNotes] = useState(w.notes ?? "");
  const dirty = isDeferred !== w.isDeferred || notes !== (w.notes ?? "");
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <td className="py-1.5 pr-3 text-gray-900 dark:text-white">
        {w.weekNumber} <span className="text-gray-500 dark:text-gray-400">({w.date})</span>
      </td>
      <td className="py-1.5 pr-3 tabular-nums text-gray-800 dark:text-gray-200">{formatMoney(w.amountPaid)}</td>
      <td className="py-1.5 pr-3">
        <Checkbox checked={isDeferred} onChange={setIsDeferred} label={<span className="sr-only">Defer week {w.weekNumber}</span>} />
      </td>
      <td className="py-1.5 pr-3">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-36 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-2.5 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
      </td>
      <td className="py-1.5">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => {
            const deferChanged = isDeferred !== w.isDeferred;
            if (!deferChanged) {
              void run(`Week ${w.weekNumber} saved.`, () =>
                updatePaymentRow({ paymentId: w.paymentId, isDeferred, method: w.method, paidAt: w.paidAt, notes: notes || undefined }),
              );
              return;
            }
            ask(
              {
                title: `Save week ${w.weekNumber}?`,
                destructive: false,
                body: (
                  <p>
                    Deferred changes to{" "}
                    <strong>
                      {isDeferred ? "YES — this week is excused, never owed" : "NO — this week is owed again"}
                    </strong>
                    , and the member&apos;s receipts re-allocate immediately.
                  </p>
                ),
                confirmLabel: `Save week ${w.weekNumber}`,
              },
              `Week ${w.weekNumber} saved.`,
              () =>
                updatePaymentRow({ paymentId: w.paymentId, isDeferred, method: w.method, paidAt: w.paidAt, notes: notes || undefined }),
            );
          }}
          className={buttonCls.ghost + " !px-2.5 !py-1 !text-xs"}
        >
          Save
        </button>
      </td>
    </tr>
  );
}
