"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addNewPersonToCycle,
  addToCycle,
  type SavedParticipation,
} from "@/app/actions/participations";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import { chooseAutoNumbers, validateManualNumbers } from "@/lib/lucky-numbers";
import {
  calculateFee,
  calculateFinishWeek,
  calculateGross,
  calculateNet,
  dateOfWeek,
  MAX_MONEY_CENTS,
  MAX_WEEKS,
  remainingWeeksInCycle,
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
};

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export function AddMemberWizard({
  cycle,
  currentWeek,
  people,
  startDateISO,
  takenNumbers,
  numberingMode,
  prevNumbersByPerson,
}: {
  cycle: WizardCycle;
  currentWeek: number;
  people: WizardPerson[];
  startDateISO: string;
  takenNumbers: number[];
  numberingMode: "fresh" | "carryover";
  prevNumbersByPerson: Record<string, number[]>;
}) {
  const router = useRouter();

  const defaultStartWeek = Math.max(1, currentWeek);
  // 2.22 / D-31: the default (and the cap) is the remaining weeks — a late
  // joiner finishes with everyone else unless the organizer overrides.
  const defaultWeeksCommitted = Math.max(
    1,
    remainingWeeksInCycle(cycle.plannedWeeks, Math.min(defaultStartWeek, cycle.plannedWeeks)),
  );

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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const startWeek = Number.parseInt(startWeekStr, 10);
  const weeksCommitted = Number.parseInt(weeksStr, 10);
  const startWeekValid =
    Number.isSafeInteger(startWeek) && startWeek >= 1 && startWeek <= MAX_WEEKS;
  // 2.22 / D-31: without the override, the commitment may not pass the
  // planned end.
  const weeksCap = startWeekValid ? remainingWeeksInCycle(cycle.plannedWeeks, startWeek) : null;
  const weeksInRange =
    Number.isSafeInteger(weeksCommitted) && weeksCommitted >= 1 && weeksCommitted <= MAX_WEEKS;
  const exceedsCap = weeksInRange && weeksCap !== null && !extendPastEnd && weeksCommitted > weeksCap;
  const weeksValid = weeksInRange && !exceedsCap;
  const finishWeek =
    startWeekValid && weeksValid ? calculateFinishWeek(startWeek, weeksCommitted) : null;
  // Dates compute themselves — the organizer never calculates one by hand.
  const finishDate = finishWeek !== null ? dateOfWeek(new Date(startDateISO), finishWeek) : null;

  const step1Valid =
    mode === "existing"
      ? selectedPerson !== null && !selectedPerson.inActiveCycle
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

  async function handleSave() {
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
        setError(result.error);
        return;
      }
      setSaved(result.data);
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
          {calculateFinishWeek(saved.startWeek, saved.weeksCommitted)}.
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
      <ol className="flex gap-2 text-xs text-gray-600">
        {["Who", "Contribution", "How long", "Confirm"].map((label, i) => (
          <li
            key={label}
            className={`rounded px-2 py-1 ${step === i + 1 ? "bg-black text-white" : "bg-gray-100"}`}
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
              className={`rounded border px-3 py-1.5 ${mode === "existing" ? "border-black font-medium" : "border-gray-300"}`}
            >
              From the directory
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("new");
                setPersonId(null);
              }}
              className={`rounded border px-3 py-1.5 ${mode === "new" ? "border-black font-medium" : "border-gray-300"}`}
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
                <p className="text-sm text-gray-600">
                  No one matches. Use “Add someone new” instead.
                </p>
              ) : (
                <ul className="max-h-72 divide-y divide-gray-200 overflow-y-auto rounded border border-gray-300">
                  {filtered.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={p.inActiveCycle}
                        onClick={() => setPersonId(p.id)}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                          personId === p.id ? "bg-gray-900 text-white" : ""
                        } ${p.inActiveCycle ? "cursor-not-allowed text-gray-400" : "hover:bg-gray-100"}`}
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

          <button
            type="button"
            disabled={!step1Valid}
            onClick={() => goToStep(2)}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Continue
          </button>
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
            <p className="rounded bg-gray-100 px-3 py-2 text-sm" data-testid="lucky-preview">
              {formatMoney(weeklyAmount!)} becomes {countWord(luckyAmounts.length)} number
              {luckyAmounts.length === 1 ? "" : "s"}:{" "}
              {luckyAmounts.map((a) => formatMoney(a)).join(" and ")}
            </p>
          )}
          {weeklyDollars.trim() !== "" && !luckyAmounts && (
            <p className="text-sm text-red-800">{weeklyError ?? "Enter a valid dollar amount."}</p>
          )}

          {luckyAmounts && !manualNumbers && autoNumbers && (
            <p className="rounded bg-gray-100 px-3 py-2 text-sm" data-testid="auto-numbers">
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
                    <span className="mb-1 block text-gray-600">
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
                      }}
                      className="w-24 rounded border border-gray-400 px-2 py-1"
                    />
                  </label>
                ))}
              </div>
              {manualError && (
                <p role="alert" className="text-sm text-red-800" data-testid="manual-number-error">
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
              onChange={(e) => setStartWeekStr(e.target.value)}
              className="w-full rounded border border-gray-400 px-3 py-2"
            />
            {!startWeekValid && startWeekStr.trim() !== "" && (
              <span className="mt-1 block text-sm text-red-800">
                {Number.isSafeInteger(startWeek) && startWeek > MAX_WEEKS
                  ? `Start week must be at most ${MAX_WEEKS}.`
                  : "Start week can never be before week 1."}
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Weeks committed</span>
            <input
              type="number"
              min={1}
              max={extendPastEnd ? MAX_WEEKS : (weeksCap ?? undefined)}
              value={weeksStr}
              onChange={(e) => setWeeksStr(e.target.value)}
              className="w-full rounded border border-gray-400 px-3 py-2"
            />
            <span className="mt-1 block text-xs text-gray-600">
              Default is the remaining weeks in the cycle — they finish with everyone else.
            </span>
            {weeksStr.trim() !== "" && exceedsCap && (
              <span className="mt-1 block text-sm text-red-800">
                {weeksCap === 0
                  ? "The planned weeks are over — extending past the end requires the override below."
                  : `Only ${weeksCap} week${weeksCap === 1 ? "" : "s"} remain in the cycle. Use the override below to extend past the planned end.`}
              </span>
            )}
            {weeksStr.trim() !== "" && !weeksInRange && (
              <span className="mt-1 block text-sm text-red-800">
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

          {finishWeek !== null && finishDate !== null && (
            <p className="rounded bg-gray-100 px-3 py-2 text-sm" data-testid="finish-preview">
              Finishes in week {finishWeek} — {formatDateUTC(finishDate)}
              {finishWeek > cycle.plannedWeeks &&
                ` (${finishWeek - cycle.plannedWeeks} week${finishWeek - cycle.plannedWeeks === 1 ? "" : "s"} past the planned ${cycle.plannedWeeks})`}
              .
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
          <p className="rounded bg-gray-100 px-3 py-3 text-sm" data-testid="confirm-summary">
            {displayName}, {formatMoney(weeklyAmount!)}/week, weeks {startWeek} to {finishWeek}
            {finishDate !== null && <> (finishing {formatDateUTC(finishDate)})</>}
            {finishWeek !== null && finishWeek > cycle.plannedWeeks && (
              <> — extends the cycle to week {finishWeek}</>
            )}
            .
            <br />
            Lucky number{chosenNumbers.length === 1 ? "" : "s"}:{" "}
            {chosenNumbers.map((n) => `#${n}`).join(", ")}
            {manualNumbers ? " (chosen by you)" : carriedOver ? " (carried over)" : " (automatic)"}.
            <br />
            Receives {formatMoney(gross!)} minus {formatMoney(fee!)} fee ={" "}
            <strong>{formatMoney(net!)}</strong>.
          </p>

          {error && (
            <p role="alert" className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800">
              Not saved: {error}
            </p>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => goToStep(3)} className="rounded border border-gray-400 px-4 py-2 text-sm">
              Back
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
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
