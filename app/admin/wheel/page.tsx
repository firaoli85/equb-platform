import Link from "next/link";
import { getDrawScreen } from "@/app/actions/wheel";
import { DrawWheel } from "./draw-wheel";
import { WeekPicker } from "./week-picker";

export const dynamic = "force-dynamic";

// A plain arrow, nothing else (2.4): the one way back to the admin. It
// carries no words, no names, no money — safe on a shared screen.
function BackArrow() {
  return (
    <Link
      href="/admin"
      aria-label="Back to the admin"
      className="fixed left-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full text-gray-400 opacity-40 transition-[opacity,background-color,transform] duration-150 ease-out hover:bg-gray-500/10 hover:opacity-100 active:scale-[0.95]"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M12.5 4L6.5 10L12.5 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

// THE DRAW SCREEN (2.4) — screen-shared on Zoom. Nothing here but the wheel,
// the week, and SPIN. No settings, no navigation, no names, no amounts, no
// plans. The winner was configured beforehand on the setup page.
export default async function WheelPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const query = await searchParams;
  const week = Array.isArray(query.week) ? query.week[0] : query.week;
  const result = await getDrawScreen({ weekId: week });

  if (!result.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <BackArrow />
        <p className="text-lg text-gray-600">{result.error}</p>
      </main>
    );
  }

  return (
    // THE STAGE. This screen is projected on a wall while a room watches, and
    // it was rendering on the app's ordinary white page — a form background
    // behind a ceremony. Dark ground makes the wheel the only lit object and
    // survives a projector's washed-out contrast; the two faint pools of warm
    // light place it in a room rather than on a slide.
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0b0a14] text-amber-50">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 32%, rgba(224,169,46,0.10) 0%, transparent 70%)," +
            "radial-gradient(70% 60% at 50% 108%, rgba(67,56,202,0.18) 0%, transparent 70%)",
        }}
      />
      <BackArrow />

      {/* THE WEEK SITS ABOVE THE WHEEL AS CHROME, not in its column.
          It was a text-2xl select stacked in the same centred flex as a fixed
          480px wheel, so on a laptop the two fought for the same vertical
          space and the wheel lost — "it covers the wheel". Pinned to the top,
          it cannot crowd anything, and the wheel gets the whole middle.

          POINTER-EVENTS-NONE, BECAUSE PINNING IT HERE PARKED IT ON THE EXIT.
          `inset-x-0 top-0` makes this a full-viewport-width strip 66px deep
          (88px with the drawn line), and `z-20` puts it over the back arrow's
          `z-10` at left-4 top-4. A transparent background still hit-tests, so
          the strip swallowed every click on the arrow — the ONE way off this
          screen, on a route that sits outside the admin shell and has no nav
          of its own. Confirmed dead at 390, 1440 and 1920: elementFromPoint at
          the arrow's centre returned this div at every width.

          The strip is a layout box, not a surface. It should never have
          received a click, and now it does not — the two other overlays on
          this page, the light pools above and the caret in the picker, were
          already written this way. Only the control inside takes clicks back
          (pointer-events-auto on the label in week-picker.tsx). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-1.5 px-4 pt-5">
        <WeekPicker weeks={result.data.weeks} selectedWeekId={result.data.weekId} />
        {result.data.alreadyDrawn && (
          <p className="text-xs text-amber-200/60">
            Already drawn. Spinning adds another winner to this week.
          </p>
        )}
      </div>

      <div className="relative z-10">
        <DrawWheel weekId={result.data.weekId} slots={result.data.slots} />
      </div>
    </main>
  );
}
