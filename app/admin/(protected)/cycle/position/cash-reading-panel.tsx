"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteCashReading, recordCashReading } from "@/app/actions/cycle-position";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { AmountInput } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { moneyReceivedBounds } from "@/lib/date-bounds";
import { buttonCls, Card, CardHeader, inputCls } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import type { PositionVerdict } from "@/lib/cycle-position";
import { Pager } from "@/components/ui/pager";
import { PageSizeSelect } from "@/components/ui/page-size";
import { PAGE_SIZES } from "@/lib/paging";
import type { PageInfo } from "@/lib/paging";

// WHAT HE ACTUALLY HOLDS — the only stored fact on this page.
//
// Everything else is derived. This is a reading at a moment in time, dated,
// kept forever, so he can look back at what he held in week 8 versus week 12.
//
// THE ANSWER IS NEVER JUST A NUMBER. The verdict says whether he is covered,
// in surplus or short, by how much, and — when short — what he would need to
// make it right.

type Reading = {
  id: string;
  readAt: string;
  totalAmount: number;
  bankAmount: number | null;
  cashAmount: number | null;
  note: string | null;
  differenceVsExpectedToday: number;
};

export function CashReadingPanel({
  expected,
  verdict,
  latest,
  readings,
  readingInfo,
}: {
  expected: number;
  verdict: PositionVerdict | null;
  latest: { totalAmount: number; readAt: string } | null;
  readings: Reading[];
  readingInfo: PageInfo;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [split, setSplit] = useState(false);
  const [total, setTotal] = useState("");
  const [bank, setBank] = useState("");
  const [cash, setCash] = useState("");
  const [readAt, setReadAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  // ONE STATE, KEYED BY WHICH CONTROL PRODUCED IT (rule 6, UI_STANDARDS 6b).
  //
  // THE REPORTED DEFECT. A `msg` banner at the TOP of this card carried the
  // message for the Save button ~90 lines below it AND for every row's Delete
  // ~180 lines below that. Both are off the fold on the screen this panel is
  // used on, so a real refusal with a real reason read as the button doing
  // nothing — the exact report rule 6b was written for.
  //
  // Keyed by slot, a control renders its own message and nothing else does;
  // because it is ONE state two controls can never disagree, and `busy` is
  // DERIVED from it rather than being a second boolean that can drift out of
  // step with the message it is supposed to accompany.
  const [action, setAction] = useState<{ slot: string; state: SaveState }>({
    slot: "",
    state: { kind: "idle" },
  });
  /** Derived: any action in flight locks every control, as `busy` always did. */
  const busy = action.state.kind === "saving";
  /** This slot's message, or nothing — so a control renders only its own. */
  const feedbackFor = (slot: string): SaveState =>
    action.slot === slot ? action.state : { kind: "idle" };
  /** True while the save's confirmation is up — the Cancel button reads it. */
  const saved = action.slot === "save" && action.state.kind === "ok";

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);
  /**
   * The refusal from the delete the dialog just ran, shown INSIDE the dialog
   * beside the button that caused it (UI_STANDARDS 6b) — and DERIVED from the
   * row's own state rather than mirrored into a second `useState`.
   *
   * The mirror is how that slot goes dead. Converting a file to SaveState moves
   * the writer into the save state, `setDialogError` is left being called with
   * `null` from `onCancel` and nowhere else, and `lib/refusal-placement.test.ts`
   * still passes because the `error=` prop is there. Derived, there is nothing
   * to forget to write.
   */
  const dialogError =
    action.slot.startsWith("delete:") && action.state.kind === "err"
      ? action.state.message
      : null;

  // When the two lines are given, the total follows from them — he should
  // never have to add them up himself, and a mismatch is impossible.
  const bankCents = parseDollarsToCents(bank);
  const cashCents = parseDollarsToCents(cash);
  const derivedTotal =
    split && bankCents !== null && cashCents !== null ? bankCents + cashCents : null;
  const totalCents = split ? derivedTotal : parseDollarsToCents(total);

  // THE PANEL NO LONGER CLOSES ITSELF ON SUCCESS, AND THAT IS THE FIX.
  //
  // This function ended with `setOpen(false)`. The confirmation belongs to the
  // button that was pressed (rule 6), the button lives inside this panel, and
  // the panel was unmounted in the same tick the message was set — so the one
  // message the organizer was waiting for was rendered into a tree that no
  // longer existed. He pressed Save, the form vanished, and nothing anywhere
  // said what had been recorded.
  //
  // There were two ways out: hold the panel open long enough for the
  // confirmation to be read, or move the confirmation somewhere that survives
  // the collapse. HOLDING IT OPEN is the one chosen, because the second is the
  // banner this file is being converted away from — a message that outlives the
  // control by leaving it is a message somewhere the organizer is not looking.
  //
  // So the panel stays. The fields are cleared, which makes the button dead
  // again on its own terms (beat 1: nothing entered, nothing to record), the
  // confirmation sits beside it for its six seconds, and he closes the panel
  // when he is done — which is also what he wants when he is entering a bank
  // reading and a cash reading one after the other.
  async function save() {
    if (totalCents === null) {
      // Beat 1 keeps this out of reach FROM THE BUTTON — it is dead until a
      // figure parses, and saying so in the hint is better than a round trip.
      // The guard stays for any other caller, and it now reports AT the button
      // instead of in the banner at the top of the card, where nothing was
      // pressed (6b).
      setAction({ slot: "save", state: { kind: "err", message: "Enter what you are holding." } });
      return;
    }
    // The figures are read here, before the fields are cleared below, so the
    // confirmation can name what was recorded rather than say "Saved".
    const held = formatMoney(totalCents);
    const when = formatDateUTC(new Date(`${readAt}T00:00:00.000Z`));
    const breakdown =
      split && bankCents !== null && cashCents !== null
        ? ` (${formatMoney(bankCents)} bank + ${formatMoney(cashCents)} on hand)`
        : "";
    setAction({ slot: "save", state: { kind: "saving" } });
    try {
      const result = await recordCashReading({
        totalAmount: totalCents,
        bankAmount: split ? bankCents : null,
        cashAmount: split ? cashCents : null,
        readAt: `${readAt}T00:00:00.000Z`,
        note: note || undefined,
      });
      if (!result.ok) {
        setAction({ slot: "save", state: { kind: "err", message: `Not recorded: ${result.error}` } });
        return;
      }
      // No leading "✓" — SaveButton draws the tick itself, and the message
      // carried one of its own for as long as it lived in the Alert.
      setAction({
        slot: "save",
        state: { kind: "ok", message: `Recorded ${held} held on ${when}${breakdown}.` },
      });
      setTotal("");
      setBank("");
      setCash("");
      setNote("");
      router.refresh();
    } catch {
      setAction({
        slot: "save",
        state: { kind: "err", message: "Could not reach the server — nothing was saved." },
      });
    }
  }

  /**
   * Delete one reading. Returns the refusal, or null on success — so the dialog
   * can close on success ALONE (6b: a dialog that closes on failure has thrown
   * the reason away).
   */
  async function deleteReading(r: Reading): Promise<string | null> {
    const slot = `delete:${r.id}`;
    setAction({ slot, state: { kind: "saving" } });
    try {
      const res = await deleteCashReading({ id: r.id });
      if (!res.ok) {
        // The row is still on screen, so its own slot is where this belongs —
        // and `dialogError` derives from it, so the open dialog shows it too.
        const refused = `Not deleted: ${res.error}`;
        setAction({ slot, state: { kind: "err", message: refused } });
        return refused;
      }
      // THE ROW IS ABOUT TO DISAPPEAR, AND ITS FEEDBACK SLOT WITH IT.
      //
      // The same shape as the panel collapsing over its own confirmation: a
      // successful delete removes the very row the message would render in. So
      // the success goes to the LIST's slot, which sits at the foot of the list
      // where the row was and outlives it — 6b's "in that row, or in a slot
      // pinned to it". The refusal above stays in the row, because on that path
      // the row is still there.
      setAction({
        slot: "deleted",
        state: {
          kind: "ok",
          message: `Deleted the ${formatMoney(r.totalAmount)} reading taken on ${formatDateUTC(
            new Date(r.readAt),
          )}.`,
        },
      });
      router.refresh();
      return null;
    } catch {
      const refused = "Could not reach the server — nothing was deleted.";
      setAction({ slot, state: { kind: "err", message: refused } });
      return refused;
    }
  }

  const tone =
    verdict === null
      ? "neutral"
      : verdict.kind === "short"
        ? "bad"
        : verdict.kind === "covered"
          ? "warn"
          : "good";

  return (
    <Card>
      <CardHeader
        title="What you actually hold"
        sub="Across bank and cash on hand. The only figure on this page you enter yourself — everything else is worked out from money already recorded."
      />
      <div className="space-y-4 px-5 pb-4">
        {/* THE CARD BANNER IS GONE. It carried the message for the Save button
            below and for every Delete in the list under it — one slot, for
            controls the organizer reaches by scrolling past it. Each control
            now renders its own message at itself. */}

        {/* THE ANSWER. */}
        {verdict === null ? (
          <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
            You have not recorded what you are holding yet. Enter it below and this will say
            whether you are covered, in surplus, or short — and by how much.
          </p>
        ) : (
          <div
            data-testid="position-verdict"
            className={
              "rounded-xl border-2 px-4 py-3 " +
              (tone === "bad"
                ? "border-red-400 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
                : tone === "warn"
                  ? "border-amber-400 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
                  : "border-emerald-400 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30")
            }
          >
            <p className="text-base font-bold leading-snug text-gray-900 dark:text-white">
              {verdict.sentence}
            </p>
            <p className="mt-2 text-xs tabular-nums text-gray-700 dark:text-gray-300">
              Expected {formatMoney(expected)} · you hold{" "}
              {formatMoney(latest?.totalAmount ?? 0)}
              {latest && <> · read {formatDateUTC(new Date(latest.readAt))}</>}
            </p>
          </div>
        )}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={buttonCls.secondary}>
            Record what you are holding…
          </button>
        ) : (
          <div className="space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={split}
                onChange={(e) => setSplit(e.target.checked)}
              />
              <span>Enter bank and cash on hand separately</span>
            </label>

            <div className="flex flex-wrap items-end gap-3">
              {split ? (
                <>
                  <Field label="Bank">
                    <AmountInput value={bank} onChange={setBank} ariaLabel="Bank balance in dollars" className="w-32" />
                  </Field>
                  <Field label="Cash on hand">
                    <AmountInput value={cash} onChange={setCash} ariaLabel="Cash on hand in dollars" className="w-32" />
                  </Field>
                  <p className="pb-2 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                    ={" "}
                    {derivedTotal === null ? "—" : formatMoney(derivedTotal)}
                  </p>
                </>
              ) : (
                <Field label="Total held">
                  <AmountInput value={total} onChange={setTotal} ariaLabel="Total held in dollars" className="w-36" />
                </Field>
              )}
              <Field label="Read on">
                <DatePicker
                  value={readAt}
                  onChange={setReadAt}
                  ariaLabel="Date of the reading"
                  bounds={moneyReceivedBounds()}
                />
              </Field>
              <Field label="Note (optional)">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. after Tuesday's deposits"
                  className={inputCls + " w-56"}
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* ALL FOUR BEATS FROM THE SHARED CONTROL. The hand-rolled button
                  owned beats 1 and 2 (dead until a figure parses, "Saving…"
                  during the round trip) and had no way to own 3 or 4 — those
                  went to the banner at the top of the card, and then the panel
                  closed over them. SaveButton renders both AT the button, so
                  they cannot be put anywhere else. */}
              <SaveButton
                state={feedbackFor("save")}
                onSave={() => void save()}
                // Guarded: the six-second fade can land after a Delete has taken
                // the slot, and an unconditional reset would blank that message.
                onStateSettled={() =>
                  setAction((a) => (a.slot === "save" ? { slot: "save", state: { kind: "idle" } } : a))
                }
                label="Save this reading"
                dirty={totalCents !== null}
                disabled={busy}
                notDirtyHint={
                  split
                    ? "Enter both the bank figure and the cash on hand."
                    : "Enter what you are holding first."
                }
              />
              {/* "Cancel" is the wrong word once the reading is recorded — the
                  panel stays open on purpose (see `save()`) and this closes it,
                  it does not undo anything. */}
              <button type="button" onClick={() => setOpen(false)} className={buttonCls.ghost}>
                {saved ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {/* ————— HISTORY: drift across the cycle, not only today ————— */}
        {readingInfo.total > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Past readings
            </h3>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
              {readings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="tabular-nums text-gray-600 dark:text-gray-400">
                    {formatDateUTC(new Date(r.readAt))}
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                    {formatMoney(r.totalAmount)}
                  </span>
                  {r.bankAmount !== null && r.cashAmount !== null && (
                    <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      ({formatMoney(r.bankAmount)} bank + {formatMoney(r.cashAmount)} on hand)
                    </span>
                  )}
                  {r.note && (
                    <span className="text-xs italic text-gray-500 dark:text-gray-400">{r.note}</span>
                  )}
                  <span
                    className={
                      "ml-auto text-xs tabular-nums " +
                      (r.differenceVsExpectedToday < 0
                        ? "text-red-700 dark:text-red-400"
                        : "text-emerald-700 dark:text-emerald-400")
                    }
                  >
                    {r.differenceVsExpectedToday >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(r.differenceVsExpectedToday))} vs expected now
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      // Clear this row's slot as the dialog opens, so a refusal
                      // from a previous attempt is not showing inside it before
                      // anything has been pressed.
                      setAction({ slot: `delete:${r.id}`, state: { kind: "idle" } });
                      setConfirm({
                        title: `Delete the reading of ${formatMoney(r.totalAmount)}?`,
                        body: (
                          <p>
                            The reading taken on {formatDateUTC(new Date(r.readAt))} is removed from
                            the history. Nothing else changes — every other figure on this page is
                            derived. An audit entry records the deletion.
                          </p>
                        ),
                        confirmLabel: "Delete reading",
                      });
                      setOnConfirm(() => () => {
                        void (async () => {
                          const refused = await deleteReading(r);
                          // CLOSE ONLY ON SUCCESS. On a refusal the dialog
                          // stays open and `dialogError` — derived from the
                          // state `deleteReading` just wrote — is already
                          // showing the reason inside it (6b).
                          if (refused === null) {
                            setConfirm(null);
                            setOnConfirm(null);
                          }
                        })();
                      });
                    }}
                    className={buttonCls.dangerQuiet + " !px-2 !py-0.5 !text-[11px]"}
                  >
                    Delete
                  </button>
                  {/* THIS row's refusal, in THIS row. The reading rows are the
                      last block on a long page and the banner that used to
                      carry this was at the very top of the card. `basis-full`
                      so the reason gets the row's full width instead of being
                      squeezed in after the figures. */}
                  <SaveFeedback state={feedbackFor(`delete:${r.id}`)} className="basis-full" />
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <Pager
                info={readingInfo}
                noun={{ one: "reading", many: "readings" }}
                label="Cash reading pages"
                hrefFor={(p) =>
                  `?readingsPage=${p}${readingInfo.take !== PAGE_SIZES.cashReadings ? `&readingsPageSize=${readingInfo.take}` : ""}`
                }
              />
              <PageSizeSelect
                param="readingsPageSize"
                pageParam="readingsPage"
                dflt={PAGE_SIZES.cashReadings}
                storageKey="admin-cash-readings-page-size"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              The comparison is against what is expected <strong>today</strong> — it shows drift,
              not what the books said on each of those days.
            </p>
          </div>
        )}

        {/* THE LIST'S OWN SLOT: the confirmation for a row that has just been
            deleted. It sits at the foot of the list, where the row was, and it
            is deliberately OUTSIDE the block above — deleting the last reading
            takes that block away with it, and the message would go too. */}
        <SaveFeedback state={feedbackFor("deleted")} />
      </div>

      <ConfirmDialog
        spec={confirm}
        error={dialogError}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}
