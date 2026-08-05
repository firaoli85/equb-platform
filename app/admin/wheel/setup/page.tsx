import Link from "next/link";
import { getWheelState } from "@/app/actions/wheel";
import { PresentationToggle } from "@/components/presentation-toggle";
import { getSetting } from "@/lib/settings";
import { WheelSetup } from "./wheel-setup";

export const dynamic = "force-dynamic";

// PRIVATE wheel setup (2.3/2.4): arrangement, locking, and winner planning
// happen HERE, never on the screen-shared draw page.
export default async function WheelSetupPage() {
  const result = await getWheelState();
  const presentation = await getSetting("presentationMode");

  return (
    <main className="min-h-dvh" style={{ background: "var(--page-bg)" }}>
      <div className="mx-auto max-w-5xl px-6 py-8">
      <p className="mb-4 flex items-center gap-4 text-sm">
        <Link href="/admin" className="font-semibold text-gray-600 dark:text-gray-400 hover:underline">
          ← Dashboard
        </Link>
        <Link href="/admin/wheel" className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">
          Open the draw screen
        </Link>
        <span className="ml-auto">
          <PresentationToggle on={presentation} />
        </span>
      </p>
      <h1 className="mb-1 text-xl font-black text-gray-900 dark:text-white">Wheel setup</h1>
      <p className="mb-6 text-xs text-gray-600 dark:text-gray-400">
        This page is private — never screen-share it. The draw screen shows only the wheel.
      </p>
      {!result.ok ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-400">
          {result.error}
        </p>
      ) : (
        <WheelSetup state={result.data} />
      )}
      </div>
    </main>
  );
}
