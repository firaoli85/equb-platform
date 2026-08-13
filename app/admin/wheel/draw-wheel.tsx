"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { recordDraw, spinWheel } from "@/app/actions/wheel";
import { SaveFeedback, type SaveState } from "@/components/ui/save-button";

// The wheel itself. The server decides the winner; this component only
// animates to the slot it was told. It starts spinning BEFORE the server
// responds, so nothing on screen ever previews the outcome (2.4).

// SPIN IS EXEMPT FROM SaveButton — it writes no record the organizer is
// editing, and its success is the ANIMATION: the wheel turning and stopping
// on a slot is the confirmation, in front of the whole Equb on Zoom. A
// "✓ Saved" beside SPIN would be a second, smaller claim about the same
// event. Its REFUSAL is not exempt (rule 6b): "This week has already been
// drawn." must render at the SPIN button, which is what `SaveFeedback` in
// the idle block does.
//
// "Confirm & Record" IS the save — it creates the draw, the payouts and the
// winner's settlement — so it takes the full save shape: one `SaveState`,
// "Recording…" on the button, and the confirmation and the refusal both
// rendered where the button was pressed.
//
// The two controls are never on screen together (`phase` decides which), so
// they share one state: whichever is showing is the one that was pressed.

type WheelSlot = { id: string; numbers: number[] };

const COLORS = ["#1f2937", "#4b5563", "#6b7280", "#374151", "#111827", "#52525b"];

/** "#3 #7" — the only identity 2.4 allows on the projected screen. */
function numberLabels(numbers: number[], gap = " ") {
  return numbers.map((n) => `#${n}`).join(gap);
}

