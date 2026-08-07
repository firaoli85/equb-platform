"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  addNewPersonToCycle,
  addToCycle,
  type SavedParticipation,
} from "@/app/actions/participations";
import { recordCarryDecision } from "@/app/actions/ledger";
import { NumberConflictPanel } from "@/components/admin/number-conflict-panel";
import { Radio } from "@/components/ui/controls";
import {
  commitmentCap,
  finishLine,
  finishPreview,
  parseWeekField,
  resolveWeekDate,
  storedWeekDates,
  weeksToFinishWithGroup,
} from "@/lib/commitment";
import { formatDateLongUTC, formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import {
  chooseAutoNumbers,
  validateManualNumbers,
  type NumberConflict,
} from "@/lib/lucky-numbers";
import {
  calculateFee,
  calculateFinishWeek,
  calculateGross,
  calculateNet,
  MAX_MONEY_CENTS,
  MAX_WEEKS,
  splitIntoLuckyNumbers,
} from "@/lib/money";

type WizardCycle = {
  id: string;
  name: string;
  plannedWeeks: number;
  unitAmount: number;
  feePercent: number;
};

type WizardPerson = {
  id: string;
  nameAmharic: string;
  nameEnglishFirst: string;
  nameEnglishLast: string | null;
  phone: string | null;
  inActiveCycle: boolean;
  /** Cents still carried from earlier cycles (2.18). */
  carriedBalance: number;
  /** Where that balance came from — the DEBT entries descriptions. */
  carriedFrom: string[];
};

/**
 * What the organizer decides to do about a carried balance when adding
 * someone to a NEW cycle. There is no default and no silent behaviour: the
 * balance is SURFACED and one of these is chosen every time (2.18).
 */
type CarryChoice = "leave" | "deduct" | "settle-now";

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export function AddMemberWizard({
  cycle,
  currentWeek,
  people,
  startDateISO,
  cycleWeeks,
  takenNumbers,
  numberingMode,
  prevNumbersByPerson,
}: {
  cycle: WizardCycle;
  currentWeek: number;
  people: WizardPerson[];
  startDateISO: string;
  /**
   * The cycle's stored week rows. A week row is the day that ACTUALLY
   * happened, so it wins over any projection off the start date (2.14, 2.7).
   */
  cycleWeeks: { weekNumber: number; date: string }[];
  takenNumbers: number[];
  numberingMode: "fresh" | "carryover";
  prevNumbersByPerson: Record<string, number[]>;
}) {
  const router = useRouter();

  const defaultStartWeek = Math.max(1, currentWeek);
  // 2.22 / D-31: the default (and the cap) is the remaining weeks — a late
  // joiner finishes with everyone else unless the organizer overrides.
  const defaultWeeksCommitted = weeksToFinishWithGroup(cycle.plannedWeeks, defaultStartWeek);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [saved, setSaved] = useState<SavedParticipation | null>(null);

  // Step 1 — who
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState({
    nameAmharic: "",
    nameEnglishFirst: "",
    nameEnglishLast: "",
    phone: "",
  });

  // Step 2 — weekly contribution + lucky numbers
  const [weeklyDollars, setWeeklyDollars] = useState("");
  const [manualNumbers, setManualNumbers] = useState(false);
  const [numberInputs, setNumberInputs] = useState<string[]>([]);

  // Step 3 — how long
  const [startWeekStr, setStartWeekStr] = useState(String(defaultStartWeek));
  const [weeksStr, setWeeksStr] = useState(String(defaultWeeksCommitted));
  const [extendPastEnd, setExtendPastEnd] = useState(false);
  // "Finish with the group" (2.22 / D-31), ON by default: weeks committed
  // TRACKS the start week so a late joiner always lands on the cycle's last
  // week — the organizer never does the arithmetic. Turning it off (or typing
  // a weeks figure) hands control back; the cap and its override are unchanged.
  const [finishWithGroup, setFinishWithGroup] = useState(true);
  // 2.18: never silently carry, deduct or ignore. Null until chosen.
  const [carryChoice, setCarryChoice] = useState<CarryChoice | null>(null);

  function chooseStartWeek(value: string) {
    setStartWeekStr(value);
    if (!finishWithGroup) return;
    const next = parseWeekField(value);
    if (next === null) return;
    setWeeksStr(String(weeksToFinishWithGroup(cycle.plannedWeeks, next)));
  }

  function toggleFinishWithGroup(on: boolean) {
    setFinishWithGroup(on);
    if (!on) return;
    const from = parseWeekField(startWeekStr) ?? defaultStartWeek;
    setWeeksStr(String(weeksToFinishWithGroup(cycle.plannedWeeks, from)));
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A typed number already in use: the server hands back WHO holds it and what
  // is free, and this panel turns that into the two real options. Nothing is
  // applied until one of them is pressed.
  const [conflict, setConflict] = useState<NumberConflict | null>(null);

  const selectedPerson = people.find((p) => p.id === personId) ?? null;
  const displayName =
    mode === "existing"
      ? selectedPerson
        ? `${selectedPerson.nameEnglishFirst} ${selectedPerson.nameEnglishLast ?? ""}`.trim()
        : ""
      : `${newPerson.nameEnglishFirst} ${newPerson.nameEnglishLast}`.trim();

  const filtered = people.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.nameAmharic, p.nameEnglishFirst, p.nameEnglishLast ?? "", p.phone ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  // Guarded parse: a typed amount must never crash or freeze the render.
  const parsedWeekly = parseDollarsToCents(weeklyDollars);
  let weeklyAmount: number | null = null;
  let luckyAmounts: number[] | null = null;
  let weeklyError: string | null = null;
  if (parsedWeekly !== null && parsedWeekly >= 1) {
    if (parsedWeekly > MAX_MONEY_CENTS) {
      weeklyError = "That amount is too large.";
    } else {
      try {
        luckyAmounts = splitIntoLuckyNumbers(parsedWeekly, cycle.unitAmount);
        weeklyAmount = parsedWeekly;
      } catch {
        weeklyError =
          "This splits into too many lucky numbers — raise the cycle's unit amount or lower the contribution.";
      }
    }
  }

  // Lucky numbers: auto by default (with carry-over when the cycle says so),
  // full manual control always (2.23) — validated immediately, before saving.
  const takenSet = new Set(takenNumbers);
  const preferred =
    numberingMode === "carryover" && mode === "existing" && personId
      ? prevNumbersByPerson[personId]
      : undefined;
  const autoNumbers = luckyAmounts
    ? chooseAutoNumbers({ count: luckyAmounts.length, taken: takenSet, preferred })
    : null;
  const carriedOver =
    autoNumbers !== null &&
    preferred !== undefined &&
    autoNumbers.length === preferred.length &&
    autoNumbers.every((n, i) => n === preferred[i]);
  const parsedManual = luckyAmounts
    ? luckyAmounts.map((_, i) => Number.parseInt(numberInputs[i] ?? "", 10))
    : [];
  const manualError =
    manualNumbers && luckyAmounts
      ? parsedManual.some((n) => Number.isNaN(n))
        ? `Enter ${luckyAmounts.length === 1 ? "the number" : `all ${luckyAmounts.length} numbers`}.`
        : validateManualNumbers({
            numbers: parsedManual,
            requiredCount: luckyAmounts.length,
            taken: takenSet,
          })
      : null;
  const chosenNumbers = manualNumbers ? parsedManual : (autoNumbers ?? []);

  const storedDates = useMemo(() => storedWeekDates(cycleWeeks), [cycleWeeks]);

  const startWeek = Number.parseInt(startWeekStr, 10);
  const weeksCommitted = Number.parseInt(weeksStr, 10);
  const startWeekValid =
    Number.isSafeInteger(startWeek) && startWeek >= 1 && startWeek <= MAX_WEEKS;
  const weeksInRange =
    Number.isSafeInteger(weeksCommitted) && weeksCommitted >= 1 && weeksCommitted <= MAX_WEEKS;
  // 2.22 / D-31: without the override, the commitment may not pass the
  // planned end. Same pure helper the participation editor uses.
  const capInfo = commitmentCap({
    plannedWeeks: cycle.plannedWeeks,
    startWeek: startWeekValid ? startWeek : null,
    weeksCommitted: weeksInRange ? weeksCommitted : null,
    extendPastPlannedEnd: extendPastEnd,
  });
  const weeksCap = capInfo?.cap ?? null;
  const exceedsCap = capInfo?.exceedsCap ?? false;
  const weeksValid = weeksInRange && !exceedsCap;
  // The finish is shown whenever BOTH fields parse — including while the
  // figure exceeds the cap. The organizer is deciding whether to override,
  // and that decision needs the date in front of them, not hidden.
  const preview = finishPreview({
    cycleStartDate: new Date(startDateISO),
    stored: storedDates,
    plannedWeeks: cycle.plannedWeeks,
    startWeek: startWeekValid ? startWeek : null,
    weeksCommitted: weeksInRange ? weeksCommitted : null,
  });
  const finishWeek = preview?.finishWeek ?? null;
  const finishDate = preview?.finishDate ?? null;

  const carried = mode === "existing" ? (selectedPerson?.carriedBalance ?? 0) : 0;
  const step1Valid =
    mode === "existing"
      ? selectedPerson !== null &&
        !selectedPerson.inActiveCycle &&
        // 2.18: a carried balance must be DECIDED, not stepped past.
        (carried === 0 || carryChoice !== null)
      : newPerson.nameAmharic.trim() !== "" && newPerson.nameEnglishFirst.trim() !== "";
  const step2Valid = luckyAmounts !== null && (!manualNumbers || manualError === null);
  const step3Valid = startWeekValid && weeksValid;

  const gross = step2Valid && step3Valid ? calculateGross(weeklyAmount!, weeksCommitted) : null;
  const fee = gross !== null ? calculateFee(gross, cycle.feePercent) : null;
  const net = gross !== null && fee !== null ? calculateNet(gross, fee) : null;

  function goToStep(next: 1 | 2 | 3 | 4) {
    setError(null);
    setStep(next);
  }

  async function handleSave(onConflict?: "replace") {
    if (!step1Valid || !step2Valid || !step3Valid) return;
    setError(null);
    setSaving(true);
    try {
      const common = {
        cycleId: cycle.id,
        weeklyAmount: weeklyAmount!,
        startWeek,
        weeksCommitted,
        extendPastPlannedEnd: extendPastEnd,
        numbers: manualNumbers ? parsedManual : undefined,
        // Absent unless the organizer has pressed REPLACE on the panel below.
        onConflict,
      };
      const result =
        mode === "existing"
          ? await addToCycle({ ...common, personId: personId! })
          : await addNewPersonToCycle({
              ...common,
              nameAmharic: newPerson.nameAmharic,
              nameEnglishFirst: newPerson.nameEnglishFirst,
              nameEnglishLast: newPerson.nameEnglishLast || undefined,
              phone: newPerson.phone || undefined,
            });
      if (!result.ok) {
        // A NUMBER ALREADY IN USE IS A CHOICE, NOT A DEAD END. The server hands
        // back who holds it, whether it can be taken, and which number is
        // free; the panel turns that into the two real options.
        if ("conflict" in result && result.conflict) {
          setConflict(result.conflict);
          return;
        }
        setError(result.error);
        return;
      }
      setConflict(null);
      // 2.18: the decision about their carried balance goes into the record.
      // Nothing about the balance changes — "deduct" is an intention, and the
      // deduction itself is still OFFERED at payout time, never automatic.
      if (mode === "existing" && selectedPerson && carried > 0 && carryChoice) {
        await recordCarryDecision({
          personId: selectedPerson.id,
          // D-2: the intention is stored against THIS participation, so it
          // resurfaces as a pre-ticked offer when they are paid out.
          participationId: result.data!.id,
          cycleName: cycle.name,
          choice: carryChoice,
          balance: carried,
        });
      }
      setSaved(result.data!);
      router.refresh();
    } catch {
      setError(
        "The save could not be confirmed — check your connection and look at the cycle page before trying again.",
      );
    } finally {
      setSaving(false);
    }
  }

  // ————— Success screen: unmistakable confirmation (2.10) —————
  if (saved) {
    return (
      <div
        role="status"
        className="max-w-lg rounded border border-green-600 bg-green-50 p-4 text-green-900"
        data-testid="save-success"
      >
        <p className="text-lg font-semibold">✓ Saved</p>
        <p className="mt-2 text-sm">
          {saved.person.nameEnglishFirst} {saved.person.nameEnglishLast ?? ""} is in {cycle.name}:{" "}
          {formatMoney(saved.weeklyAmount)}/week, weeks {saved.startWeek} to{" "}
          {calculateFinishWeek(saved.startWeek, saved.weeksCommitted)} —{" "}
          {(() => {
            const r = resolveWeekDate({
              weekNumber: calculateFinishWeek(saved.startWeek, saved.weeksCommitted),
              stored: storedDates,
              cycleStartDate: new Date(startDateISO),
            });
            return r === null ? "" : formatDateLongUTC(r.date);
          })()}
          .
        </p>
        <p className="mt-1 text-sm">
          Lucky number{saved.luckyNumbers.length === 1 ? "" : "s"}:{" "}
          {saved.luckyNumbers.map((n) => `#${n.number} (${formatMoney(n.amount)})`).join(", ")}
        </p>
        <div className="mt-4 flex gap-4 text-sm">
          <button
            type="button"
            onClick={() => router.push("/admin/cycle")}
            className="rounded bg-black px-4 py-2 font-medium text-white"
          >
            Back to cycle
          </button>
          <button
            type="button"
            onClick={() => {
              setSaved(null);
              setStep(1);
              setMode("existing");
              setPersonId(null);
              setSearch("");
              setNewPerson({ nameAmharic: "", nameEnglishFirst: "", nameEnglishLast: "", phone: "" });
              setWeeklyDollars("");
              setStartWeekStr(String(defaultStartWeek));
              setWeeksStr(String(defaultWeeksCommitted));
              setExtendPastEnd(false);
              setManualNumbers(false);
              setNumberInputs([]);
            }}
            className="rounded border border-gray-400 px-4 py-2 font-medium"
          >
            Add another member
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <ol className="flex gap-2 text-xs text-gray-600 dark:text-gray-400">
        {["Who", "Contribution", "How long", "Confirm"].map((label, i) => (
          <li
            key={label}
            className={`rounded px-2 py-1 ${step === i + 1 ? "bg-black text-white" : "bg-gray-100 dark:bg-white/10"}`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {/* ————— Step 1: Who? ————— */}
      {step === 1 && (
        <section className="space-y-4">
          <div className="flex gap-4 text-sm">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={`rounded border px-3 py-1.5 ${mode === "existing" ? "border-black font-medium" : "border-gray-300 dark:border-gray-700"}`}
            >
              From the directory
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("new");
                setPersonId(null);
              }}
              className={`rounded border px-3 py-1.5 ${mode === "new" ? "border-black font-medium" : "border-gray-300 dark:border-gray-700"}`}
            >
              Add someone new
            </button>
          </div>

          {mode === "existing" ? (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone"
                className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
              />
              {filtered.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  No one matches. Use “Add someone new” instead.
                </p>
              ) : (
                <ul className="max-h-72 divide-y divide-gray-200 overflow-y-auto rounded border border-gray-300 dark:border-gray-700">
                  {filtered.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={p.inActiveCycle}
                        onClick={() => setPersonId(p.id)}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                          personId === p.id ? "bg-gray-900 text-white" : ""
                        } ${p.inActiveCycle ? "cursor-not-allowed text-gray-600 dark:text-gray-400" : "hover:bg-gray-100 dark:bg-white/10"}`}
                      >
                        <span>
                          {p.nameAmharic} — {p.nameEnglishFirst} {p.nameEnglishLast ?? ""}
                        </span>
                        {p.inActiveCycle && <span className="text-xs">already in this cycle</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="space-y-3">
              {(
                [
                  ["nameAmharic", "Amharic name *"],
                  ["nameEnglishFirst", "English first name *"],
                  ["nameEnglishLast", "English last name"],
                  ["phone", "Phone"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-sm font-medium">{label}</span>
                  <input
                    type="text"
                    value={newPerson[key]}
                    onChange={(e) => setNewPerson((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded border border-gray-400 px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
          )}

          {/* 2.18: THE CARRIED BALANCE, SURFACED. Never silently carried,
              deducted or ignored — the organizer decides every time. */}
          {carried > 0 && selectedPerson && (
            <div
              className="space-y-3 rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4"
              data-testid="carried-balance-choice"
            >
              <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                {selectedPerson.nameEnglishFirst} carries {formatMoney(carried)} outstanding
                {selectedPerson.carriedFrom.length > 0 &&
                  ` from ${selectedPerson.carriedFrom.join(", ")}`}
                .
              </p>
              <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
                Nothing happens to it automatically. Choose what to do — you can change it
                later on their page.
              </p>
              <div className="space-y-1.5">
                <Radio
                  checked={carryChoice === "leave"}
                  onSelect={() => setCarryChoice("leave")}
                  name="carry"
                  label="Leave it on the ledger — add them normally, the balance stays as it is"
                />
                <Radio
                  checked={carryChoice === "deduct"}
                  onSelect={() => setCarryChoice("deduct")}
                  name="carry"
                  label="Deduct it from their payout in this cycle — recorded as an intention and OFFERED when they are paid out, never applied automatically (D-23)"
                />
                <Radio
                  checked={carryChoice === "settle-now"}
                  onSelect={() => setCarryChoice("settle-now")}
                  name="carry"
                  label="Settle it now — I will record a payment or write it off on their page first"
                />
              </div>
              {carryChoice === "settle-now" && (
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  Open{" "}
                  <a
                    href={`/admin/people/${selectedPerson.id}?tab=payout`}
                    className="underline"
                  >
                    {selectedPerson.nameEnglishFirst}&apos;s carried balance
                  </a>{" "}
                  to record it, then come back. Adding them here settles nothing.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={!step1Valid}
            onClick={() => goToStep(2)}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Continue
          </button>
          {carried > 0 && carryChoice === null && (
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Choose what happens to the {formatMoney(carried)} before continuing.
            </p>
          )}
        </section>
      )}

      {/* ————— Step 2: Weekly contribution ————— */}
      {step === 2 && (
        <section className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Weekly contribution for {displayName || "this member"} (dollars)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={weeklyDollars}
              onChange={(e) => setWeeklyDollars(e.target.value)}
              placeholder="1250"
              autoFocus
              className="w-full rounded border border-gray-400 px-3 py-2"
            />
          </label>

          {luckyAmounts && (
            <p className="rounded bg-gray-100 dark:bg-white/10 px-3 py-2 text-sm" data-testid="lucky-preview">
              {formatMoney(weeklyAmount!)} becomes {countWord(luckyAmounts.length)} number
              {luckyAmounts.length === 1 ? "" : "s"}:{" "}
              {luckyAmounts.map((a) => formatMoney(a)).join(" and ")}
            </p>
          )}
          {weeklyDollars.trim() !== "" && !luckyAmounts && (
            <p className="text-sm text-red-800 dark:text-red-400">{weeklyError ?? "Enter a valid dollar amount."}</p>
          )}

          {luckyAmounts && !manualNumbers && autoNumbers && (
            <p className="rounded bg-gray-100 dark:bg-white/10 px-3 py-2 text-sm" data-testid="auto-numbers">
              Numbers: {autoNumbers.map((n) => `#${n}`).join(" and ")} (automatic
              {carriedOver ? " — carried over from their previous cycle" : ""})
            </p>
          )}

          {luckyAmounts && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={manualNumbers}
                onChange={(e) => setManualNumbers(e.target.checked)}
                className="mt-0.5"
              />
              <span>Pick the number{luckyAmounts.length === 1 ? "" : "s"} myself</span>
            </label>
          )}

          {luckyAmounts && manualNumbers && (
            <div className="space-y-2">
              <div className="flex gap-2">
                {luckyAmounts.map((amount, i) => (
                  <label key={i} className="text-sm">
                    <span className="mb-1 block text-gray-600 dark:text-gray-400">
                      #{i + 1} ({formatMoney(amount)})
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={numberInputs[i] ?? ""}
                      onChange={(e) => {
                        const next = [...numberInputs];
                        next[i] = e.target.value;
                        setNumberInputs(next);
                        // Editing the number answers the conflict by itself.
                        setConflict(null);
                      }}
                      className="w-24 rounded border border-gray-400 px-2 py-1"
                    />
                  </label>
                ))}
              </div>
              {manualError && (
                <p role="alert" className="text-sm text-red-800 dark:text-red-400" data-testid="manual-number-error">
                  {manualError}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => goToStep(1)} className="rounded border border-gray-400 px-4 py-2 text-sm">
              Back
            </button>
            <button
              type="button"
              disabled={!step2Valid}
              onClick={() => goToStep(3)}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ————— Step 3: How long? ————— */}
      {step === 3 && (
        <section className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Start week</span>
            <input
              type="number"
              min={1}
              value={startWeekStr}
              onChange={(e) => chooseStartWeek(e.target.value)}
              className="w-full rounded border border-gray-400 px-3 py-2"
            />
            {!startWeekValid && startWeekStr.trim() !== "" && (
              <span className="mt-1 block text-sm text-red-800 dark:text-red-400">
                {Number.isSafeInteger(startWeek) && startWeek > MAX_WEEKS
                  ? `Start week must be at most ${MAX_WEEKS}.`
                  : "Start week can never be before week 1."}
              </span>
            )}
          </label>

          {/* Finish with the group — ON by default, and it KEEPS tracking the
              start week rather than being a one-time default. */}
          <label className="flex items-start gap-2 text-sm" data-testid="finish-with-group">
            <input
              type="checkbox"
              checked={finishWithGroup}
              onChange={(e) => toggleFinishWithGroup(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Finish with the group</strong> — commit them to the rest of the cycle
              {finishWithGroup && weeksCap !== null && startWeekValid && (
                <>
                  {" "}
                  ({weeksCap} week{weeksCap === 1 ? "" : "s"} from week {startWeek})
                </>
              )}
              . Uncheck to choose a different length.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Weeks committed</span>
            <input
              type="number"
              min={1}
              max={extendPastEnd ? MAX_WEEKS : (weeksCap ?? undefined)}
              value={weeksStr}
              // NOT readOnly: the onChange below treats typing as the override
              // itself, and readOnly made that impossible — the organizer had
              // to find the checkbox first. Same behaviour as the
              // participation editor now.
              onChange={(e) => {
                // Typing a figure is itself the override — no need to hunt for
                // the checkbox first.
                setFinishWithGroup(false);
                setWeeksStr(e.target.value);
              }}
              className={`w-full rounded border border-gray-400 px-3 py-2 ${
                finishWithGroup ? "bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300" : ""
              }`}
            />
            <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
              {finishWithGroup
                ? "Filled from the remaining weeks in the cycle — they finish with everyone else."
                : "Your own figure. The cap and its override below still apply."}
            </span>
            {weeksStr.trim() !== "" && exceedsCap && (
              <span className="mt-1 block text-sm text-red-800 dark:text-red-400">
                {weeksCap === 0
                  ? "The planned weeks are over — extending past the end requires the override below."
                  : `Only ${weeksCap} week${weeksCap === 1 ? "" : "s"} remain in the cycle. Use the override below to extend past the planned end.`}
              </span>
            )}
            {weeksStr.trim() !== "" && !weeksInRange && (
              <span className="mt-1 block text-sm text-red-800 dark:text-red-400">
                Weeks committed must be between 1 and {MAX_WEEKS}.
              </span>
            )}
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={extendPastEnd}
              onChange={(e) => setExtendPastEnd(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Extend past the planned end (organizer override) — the cycle will actually run
              longer than its {cycle.plannedWeeks} planned weeks, and the extra weeks are
              created.
            </span>
          </label>

          {preview !== null ? (
            <p
              className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-3 text-base font-bold text-indigo-900 dark:text-indigo-200"
              data-testid="finish-preview"
            >
              {finishLine(preview, formatDateLongUTC, cycle.plannedWeeks)}
            </p>
          ) : (
            <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
              Enter a start week and a length to see when they finish.
            </p>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => goToStep(2)} className="rounded border border-gray-400 px-4 py-2 text-sm">
              Back
            </button>
            <button
              type="button"
              disabled={!step3Valid}
              onClick={() => goToStep(4)}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ————— Step 4: Confirm ————— */}
      {step === 4 && (
        <section className="space-y-4">
          <p className="rounded bg-gray-100 dark:bg-white/10 px-3 py-3 text-sm" data-testid="confirm-summary">
            {displayName}, {formatMoney(weeklyAmount!)}/week, from week {startWeek} for{" "}
            {weeksCommitted} week{weeksCommitted === 1 ? "" : "s"}.
            <br />
            {preview !== null && (
              <strong>{finishLine(preview, formatDateLongUTC, cycle.plannedWeeks)}</strong>
            )}
            <br />
            Lucky number{chosenNumbers.length === 1 ? "" : "s"}:{" "}
            {chosenNumbers.map((n) => `#${n}`).join(", ")}
            {manualNumbers ? " (chosen by you)" : carriedOver ? " (carried over)" : " (automatic)"}.
            <br />
            Receives {formatMoney(gross!)} minus {formatMoney(fee!)} fee ={" "}
            <strong>{formatMoney(net!)}</strong>.
          </p>

          {error && (
            <p role="alert" className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800 dark:text-red-400">
              Not saved: {error}
            </p>
          )}

          {/* A number already in use is a choice, not a dead end — the same
              panel the member profile shows, from the same server reply. */}
          {conflict && (
            <NumberConflictPanel
              conflict={conflict}
              busy={saving}
              onReplace={() => void handleSave("replace")}
              onKeep={(suggested) => {
                // Write the free number into the field it clashed on, so the
                // organizer sees exactly what they are about to save.
                const at = parsedManual.findIndex((n) => n === conflict.number);
                if (at >= 0) {
                  const next = [...numberInputs];
                  next[at] = String(suggested);
                  setNumberInputs(next);
                }
                setConflict(null);
              }}
              onDismiss={() => setConflict(null)}
            />
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => goToStep(3)} className="rounded border border-gray-400 px-4 py-2 text-sm">
              Back
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
