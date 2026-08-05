import { getPlatformSettings } from "@/app/actions/settings";
import { PresentationToggle } from "@/components/presentation-toggle";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const result = await getPlatformSettings();

  return (
    <main>
      <h1 className="mb-6 text-xl font-semibold">Platform settings</h1>
      {!result.ok ? (
        <p role="alert" className="text-sm text-red-800">
          {result.error}
        </p>
      ) : (
        <div className="max-w-md space-y-8">
          <section className="rounded border border-gray-300 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Presentation mode</h2>
              <PresentationToggle on={result.data.presentationMode} />
            </div>
            <p className="text-sm text-gray-700">
              Turn on before screen-sharing (2.4). Member names, winner plans, money, phone
              numbers, and the audit log are removed from what the server sends — across the
              whole admin, not just hidden on screen. Lucky numbers, weeks, and everything
              needed to run a draw stay visible. The same switch sits in the header of every
              admin page.
            </p>
            <p className="mt-2 text-sm text-gray-700">
              Currently:{" "}
              <strong>{result.data.presentationMode ? "ON — safe to share" : "off"}</strong>
            </p>
          </section>

          <SettingsForm initial={result.data} />
        </div>
      )}
    </main>
  );
}
