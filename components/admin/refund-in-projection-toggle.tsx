"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRefundCountedInProjection } from "@/app/actions/cycle-position";
import { SaveFeedback, type SaveState } from "@/components/ui/save-button";

// COUNT IT, OR HANDLE IT YOURSELF.
//
// The narrowest control on the money screens, and deliberately so: it moves
// one figure in one sum and does nothing else. It cannot forgive the debt,
// change what is owed, or take a name off a list — what he owes stays on this
// row, on the member's own page and in her portal whichever way it is set.
//
// SAYING SO IS PART OF THE CONTROL. A switch that quietly removed an
// obligation from a total, on a page whose whole job is to be trusted, would
// be worse than no switch. The label under it states what the choice does not
// do, every time, rather than relying on the organizer to remember.

export function RefundInProjectionToggle({
  participationId,
  name,
  amount,
  counted,
  formattedAmount,
}: {
  participationId: string;
  name: string;
  amount: number;
  counted: boolean;
  formattedAmount: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(counted);
  const [pending, start] = useTransition();
  // THE SHARED FEEDBACK STATE, beside the control that produced it
  // (UI_STANDARDS rule 6). A hand-placed message here would be the page-banner
  // failure at a smaller scale: this control sits in a list, so a refusal
  // rendered anywhere but next to the row that caused it names the wrong
  // member.
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  function choose(next: boolean) {
    if (next === on || pending) return;
    // Optimistic, because the choice is instant and reversible and waiting on
    // a round trip to see a switch move reads as a broken switch.
    setOn(next);
    setSave({ kind: "saving" });
    start(async () => {
      const res = await setRefundCountedInProjection({ participationId, counted: next });
      if (!res.ok) {
        setOn(!next);
        setSave({ kind: "err", message: `Not saved: ${res.error}` });
        return;
      }
      setSave({
        kind: "ok",
        message: next
          ? `${formattedAmount} owed to ${name} is counted below.`
          : `${formattedAmount} owed to ${name} is left out of the sum. It is still owed.`,
      });
      router.refresh();
    });
  }

  const label = `What you owe ${name}, ${formattedAmount}`;

  return (
    <div className="space-y-1">
      <div
        role="radiogroup"
        aria-label={`${label}: count it in the projection, or handle it yourself`}
        className="inline-flex items-center gap-0.5 rounded-xl border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-white/5"
      >
        {[
          { value: true, label: "Counted", hint: "in the projection below" },
          { value: false, label: "By hand", hint: "left out of the projection" },
        ].map((opt) => {
          const active = on === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => choose(opt.value)}
              title={opt.hint}
              className={`inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold transition-[background-color,color] duration-150 ease-out disabled:opacity-60 md:min-h-8 ${
                active
                  ? "bg-white text-indigo-700 shadow-sm dark:bg-[#1f1f1f] dark:text-indigo-300"
                  : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-600 dark:text-gray-400">
        {on
          ? `${formattedAmount} is in the money going out below.`
          : `Still owed to ${name} and still on their record. It is only left out of the sum below.`}
      </p>
      <SaveFeedback state={save} />
      <span className="sr-only">{amount}</span>
    </div>
  );
}
