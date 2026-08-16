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

// THE WHEEL'S PALETTE — lamplight on dark wood.
//
// An equb draw happens in somebody's living room, and this screen is projected
// onto the wall of it. The six colours here were SIX GREYS (#1f2937 through
// #52525b), which is what a chart looks like, not what a ceremony looks like —
// and on a projector, greys that close together collapse into one dark disc.
//
// COOL AND WARM ALTERNATE, deliberately. Adjacent segments are guaranteed to
// contrast whatever the slot count is, which flat-grey rotation could not
// promise: with seven slots the old palette put #374151 beside #4b5563 and the
// boundary disappeared at four metres.
//
// Deep indigo is the platform's own accent, carried here so the draw screen
// belongs to the same product; the warm side is lamp-brown and gold rather than
// a second bright hue, because one loud colour on a wall is a celebration and
// two is a carnival.
const COLORS = [
  "#1e1b4b", // indigo, deepest
  "#4a2c0a", // lamp brown
  "#312e81", // indigo
  "#7c4a11", // amber, deep
  "#3730a3", // indigo, lifted
  "#8a5a16", // amber, lifted
];

/** Cream, not white — it sits warmer on both families and hurts less on a wall. */
const NUMBER_INK = "#fef7e7";
/** The rim, the pointer and the hub. The one bright note on the screen. */
const GOLD = "#e0a92e";

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
      {/* THE WHEEL SIZES ITSELF TO THE ROOM.
          It was a hard 480px inside a centred column, so on a laptop the week
          control and the SPIN button squeezed it off its own screen — which is
          exactly what "it covers the wheel" was. `vmin` keeps it whole on any
          projector, portrait or landscape, and it never grows past the size it
          was designed at. */}
      <div className="relative" style={{ width: "min(480px, 68vmin)", height: "min(480px, 68vmin)" }}>
        {/* THE POINTER, which was a CSS border triangle in bare red. It is the
            one thing on screen that says "here" — drawn properly, in the same
            gold as the rim, with a dark outline so it holds against a light
            segment as well as a dark one. */}
        <svg
          viewBox="0 0 32 30"
          className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1"
          style={{ width: 30, height: 28, filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.55))" }}
          aria-hidden="true"
        >
          <path d="M16 29 L3 4 A2 2 0 0 1 6 1 L26 1 A2 2 0 0 1 29 4 Z" fill={GOLD} stroke="#3b2a06" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <svg
          width="100%"
          height="100%"
          viewBox="-1.12 -1.12 2.24 2.24"
          onTransitionEnd={handleLanded}
          className={phase === "spinning" ? "animate-spin" : ""}
          style={{
            transform: phase === "spinning" ? undefined : `rotate(${rotation}deg)`,
            transition:
              phase === "landing" ? "transform 4.5s cubic-bezier(0.12, 0.8, 0.2, 1)" : undefined,
            animationDuration: phase === "spinning" ? "0.5s" : undefined,
          }}
        >
          <defs>
            {/* DEPTH, so it reads as a DISC rather than a pie chart. A payout
                is physical cash handed across a room; the object that decides
                it should look like an object. Light falls from the hub, the rim
                falls away — one gradient, reused by every segment. */}
            <radialGradient id="wheel-depth" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
              <stop offset="62%" stopColor="#fff" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
            </radialGradient>
            <radialGradient id="hub-shine" cx="38%" cy="34%" r="72%">
              <stop offset="0%" stopColor="#fff7e2" />
              <stop offset="100%" stopColor={GOLD} />
            </radialGradient>
          </defs>

          {slots.map((slot, i) => {
            const start = ((i * segmentAngle - 90) * Math.PI) / 180;
            const end = (((i + 1) * segmentAngle - 90) * Math.PI) / 180;
            const largeArc = segmentAngle > 180 ? 1 : 0;
            const mid = (start + end) / 2;
            const d = `M 0 0 L ${Math.cos(start)} ${Math.sin(start)} A 1 1 0 ${largeArc} 1 ${Math.cos(end)} ${Math.sin(end)} Z`;
            return (
              <g key={slot.id}>
                <path d={d} fill={COLORS[i % COLORS.length]} />
                {/* The divider is a HAIRLINE IN THE GROUND COLOUR, not the white
                    rule it was. White spokes on a dark disc read as a cut-up
                    chart; a dark seam reads as one turned object. */}
                <path
                  d={d}
                  fill="url(#wheel-depth)"
                  stroke="#0b0a14"
                  strokeWidth="0.006"
                  strokeOpacity="0.7"
                />
                <text
                  x={Math.cos(mid) * 0.7}
                  y={Math.sin(mid) * 0.7}
                  fill={NUMBER_INK}
                  fontSize={count > 12 ? 0.085 : 0.115}
                  fontWeight={700}
                  letterSpacing="0.004"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  // THE NUMBERS ARE THE ONLY IDENTITY 2.4 ALLOWS on this screen,
                  // so they are the typography that matters. Bigger, heavier,
                  // and carrying their own shadow so they hold on every segment
                  // and survive a projector's contrast loss.
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    paintOrder: "stroke",
                    stroke: "#0b0a14",
                    strokeWidth: 0.022,
                    strokeOpacity: 0.55,
                    strokeLinejoin: "round",
                  }}
                  transform={`rotate(${(mid * 180) / Math.PI + 90} ${Math.cos(mid) * 0.7} ${Math.sin(mid) * 0.7})`}
                >
                  {slot.numbers.map((n) => `#${n}`).join(" ")}
                </text>
              </g>
            );
          })}

          {/* THE RIM — the one bright note, and what turns a shape into a
              wheel. Drawn after the segments so it caps their edges cleanly. */}
          <circle r="1" fill="none" stroke={GOLD} strokeWidth="0.035" />
          <circle r="1" fill="none" stroke="#0b0a14" strokeWidth="0.008" strokeOpacity="0.5" />
          <circle r="0.955" fill="none" stroke="#fff" strokeWidth="0.006" strokeOpacity="0.14" />

          {/* The hub, lit from the same direction as the segments. */}
          <circle r="0.105" fill="url(#hub-shine)" stroke="#3b2a06" strokeWidth="0.012" />
        </svg>
      </div>

      {phase === "idle" && (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={spin}
            className="rounded-full px-14 py-4 text-xl font-black tracking-[0.2em] text-[#2a1c04] shadow-[0_6px_20px_-4px_rgba(224,169,46,0.5)] transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none"
            style={{ background: `linear-gradient(180deg, #f6d78a 0%, ${GOLD} 100%)` }}
          >
            SPIN
          </button>
          {/* A spin refusal — "This week has already been drawn.", "No active
              cycle." — renders under the button that was pressed (rule 6b). */}
          <SaveFeedback state={save} />
        </div>
      )}

      {(phase === "spinning" || phase === "landing") && (
        // NOT A SPINNER. The wheel IS the loading state, and a second moving
        // thing beside it competes with the only object anyone is watching.
        <p className="text-lg tracking-[0.35em] text-amber-200/50">• • •</p>
      )}

      {phase === "landed" && winner && (
        <div className="flex flex-col items-center gap-4">
          {/* THE NUMBER IS THE MOMENT. It was 3xl semi-bold in default ink on
              a screen full of people waiting for exactly this. It arrives from
              0.96 rather than from nothing — things do not appear out of
              nowhere — and holds still afterwards. */}
          <p
            className="text-5xl font-black tracking-wide text-amber-100 tabular-nums motion-safe:animate-[winner-in_260ms_cubic-bezier(0.23,1,0.32,1)]"
            style={{ textShadow: "0 2px 18px rgba(224,169,46,0.45)" }}
          >
            {numberLabels(winner.numbers, "  ")}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              aria-busy={busy}
              className="rounded-xl px-7 py-2.5 font-bold text-[#2a1c04] transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-40 motion-reduce:transition-none"
              style={{ background: `linear-gradient(180deg, #f6d78a 0%, ${GOLD} 100%)` }}
            >
              {busy ? "Recording…" : "Confirm & Record"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="rounded-xl border border-white/25 px-7 py-2.5 font-semibold text-amber-50/80 transition-[background-color,transform] duration-150 ease-out hover:bg-white/5 active:scale-[0.97] disabled:opacity-40 motion-reduce:transition-none"
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
          <p className="text-4xl font-black tracking-wide text-emerald-300 tabular-nums">
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
