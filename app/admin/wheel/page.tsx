import Link from "next/link";
import { getDrawScreen } from "@/app/actions/wheel";
import { DrawWheel } from "./draw-wheel";

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
export default async function WheelPage() {
  const result = await getDrawScreen();

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
      <h1 className="text-2xl font-semibold">Week {result.data.weekNumber}</h1>
      <DrawWheel weekId={result.data.weekId} slots={result.data.slots} />
    </main>
  );
}