export function DrawWheel({ weekId, slots }: { weekId: string; slots: WheelSlot[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "spinning" | "landing" | "landed" | "recorded">("idle");
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState<WheelSlot | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  // DERIVED, never a second flag: the button label, the disabled Cancel and
  // the re-entry guard all read the same fact from the same place.
  const busy = save.kind === "saving";
  const spinStart = useRef(0);

  const count = slots.length;
  const segmentAngle = count > 0 ? 360 / count : 360;

  async function spin() {
    if (phase !== "idle" || count === 0) return;
    setSave({ kind: "idle" });
    setPhase("spinning");
    spinStart.current = Date.now();

    // EVERY EXIT PUTS THE WHEEL BACK TO `idle` AND SAYS WHY. A refusal that
    // left `phase` at "spinning" would leave the wheel turning for ever in
    // front of the whole Equb, with no reason on screen and no way back but
    // a reload — the 6b failure at its most public.
    try {
      const result = await spinWheel({ weekId });
      if (!result.ok) {
        setPhase("idle");
        setSave({ kind: "err", message: `Not spun: ${result.error}` });
        return;
      }
      const index = slots.findIndex((s) => s.id === result.data.slotId);
      if (index < 0) {
        setPhase("idle");
        setSave({
          kind: "err",
          message: "Not spun: the wheel changed — reload and spin again.",
        });
        return;
      }
      // Land the chosen segment under the pointer (top). Several full turns,
      // plus a random offset within the segment so the stop looks natural.
      const withinSegment = (0.2 + Math.random() * 0.6) * segmentAngle;
      const target =
        360 * 6 + (360 - (index * segmentAngle + withinSegment));
      setWinner(slots[index]);
      setPhase("landing");
      // Force a reflow-free transition start on the next frame.
      requestAnimationFrame(() => setRotation(target));
    } catch {
      setPhase("idle");
      setSave({
        kind: "err",
        message: "Not spun: could not reach the server. Nothing was drawn — spin again.",
      });
    }
  }

  function handleLanded() {
    if (phase === "landing") setPhase("landed");
  }

  async function confirm() {
    if (!winner || busy) return;
    setSave({ kind: "saving" });
    try {
      const result = await recordDraw({ weekId, slotId: winner.id });
      if (!result.ok) {
        // Stays on "landed": the winner is still on screen and Confirm can be
        // pressed again without re-spinning (beat 4 — the state is intact).
        setSave({ kind: "err", message: `Not recorded: ${result.error}` });
        return;
      }
      // WHAT WAS RECORDED, IN THE SERVER'S OWN FIGURES — the week and the
      // numbers come back from `recordDraw`, not from the slot this component
      // animated to, so the confirmation states what the books now say. No
      // name and no amount: this screen is projected (2.4).
      setSave({
        kind: "ok",
        message: `Recorded — week ${result.data.weekNumber} goes to ${numberLabels(result.data.numbers)}.`,
      });
      setPhase("recorded");
      router.refresh();
    } catch {
      setSave({
        kind: "err",
        message: "Not recorded: could not reach the server. Try again.",
      });
    }
  }

  function cancel() {
    setPhase("idle");
    setWinner(null);
    setRotation(0);
    setSave({ kind: "idle" });
  }

  if (count === 0) {
    return <p className="text-lg text-gray-600">The wheel is empty.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative">
        {/* Pointer */}
        <div
          className="absolute left-1/2 top-0 z-10 -translate-x-1/2"
          style={{ width: 0, height: 0, borderLeft: "14px solid transparent", borderRight: "14px solid transparent", borderTop: "26px solid #dc2626" }}
        />
        <svg
          width="480"
          height="480"
          viewBox="-1.05 -1.05 2.1 2.1"
          onTransitionEnd={handleLanded}
          className={phase === "spinning" ? "animate-spin" : ""}
          style={{
            transform: phase === "spinning" ? undefined : `rotate(${rotation}deg)`,
            transition:
              phase === "landing" ? "transform 4.5s cubic-bezier(0.12, 0.8, 0.2, 1)" : undefined,
            animationDuration: phase === "spinning" ? "0.5s" : undefined,
          }}
        >
          {slots.map((slot, i) => {
            const start = ((i * segmentAngle - 90) * Math.PI) / 180;
            const end = (((i + 1) * segmentAngle - 90) * Math.PI) / 180;
            const largeArc = segmentAngle > 180 ? 1 : 0;
            const mid = (start + end) / 2;
            return (
              <g key={slot.id}>
                <path
                  d={`M 0 0 L ${Math.cos(start)} ${Math.sin(start)} A 1 1 0 ${largeArc} 1 ${Math.cos(end)} ${Math.sin(end)} Z`}
                  fill={COLORS[i % COLORS.length]}
                  stroke="#fff"
                  strokeWidth="0.008"
                />
                <text
                  x={Math.cos(mid) * 0.72}
                  y={Math.sin(mid) * 0.72}
                  fill="#fff"
                  fontSize={count > 12 ? 0.07 : 0.1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${(mid * 180) / Math.PI + 90} ${Math.cos(mid) * 0.72} ${Math.sin(mid) * 0.72})`}
                >
                  {slot.numbers.map((n) => `#${n}`).join(" ")}
                </text>
              </g>
            );
          })}
          <circle r="0.08" fill="#fff" stroke="#111" strokeWidth="0.01" />
        </svg>
      </div>

      {phase === "idle" && (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={spin}
            className="rounded-full bg-black px-12 py-4 text-xl font-semibold text-white"
          >
            SPIN
          </button>
          {/* A spin refusal — "This week has already been drawn.", "No active
              cycle." — renders under the button that was pressed (rule 6b). */}
          <SaveFeedback state={save} />
        </div>
      )}

      {(phase === "spinning" || phase === "landing") && (
        <p className="text-xl text-gray-500">…</p>
      )}

      {phase === "landed" && winner && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-3xl font-bold">{numberLabels(winner.numbers, "  ")}</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              aria-busy={busy}
              className="rounded bg-black px-6 py-2 font-medium text-white disabled:opacity-40"
            >
              {busy ? "Recording…" : "Confirm & Record"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="rounded border border-gray-400 px-6 py-2"
            >
              Cancel
            </button>
          </div>
          {/* A refusal from `recordDraw` — the one-draw-per-week clash, or the
              neutral "check the wheel setup page" this PROJECTED screen is
              deliberately limited to (2.4, audit H3a) — under the two buttons,
              with the winner and the Confirm press both intact (rule 6b). */}
          <SaveFeedback state={save} />
        </div>
      )}

      {phase === "recorded" && winner && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-2xl font-semibold text-green-700">
            {numberLabels(winner.numbers, "  ")}
          </p>
          {/* The confirmation stands where the Confirm button stood, and says
              what was written. The hand-rolled "✓" that used to prefix the
              numbers is gone — `SaveFeedback` renders the tick and the
              sentence, and two success marks for one write is two claims. */}
          <SaveFeedback state={save} />
        </div>
      )}
    </div>
  );
}
