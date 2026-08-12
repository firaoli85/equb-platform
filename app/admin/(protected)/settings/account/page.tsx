import { listMySessions } from "@/app/actions/sessions";
import { SessionList } from "@/components/session-list";
import { TruncationNotice } from "@/components/ui/pager";
import { Alert } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  // Ruling 4: the organizer gets the same view of his own sessions that a
  // member gets of theirs — same component, same "sign out everywhere else".
  const sessions = await listMySessions();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">
          Where you are signed in
        </h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Every device currently signed in as the organizer. If you see one you do not
          recognise — an old laptop, a borrowed machine — sign it out here and change your
          password.
        </p>
      </section>

      {!sessions.ok ? (
        <Alert kind="err">{sessions.error}</Alert>
      ) : (
        <>
          {/* A capped list must say it was cut (lib/paging.ts). */}
          <TruncationNotice notice={sessions.notice} />
          <SessionList sessions={sessions.data} now={Date.now()} />
        </>
      )}
    </div>
  );
}
