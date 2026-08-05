"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { recordDraw, spinWheel } from "@/app/actions/wheel";

// The wheel itself. The server decides the winner; this component only
// animates to the slot it was told. It starts spinning BEFORE the server
// responds, so nothing on screen ever previews the outcome (2.4).

type WheelSlot = { id: string; numbers: number[] };

const COLORS = ["#1f2937", "#4b5563", "#6b7280", "#374151", "#111827", "#52525b"];

export function DrawWheel({ weekId, slots }: { weekId: string; slots: WheelSlot[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "spinning" | "landing" | "landed" | "recorded">("idle");
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState<WheelSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const spinStart = useRef(0);

  const count = slots.length;
  const segmentAngle = count > 0 ? 360 / count : 360;

  async function spin() {
    if (phase !== "idle" || count === 0) return;
    setError(null);
    setPhase("spinning");
    spinStart.current = Date.now();

    const result = await spinWheel({ weekId });
    if (!result.ok) {
      setPhase("idle");
      setError(result.error);
      return;
    }
    const index = slots.findIndex((s) => s.id === result.data.slotId);
    if (index < 0) {
      setPhase("idle");
      setError("The wheel changed — reload and spin again.");
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
  }

  function handleLanded() {
    if (phase === "landing") setPhase("landed");
  }

  async function confirm() {
    if (!winner || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recordDraw({ weekId, slotId: winner.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPhase("recorded");
      router.refresh();
    } catch {
      setError("Not recorded — try again.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setPhase("idle");
    setWinner(null);
    setRotation(0);
    setError(null);
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
        <button
          type="button"
          onClick={spin}
          className="rounded-full bg-black px-12 py-4 text-xl font-semibold text-white"
        >
          SPIN
        </button>
      )}

      {(phase === "spinning" || phase === "landing") && (
        <p className="text-xl text-gray-500">…</p>
      )}

      {phase === "landed" && winner && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-3xl font-bold">
            {winner.numbers.map((n) => `#${n}`).join("  ")}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
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
        </div>
      )}

      {phase === "recorded" && winner && (
        <p className="text-2xl font-semibold text-green-700">
          ✓ {winner.numbers.map((n) => `#${n}`).join("  ")}
        </p>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
