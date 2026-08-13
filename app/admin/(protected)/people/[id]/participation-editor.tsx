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
import { NumberConflictPanel } from "@/components/admin/number-conflict-panel";
import { FeeCalculator } from "@/components/admin/fee-calculator";
import { CloseParticipation } from "@/components/admin/close-participation";
import { RemoveFromCycle } from "@/components/admin/remove-from-cycle";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { AmountInput, Checkbox, NumberInput, Radio, Select } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { moneyReceivedBounds } from "@/lib/date-bounds";
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
import type { NumberConflict } from "@/lib/lucky-numbers";
import { calculateFinishWeek } from "@/lib/money";
import { nameConfirmed } from "@/lib/settlement";

type Method = "ZELLE" | "CASH" | "OTHER" | null;

const METHOD_OPTIONS: { value: "" | "ZELLE" | "CASH" | "OTHER"; label: string }[] = [
  { value: "", label: "—" },
  { value: "ZELLE", label: "Zelle" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" },
];

/** One receipt, as the row edits it. */
type EventRowData = {
  id: string;
  amount: number;
  method: Method;
  receivedAt: string;
  notes: string | null;
  /**
   * This receipt came out of a payout, not out of a pocket — the winner's own
   * week (rule 6). Computed on the server from pinnedWeekId and
   * settlementPayoutId, never sniffed from the notes: the notes are editable
   * on the same row, so a text marker could be erased by an ordinary edit
   * while the money link to the payout survived.
   */
  settlement: boolean;
};

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
    /** The cycle's real unit and fee — the live calculator reads them (2.6). */
    unitAmount: number;
    feePercent: number;
    /** Set when they have STOPPED (2.18). Null while they are contributing. */
    closed: { atWeek: number | null; reason: string | null; note: string | null } | null;
  };
  luckyNumbers: { id: string; number: number; amount: number }[];
  events: EventRowData[];
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

  // THE REPORTED DEFECT, ONE CONTROL DOWN.
  //
  // Rule 6 was written because the organizer changed 10 weeks to 12, pressed
  // Save, and saw nothing — the confirmation rendered above the fold. The
  // participation Save was fixed and moved to `SaveButton`. EVERY OTHER
  // ACTION IN THIS FILE KEPT THE ORIGINAL BUG: one `banner` at line ~550 fed
  // by `run()`, with the controls that produce it at 465, 1054, 1168, 1213,
  // 1297 and 1302 — up to SEVEN HUNDRED AND FIFTY LINES below the message.
  // Deleting a lucky number, a receipt, or the whole participation reported
  // its success and its refusal somewhere the organizer was not looking.
  //
  // ONE state, keyed by WHICH control produced it. A row renders its own
  // message and nothing else does; because it is one state, two controls can
  // never disagree, and a new message replaces the last rather than stacking.
  const [action, setAction] = useState<{ slot: string; state: SaveState }>({
    slot: "",
    state: { kind: "idle" },
  });
  /** Derived: any action in flight locks every control, as `busy` always did. */
  const busy = action.state.kind === "saving";
  /** This slot's message, or nothing — so a row renders only its own. */
  const feedbackFor = (slot: string): SaveState =>
    action.slot === slot ? action.state : { kind: "idle" };

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  /**
   * A refusal from the action the dialog just ran — shown INSIDE the dialog,
   * beside the button that caused it (UI_STANDARDS 6b).
   *
   * IT HAD NO WRITER. The slot was wired to `<ConfirmDialog error={...}>` and
   * `setDialogError` was only ever called with `null`, from `onCancel` — so
   * `lib/refusal-placement.test.ts` passed on "the slot exists" while nothing
   * could ever fill it, and `ask` below closed the dialog in a promise
   * `.finally()` regardless of the outcome. Six destructive confirmations
   * therefore threw their refusal away with the dialog that could have shown
   * it. Both halves are fixed here.
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  /** Returns the refusal, or null on success — so `ask` can decide to close. */
  async function runIn(
    slot: string,
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ): Promise<string | null> {
    setAction({ slot, state: { kind: "saving" } });
    try {
      const result = await fn();
      if (!result.ok) {
        const refused = `Not saved: ${result.error}`;
        setAction({ slot, state: { kind: "err", message: refused } });
        return refused;
      }
      setAction({ slot, state: { kind: "ok", message: label } });
      router.refresh();
      return null;
    } catch {
      const refused = "Could not reach the server — nothing was confirmed.";
      setAction({ slot, state: { kind: "err", message: refused } });
      return refused;
    }
  }

  /**
   * The `run`/`ask` a ROW receives, already knowing which slot it writes to.
   *
   * Curried rather than adding a slot argument to `Ask`/`Run`, so the three
   * row components keep the exact signatures they declare and none of their
   * call sites change — the slot is the parent's business, not theirs.
   */
  const runVia = (slot: string): Run => (label, fn) => runIn(slot, label, fn).then(() => {});
  const askVia =
    (slot: string): Ask =>
    (spec, label, fn) => {
      setDialogError(null);
      setConfirm(spec);
      setOnConfirm(() => () => {
        void (async () => {
          const refused = await runIn(slot, label, fn);
          // CLOSE ONLY ON SUCCESS. The `.finally()` this replaces ran on both
          // paths, so a refusal was discarded with the dialog (6b).
          if (refused === null) {
            setConfirm(null);
            setOnConfirm(null);
          } else {
            setDialogError(refused);
          }
        })();
      });
    };

  // ————— Participation fields —————
  const [weeklyDollars, setWeeklyDollars] = useState(String(participation.weeklyAmount / 100));
  const [startWeek, setStartWeek] = useState(String(participation.startWeek));
  const [weeks, setWeeks] = useState(String(participation.weeksCommitted));

  // §2.10, beats 1–3. The confirmation belongs to the Save BUTTON, not to the
  // page — see the note at the control itself for what went wrong.
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  /**
   * What is stored right now, as the form sees it.
   *
   * Seeded from the props and moved forward on every successful save, so
   * "dirty" keeps meaning "different from what is saved" across repeated
   * edits — not just "different from what the page loaded with".
   */
  const [savedShape, setSavedShape] = useState({
    weeklyAmount: participation.weeklyAmount,
    startWeek: participation.startWeek,
    weeksCommitted: participation.weeksCommitted,
  });
  // THE OVERRIDE STARTS WHERE THE MEMBER ALREADY IS.
  //
  // This was `useState(false)`, unconditionally — so a member whose commitment
  // ALREADY runs past the planned end (the override was granted when they were
  // added) opened this form with the box unticked. Every subsequent edit to
  // them then sent `extendPastPlannedEnd: false`, and the server refused it
  // with the cap error, because their commitment still exceeded the cap. The
  // organizer saw a dialog naming the override, pressed Save, and nothing
  // happened — including when he was making the commitment SHORTER.
  //
  // Reproduced against the live database in scripts/repro-participation-shorten.mts:
  // 11 → 10 weeks commits cleanly with the override and is refused without it.
  //
  // Ticked here means "this member is already past the planned end", which is a
  // fact, not a fresh consent — and unticking it is still how you take the
  // override away.
  const [extend, setExtend] = useState(
    () =>
      calculateFinishWeek(participation.startWeek, participation.weeksCommitted) >
      participation.plannedWeeks,
  );

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

  /** Beat 1: the Save is dead until something actually differs from stored. */
  const participationDirty =
    parseDollarsToCents(weeklyDollars) !== savedShape.weeklyAmount ||
    startWeekNum !== savedShape.startWeek ||
    weeksNum !== savedShape.weeksCommitted;
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
      setSaveState({ kind: "err", message: "Weekly amount is invalid." });
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
    /** Returns the refusal, or null — the dialog closes only on null. */
  }): Promise<string | null> {
    const input = baseInput();
    if (!input) return null;
    setSaveState({ kind: "saving" });
    try {
      const result = await updateParticipation(
        withSettlement ? { ...input, settlement: withSettlement } : input,
      );
      if (result.ok) {
        setSettlement(null);
        setTypedName("");
        setReturnedDollars("");
        // SAY WHAT CHANGED, not merely that something did. "Saved" leaves him
        // checking; naming the new shape IS the confirmation (§2.10).
        setSaveState({
          kind: "ok",
          message:
            `Saved — ${formatMoney(input.weeklyAmount)}/week, weeks ${input.startWeek} to ` +
            `${calculateFinishWeek(input.startWeek, input.weeksCommitted)}. Receipts re-allocated.`,
        });
        // The form is clean against what is NOW stored, so the button goes
        // dead until something changes again — beat 1 of rule 6.
        setSavedShape({
          weeklyAmount: input.weeklyAmount,
          startWeek: input.startWeek,
          weeksCommitted: input.weeksCommitted,
        });
        router.refresh();
        return null;
      }
      if ("needsSettlement" in result && result.needsSettlement) {
        setSaveState({ kind: "idle" });
        setSettlement(result.needsSettlement);
        setChoice(result.needsSettlement.gap > 0 ? "returned" : "credit");
        // NOT A REFUSAL. The settlement panel IS the next step and it opens
        // below, so the dialog should close — there is nothing to show inside
        // it and leaving it open would cover the panel it just produced.
        return null;
      }
      const refused = `Not saved: ${result.error}`;
      setSaveState({ kind: "err", message: refused });
      return refused;
    } catch {
      const refused = "Could not reach the server — nothing was confirmed.";
      setSaveState({ kind: "err", message: refused });
      return refused;
    }
  }

  function saveParticipation() {
    const input = baseInput();
    if (!input) return;

    // DO NOT OPEN A CONFIRMATION FOR A SAVE THAT CANNOT SUCCEED.
    //
    // `cap.exceedsCap` is true in exactly the case `validateCommitmentCap`
    // refuses on the server. Before this, the dialog opened anyway, Save sent
    // a doomed request, and the refusal landed in the banner at the TOP of a
    // long form — well above the button that had just been pressed. A real
    // refusal read as a silent no-op, which is how "it did not save" gets
    // reported with no error to quote.
    if (cap?.exceedsCap) {
      setSaveState({
        kind: "err",
        message:
          `Not saved. Week ${input.startWeek + input.weeksCommitted - 1} is past the cycle's ` +
          `planned ${participation.plannedWeeks}, so this needs the override — tick “Allow ` +
          `${participation.personName} to keep paying past week ${participation.plannedWeeks}” ` +
          `below, or shorten the commitment to ${cap.cap} week${cap.cap === 1 ? "" : "s"}.`,
      });
      return;
    }

    // THE THREE THINGS THIS SAVE DOES THAT THE DIALOG NEVER MENTIONED.
    //
    // 1. It moves the PAYOUT. When their week-of-the-win was settled out of
    //    their payout, a changed weekly resizes that receipt and moves the
    //    payout with it — even when their entitlement is unchanged and so no
    //    settlement step opens at all.
    // 2. It lengthens the CYCLE. Weeks are rows on the cycle, shared by
    //    everyone; a commitment running past the planned end creates them.
    // 3. It deletes and rewrites receipts, so it is not a quiet save.
    const weeklyMoved = input.weeklyAmount !== participation.weeklyAmount;
    const settlementMoves = weeklyMoved && props.events.some((e) => e.settlement);
    const finishesAt = input.startWeek + input.weeksCommitted - 1;
    const addsWeeks = finishesAt > participation.plannedWeeks;
    const shortening = input.weeksCommitted < participation.weeksCommitted;
    const consequences = [
      settlementMoves
        ? `Their week-of-the-win contribution was settled out of their payout. Changing the ` +
          `weekly resizes that receipt and moves the payout figure with it — on this page and ` +
          `on Collections — whether or not a settlement step opens.`
        : null,
      // WHAT THIS ACTUALLY DOES, not what it technically touches.
      //
      // It used to read "the missing weeks are created on the CYCLE, so they
      // appear in every member's grid, not just Henok's" — true, and it reads
      // as though other members are affected. They are not: their commitments
      // do not change, weeks past their own window fall outside it so they owe
      // nothing for them, and their expectation for those weeks is zero. The
      // only real consequence is that the admin grid gains rows.
      addsWeeks
        ? `Extending past week ${participation.plannedWeeks} makes this cycle ${finishesAt} ` +
          `weeks long. Week${finishesAt - participation.plannedWeeks === 1 ? "" : "s"} ` +
          `${participation.plannedWeeks + 1}${finishesAt - participation.plannedWeeks === 1 ? "" : `-${finishesAt}`} ` +
          `will be created. No other member is affected — their commitments are unchanged and ` +
          `those weeks fall outside their window, so they owe nothing for them. Your admin grid ` +
          `will show ${finishesAt} weeks instead of ${participation.plannedWeeks}, with ` +
          `week${finishesAt - participation.plannedWeeks === 1 ? "" : "s"} ` +
          `${participation.plannedWeeks + 1}${finishesAt - participation.plannedWeeks === 1 ? "" : `-${finishesAt}`} ` +
          `empty except for ${participation.personName}.`
        : null,
    ].filter((line): line is string => line !== null);

    setConfirm({
      title: `Save ${participation.personName}'s participation?`,
      // It deletes and replays receipts and can move a payout. An indigo
      // button said otherwise.
      destructive: consequences.length > 0,
      consequence: consequences.length > 0 ? consequences.join(" ") : undefined,
      // Shortening the weeks is the obvious way to say "they are stopping
      // early" — and it is the expensive way. The action that means that
      // closes the participation and touches no money at all.
      alternative: shortening
        ? {
            label: "They are leaving the cycle",
            description:
              "Use “Remove from cycle → keep their money records” below instead. It closes " +
              "their participation and leaves every receipt, week and figure exactly as it " +
              "is, rather than re-allocating their money against a shorter commitment.",
            onChoose: () => {
              setConfirm(null);
              setOnConfirm(null);
            },
          }
        : undefined,
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
      void (async () => {
        const refused = await submitParticipation();
        // CLOSE ONLY ON SUCCESS, like every other confirmation here. The
        // `.finally()` this replaces closed on both paths; the refusal did
        // reach the SaveButton below, but the dialog vanished as it arrived,
        // which reads as the press having worked.
        if (refused === null) {
          setConfirm(null);
          setOnConfirm(null);
        } else {
          setDialogError(refused);
        }
      })();
    });
  }

  function doRemove() {
    askVia("remove")(
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

  // A NUMBER ALREADY IN USE IS A CHOICE, NOT A DEAD END (organizer's ruling).
  // The server refuses and hands back WHO holds it, whether it can be taken,
  // and which number is free — this panel turns that into the two real
  // options. Nothing is applied until one of them is pressed.
  const [conflict, setConflict] = useState<PendingConflict | null>(null);

  /**
   * Save a lucky number, routing a conflict into the panel instead of showing
   * a dead-end error. `retry` re-runs the identical save with the organizer's
   * REPLACE answer; `keep` writes the free number into the field they used.
   */
  async function saveNumber(args: {
    label: string;
    save: (onConflict?: "replace") => Promise<{ ok: boolean; error?: string; conflict?: NumberConflict }>;
    keep: (suggested: number) => void;
  }) {
    // Every lucky-number write — adding one, editing one, replacing a
    // conflicting one — reports at the numbers block, which is where all of
    // them are pressed.
    const slot = "number:new";
    setConflict(null);
    setAction({ slot, state: { kind: "saving" } });
    try {
      const result = await args.save();
      if (result.ok) {
        setAction({ slot, state: { kind: "ok", message: args.label } });
        router.refresh();
      } else if (result.conflict) {
        // NOT A REFUSAL, a QUESTION. `NumberConflictPanel` opens naming the
        // holder and offering Replace or Keep, and it IS this outcome's
        // feedback — printing a refusal beside it would say the save had
        // failed when it is still waiting on him.
        setAction({ slot, state: { kind: "idle" } });
        // `args` already carries the label, the retry and the keep-handler.
        setConflict({ ...args, conflict: result.conflict });
      } else {
        setAction({ slot, state: { kind: "err", message: `Not saved: ${result.error}` } });
      }
    } catch {
      setAction({
        slot,
        state: { kind: "err", message: "Could not reach the server — nothing was confirmed." },
      });
    }
  }

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
      {/* THE PAGE BANNER IS GONE. It carried the confirmation for nine
          different controls, up to 750 lines above whichever one was pressed —
          the reported defect, unchanged, in the very file it was reported
          against. Every action now renders its own message at itself. */}

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

        {/* THE FEE, LIVE — the answer he reads off the screen while someone is
            on the phone asking "if I put in $750 a week, what's your fee?".
            Recomputes as the amount or the weeks change; nothing is saved. */}
        <FeeCalculator
          weeklyAmount={parseDollarsToCents(weeklyDollars)}
          weeksCommitted={weeksNum}
          unitAmount={participation.unitAmount}
          feePercent={participation.feePercent}
        />

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
            <>
              Allow this member to keep paying past week {participation.plannedWeeks} (2.22
              override). The extra weeks are created on the cycle so the admin grid can hold
              them; no other member&apos;s commitment changes.
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          {/* THE REPORTED DEFECT (§2.10). He changed the weeks from 10 to 12,
              pressed this, and saw nothing. The save worked and the
              confirmation rendered — 100 lines of JSX ABOVE, at the top of a
              form holding the amount, the start week, the weeks field, two
              checkboxes, the cap message and the fee calculator. He was
              looking at the button.

              SaveButton owns the feedback so it cannot be put anywhere else:
              the confirmation renders beside the control that caused it, the
              label carries the working state, and the button is dead until
              something has actually changed. */}
          <SaveButton
            state={saveState}
            onSave={saveParticipation}
            onStateSettled={() => setSaveState({ kind: "idle" })}
            label="Save participation"
            savingLabel="Saving…"
            dirty={participationDirty}
            disabled={busy}
            notDirtyHint="Nothing has changed — the weekly amount, start week and weeks committed all match what is saved."
          />
          {/* SOMEONE STOPPING IS THE ORDINARY CASE, so it sits first and is
              not styled as a danger. Shortening their weeks used to be the
              only way to say it, and that is the expensive way: it deletes
              and re-allocates every receipt against a commitment they never
              made. This changes no money at all. */}
          <CloseParticipation
            participationId={participation.id}
            personName={participation.personName}
            cycleName={participation.cycleName}
            closed={participation.closed}
          />
          {/* The single red button that cascade-deleted everything is gone.
              RemoveFromCycle computes what is attached — receipts, payout,
              numbers, fee — and offers the two genuinely different outcomes
              with their figures, neither pre-selected. */}
          <RemoveFromCycle
            participationId={participation.id}
            personName={participation.personName}
          />
          {/* `doRemove`'s own outcome, beside the controls that trigger it. */}
          <SaveFeedback state={feedbackFor("remove")} />
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
                      setSaveState({
                        kind: "ok",
                        message: `Weeks set to ${settlement.balancingWeeksWhole} — at ${weeklyDollars ? `$${weeklyDollars}` : "the new weekly"} that entitles them to ${
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
              <LuckyRow
                  key={n.id}
                  n={n}
                  busy={busy}
                  saveNumber={saveNumber}
                  ask={askVia(`number:${n.id}`)}
                  feedback={feedbackFor(`number:${n.id}`)}
                />
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
              if (cents === null || cents < 1)
                return setAction({
                  slot: "number:new",
                  state: { kind: "err", message: "New number amount is invalid." },
                });
              const wanted = Number.parseInt(newNumber, 10);
              void saveNumber({
                label: `Added #${wanted}.`,
                save: (onConflict) =>
                  addLuckyNumber({
                    participationId: participation.id,
                    number: wanted,
                    amount: cents,
                    onConflict,
                  }),
                keep: (suggested) => setNewNumber(String(suggested)),
              });
            }}
            className={buttonCls.secondary}
          >
            Add number
          </button>
        </div>

        {/* Adding a number, and the conflict resolution that can follow it,
            report here — under the control that started it. */}
        <SaveFeedback state={feedbackFor("number:new")} />

        {conflict && (
          <NumberConflictPanel
            conflict={conflict.conflict}
            busy={busy}
            onDismiss={() => setConflict(null)}
            onReplace={() => {
              const { save, label } = conflict;
              setConflict(null);
              void saveNumber({
                label,
                save: () => save("replace"),
                keep: conflict.keep,
              });
            }}
            onKeep={(suggested) => {
              conflict.keep(suggested);
              setConflict(null);
              setAction({
                slot: "number:new",
                state: {
                  kind: "ok",
                  message:
                    `#${conflict.conflict.number} stays with ${conflict.conflict.holder.memberName}. ` +
                    `The field now reads #${suggested} — press save to use it.`,
                },
              });
            }}
          />
        )}
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
                <EventRow
                    key={event.id}
                    event={event}
                    busy={busy}
                    run={runVia(`receipt:${event.id}`)}
                    ask={askVia(`receipt:${event.id}`)}
                    feedback={feedbackFor(`receipt:${event.id}`)}
                  />
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
              <WeekRow
                  key={w.paymentId}
                  w={w}
                  busy={busy}
                  run={runVia(`week:${w.paymentId}`)}
                  ask={askVia(`week:${w.paymentId}`)}
                  feedback={feedbackFor(`week:${w.paymentId}`)}
                />
            ))}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setDialogError(null);
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
type SaveNumber = (args: {
  label: string;
  save: (
    onConflict?: "replace",
  ) => Promise<{ ok: boolean; error?: string; conflict?: NumberConflict }>;
  keep: (suggested: number) => void;
}) => Promise<void>;

