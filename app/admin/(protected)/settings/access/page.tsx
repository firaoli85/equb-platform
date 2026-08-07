import { getPlatformSettings } from "@/app/actions/settings";
import { PresentationToggle } from "@/components/presentation-toggle";
import { Alert } from "@/components/ui/primitives";
import { AccessForm } from "./access-form";

export const dynamic = "force-dynamic";

export default async function AccessSettingsPage() {
  const result = await getPlatformSettings();
  if (!result.ok) return <Alert kind="err">{result.error}</Alert>;

  return (
    <div className="space-y-6">
      {/* Presentation mode lives here rather than under "Cycle rules" because
          it decides what LEAVES the server — the same question as every other
          row on this page. It is also in the header of every admin screen; this
          is where it gets the space to explain itself. */}
      <section
        className={`rounded-2xl border p-5 ${
          result.data.presentationMode
            ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
            : "border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414]"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              Presentation mode
            </h2>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              Turn on before screen-sharing a draw (2.4). Member names, winner plans, money,
              phone numbers and the audit log are removed from what the server{" "}
              <strong>sends</strong> — not hidden with CSS, so nothing sensitive is one
              inspector-click away. Lucky numbers, weeks and everything needed to run the draw
              stay visible.
            </p>
            <p className="mt-2 text-sm font-semibold">
              {result.data.presentationMode ? (
                <span className="text-amber-800 dark:text-amber-400">ON — safe to share</span>
              ) : (
                <span className="text-gray-700 dark:text-gray-300">
                  off — everything is visible
                </span>
              )}
            </p>
          </div>
          <PresentationToggle on={result.data.presentationMode} />
        </div>
      </section>

      <AccessForm initial={result.data} />
    </div>
  );
}
