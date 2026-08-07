"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deductCarryFromPayout, payoutCarryOffer } from "@/app/actions/carry-deduction";
import type { CarryOffer } from "@/lib/carry-balance";
import { AmountInput } from "@/components/ui/controls";
import { Alert, buttonCls } from "@/components/ui/primitives";
import { formatMoney, parseDollarsToCents } from "@/lib/format";

// D-2 / D-23 — THE OFFER, AT THE MOMENT THE MONEY CROSSES THE TABLE.
//
// This is where "deduct it from their payout", chosen weeks ago when the
// member was added to the cycle, finally resurfaces. Before this existed the
// decision was recorded and then silently lost.
//
// THREE THINGS THIS COMPONENT MUST NEVER DO:
//   1. Deduct anything on mount. It only ever loads an offer.
//   2. Treat the pre-tick as consent. Pre-ticked means "we remembered what you
//      said"; the organizer still presses the button.
//   3. Hide where the pre-tick came from. The origin sentence is shown, so a
//      tick nobody remembers setting is never a mystery.
//
// It is deliberately separate from the collect panel's own confirm: the payout
// and the balance are two different pieces of money, and merging them into one
// button would make the deduction a side effect of handing over cash.

export function CarryDeductionOffer({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; offer: CarryOffer; name: string } | { status: "hidden" }
  >({ status: "loading" });
  const [ticked, setTicked] = useState(false);
  const [dollars, setDollars] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void payoutCarryOffer({ payoutId }).then((result) => {
      if (!live) return;
      if (!result.ok || result.data.offer.kind === "none") {
        // Nothing owed, or nothing left to take it from — say nothing rather
        // than show an empty panel about money that does not exist.
        setState({ status: "hidden" });
        return;
      }
      const offer = result.data.offer;
      setState({ status: "ready", offer, name: result.data.personName });
      // The remembered decision pre-ticks the box. It does not press it.
      setTicked(offer.preTicked);
      setDollars(String(offer.suggested / 100));
    });
    return () => {
      live = false;
    };
  }, [payoutId]);

  if (state.status !== "ready" || state.offer.kind !== "offer") return null;
  const offer = state.offer;
  const cents = parseDollarsToCents(dollars);
  const valid = cents !== null && cents >= 1 && cents <= offer.maxDeductible;

  return (
    <div className="mt-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/25 p-3">
      {msg && (
        <div className="mb-2">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => {
            setTicked(e.target.checked);
            setMsg(null);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-amber-700"
          style={{ touchAction: "manipulation" }}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-amber-900 dark:text-amber-200">
            {state.name} carries {formatMoney(offer.balance)} — take it from this payout?
          </span>
          {/* Where the tick came from. Never a mystery pre-selection. */}
          {offer.origin && (
            <span className="mt-0.5 block text-xs text-amber-900/80 dark:text-amber-200/80">
              {offer.origin}
            </span>
          )}
          <span className="mt-0.5 block text-xs text-amber-900/80 dark:text-amber-200/80">
            Nothing is deducted until you press the button below. Leave it unticked to hand over
            the full amount.
          </span>
        </span>
      </label>

      {ticked && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-amber-200 dark:border-amber-900 pt-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-amber-900 dark:text-amber-200">
              How much
            </span>
            <AmountInput
              value={dollars}
              onChange={(v) => {
                setDollars(v);
                setMsg(null);
              }}
              ariaLabel={`Amount of ${state.name}'s carried balance to deduct, in dollars`}
              className="w-32"
              placeholder={String(offer.suggested / 100)}
            />
          </label>
          <p className="text-xs tabular-nums text-amber-900 dark:text-amber-200">
            They receive{" "}
            <strong>{formatMoney(Math.max(0, offer.balance + offer.netIfApplied - (cents ?? 0)))}</strong>
            {" · "}balance left{" "}
            <strong>{formatMoney(Math.max(0, offer.balance - (cents ?? 0)))}</strong>
          </p>
          <button
            type="button"
            disabled={pending || !valid}
            onClick={() =>
              start(async () => {
                if (cents === null) return;
                setMsg(null);
                const result = await deductCarryFromPayout({
                  payoutId,
                  amount: cents,
                  // The organizer pressed THIS button. The value comes from the
                  // press, never from the remembered intention (D-23).
                  confirmedByOrganizer: ticked,
                });
                if (!result.ok) {
                  setMsg({ kind: "err", text: result.error });
                  return;
                }
                setMsg({
                  kind: "ok",
                  text:
                    `✓ ${formatMoney(result.data.deducted)} taken from the payout — ` +
                    `${formatMoney(result.data.balanceAfter)} still carried.`,
                });
                setState({ status: "hidden" });
                router.refresh();
              })
            }
            className={buttonCls.primary + " !px-3 !py-2 !text-xs"}
            style={{ minHeight: "40px" }}
          >
            {pending ? "Recording…" : `Deduct ${cents !== null ? formatMoney(cents) : ""}`}
          </button>
          {!valid && dollars.trim() !== "" && (
            <p className="basis-full text-xs font-semibold text-red-700 dark:text-red-400">
              Enter an amount between {formatMoney(1)} and {formatMoney(offer.maxDeductible)}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