/** A conflict awaiting the organizer's answer, with the way to apply each. */
type PendingConflict = {
  conflict: NumberConflict;
  label: string;
  save: (
    onConflict?: "replace",
  ) => Promise<{ ok: boolean; error?: string; conflict?: NumberConflict }>;
  keep: (suggested: number) => void;
};

// The conflict panel moved to components/admin/number-conflict-panel.tsx —
// the add-member wizard shows the identical choice from the identical reply.

function LuckyRow({
  n,
  busy,
  saveNumber,
  ask,
  feedback,
}: {
  n: { id: string; number: number; amount: number };
  busy: boolean;
  saveNumber: SaveNumber;
  ask: Ask;
  /** THIS number's message, rendered in THIS row (rule 6 beats 3 and 4). */
  feedback: SaveState;
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
            const wanted = Number.parseInt(number, 10);
            void saveNumber({
              label: `#${wanted} saved.`,
              save: (onConflict) =>
                updateLuckyNumber({
                  luckyNumberId: n.id,
                  number: wanted,
                  amount: cents,
                  onConflict,
                }),
              keep: (suggested) => setNumber(String(suggested)),
            });
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
        {/* THIS row's message, in THIS row. Save and Delete for #7 both report
            here — beside the buttons that were pressed, not at the top of a
            page that may be a screen and a half away (rule 6, 6b). */}
        <SaveFeedback state={feedback} className="mt-1 block" />
      </td>
    </tr>
  );
}

