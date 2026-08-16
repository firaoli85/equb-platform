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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <BackArrow />
      {/* THE HEADING BECAME THE CONTROL. It read "Week 10" and could not be
          changed; it is now the same line, choosable. See week-picker.tsx for
          why it is one select and nothing more. */}
      <WeekPicker weeks={result.data.weeks} selectedWeekId={result.data.weekId} />
      {result.data.alreadyDrawn && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This week has already been drawn. Spinning adds another winner to it.
        </p>
      )}
      <DrawWheel weekId={result.data.weekId} slots={result.data.slots} />
    </main>
  );
}
