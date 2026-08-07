import { getPlatformSettings } from "@/app/actions/settings";
import { listMySessions } from "@/app/actions/sessions";
import { PresentationToggle } from "@/components/presentation-toggle";
import { SessionList } from "@/components/session-list";
import { SessionPolicyForm } from "./session-policy-form";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const result = await getPlatformSettings();
  // Ruling 4: the organizer gets the same view of his own sessions that a
  // member gets of theirs — same component, same "sign out everywhere else".
  const sessions = await listMySessions();

  return (
    <main>
      <h1 className="mb-6 text-xl font-semibold">Platform settings</h1>
      {!result.ok ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-400">
          {result.error}
        </p>
      ) : (
        <div className="max-w-md space-y-8">
          <section className="rounded border border-gray-300 dark:border-gray-700 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Presentation mode</h2>
              <PresentationToggle on={result.data.presentationMode} />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Turn on before screen-sharing (2.4). Member names, winner plans, money, phone
              numbers, and the audit log are removed from what the server sends — across the
              whole admin, not just hidden on screen. Lucky numbers, weeks, and everything
              needed to run a draw stay visible. The same switch sits in the header of every
              admin page.
            </p>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Currently:{" "}
              <strong>{result.data.presentationMode ? "ON — safe to share" : "off"}</strong>
            </p>
          </section>

          <SettingsForm initial={result.data} />

          <SessionPolicyForm initial={result.data} />

          <section className="rounded border border-gray-300 dark:border-gray-700 p-4">
            <h2 className="text-base font-semibold">Where you are signed in</h2>
            <p className="mb-3 mt-1 text-sm text-gray-700 dark:text-gray-300">
              Every device currently signed in as the organizer. If you see one you do not
              recognise — an old laptop, a borrowed machine — sign it out here and change your
              password.
            </p>
            {!sessions.ok ? (
              <p role="alert" className="text-sm text-red-800 dark:text-red-400">
                {sessions.error}
              </p>
            ) : (
              <SessionList sessions={sessions.data} now={Date.now()} />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