function EventRow({
  event,
  busy,
  run,
  ask,
  feedback,
}: {
  event: EventRowData;
  busy: boolean;
  run: Run;
  ask: Ask;
  /** THIS receipt's message, rendered in THIS row (rule 6 beats 3 and 4). */
  feedback: SaveState;
}) {
  const [dollars, setDollars] = useState(String(event.amount / 100));
  const [method, setMethod] = useState<"" | "ZELLE" | "CASH" | "OTHER">(event.method ?? "");
  const [receivedAt, setReceivedAt] = useState(event.receivedAt.slice(0, 10));
  const [notes, setNotes] = useState(event.notes ?? "");
  const router = useRouter();
  /**
   * Beat 1 of rule 6: dead until the row differs from the stored receipt.
   *
   * It was gated on `busy` alone. Pressing Save on an untouched row rewrote
   * the receipt with its own values and wrote an audit entry recording a
   * change that had not happened — on the append-only log, where a wrong entry
   * can only be answered by another entry (rule 15).
   */
  const rowDirty =
    parseDollarsToCents(dollars) !== event.amount ||
    method !== (event.method ?? "") ||
    receivedAt !== event.receivedAt.slice(0, 10) ||
    notes !== (event.notes ?? "");
  // Structural, from the server (pinnedWeekId + settlementPayoutId). This used
  // to sniff the notes for "settled from the payout" — and the Save button on
  // this same row can empty the notes, so one ordinary edit made a settlement
  // receipt stop looking like one while its money link to the payout survived.
  const isSettlement = event.settlement;
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800 align-top">
      <td className="py-1.5 pr-2">
        <AmountInput
          value={dollars}
          onChange={setDollars}
          ariaLabel="Receipt amount in dollars"
          // The amount is half of a pair with the payout. It only ever moves
          // together with the other half, which is the participation save.
          disabled={isSettlement}
          className="w-28"
        />
        {isSettlement && (
          <p className="mt-1 max-w-44 text-[10px] leading-tight text-gray-600 dark:text-gray-400">
            Set by the draw. Change their weekly amount to change what this week costs.
          </p>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <Select value={method} onChange={setMethod} ariaLabel="Receipt method" options={METHOD_OPTIONS} disabled={busy} className="w-24" />
      </td>
      <td className="py-1.5 pr-2">
        <DatePicker
          value={receivedAt}
          onChange={setReceivedAt}
          ariaLabel="Received date"
          bounds={moneyReceivedBounds()}
        />
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
        {isSettlement && (
          <p className="mt-1 max-w-44 text-[10px] leading-tight text-gray-600 dark:text-gray-400">
            Emptying this box does not make it an ordinary receipt.
          </p>
        )}
      </td>
      <td className="whitespace-nowrap py-1.5">
        <button
          type="button"
          disabled={busy || !rowDirty}
          title={!busy && !rowDirty ? "Nothing has changed in this receipt." : undefined}
          onClick={() => {
            const cents = parseDollarsToCents(dollars);
            if (cents === null || cents < 1) return;
            ask(
              {
                title: `Save this receipt as ${formatMoney(cents)}?`,
                destructive: false,
                // A settlement receipt's amount is locked in the field above,
                // so Save here only ever carries the date, method and notes.
                // Say so, rather than letting the organizer wonder why their
                // typing had no effect.
                consequence: isSettlement
                  ? "This is a payout settlement. The amount stays at " +
                    `${formatMoney(event.amount)} — it is the winner's own week, taken out of ` +
                    "their payout, and the two figures only move together. Only the date, " +
                    "method and notes are saved."
                  : undefined,
                body: (
                  <p>
                    All of this member&apos;s weeks recalculate from their receipts immediately.
                    If a receipt no longer fits, nothing changes and you see the reason. An
                    audit entry records old and new values.
                  </p>
                ),
                confirmLabel: "Save receipt",
              },
              "Receipt saved — weeks recalculated.",
              () =>
                updatePaymentEvent({
                  eventId: event.id,
                  // Never send a hand-typed figure for a settlement receipt:
                  // the field is disabled, but the state behind it is not the
                  // authority — the server's own record is.
                  amount: isSettlement ? event.amount : cents,
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
                consequence: isSettlement
                  ? "This is a payout settlement, not a payment. Deleting it would make the " +
                    "drawn week owed again while the payout stays reduced by the same money — " +
                    "the member would be charged twice. The server refuses it."
                  : undefined,
                alternative: isSettlement
                  ? {
                      label: "Go to Collections",
                      description:
                        "Undo the draw, or take that winner off the week. Either one reverses " +
                        "the settlement and the payout together.",
                      onChoose: () => router.push("/admin/collections"),
                    }
                  : undefined,
                body: (
                  <p>
                    The money disappears from the member&apos;s record and every week
                    recalculates. An audit entry records the deleted receipt.
                  </p>
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
        {/* Deleting a receipt re-allocates every week this member has. The
            confirmation says so, HERE — the receipts table can run to
            hundreds of rows. */}
        <SaveFeedback state={feedback} className="mt-1 block" />
      </td>
    </tr>
  );
}

function WeekRow({
  w,
  busy,
  run,
  ask,
  feedback,
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
  /** THIS week row's message, rendered in THIS row (rule 6 beats 3 and 4). */
  feedback: SaveState;
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
        {/* One week row of twenty. The confirmation belongs to the row that
            was saved, not to the top of the table. */}
        <SaveFeedback state={feedback} className="mt-1 block" />
      </td>
    </tr>
  );
}
