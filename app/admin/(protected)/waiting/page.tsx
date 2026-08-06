import Link from "next/link";
import { getWaiting } from "@/app/actions/waiting";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Alert } from "@/components/ui/primitives";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { WaitingView } from "./waiting-view";

export const dynamic = "force-dynamic";

// WHO IS WAITING (2.1) — the money the group owes its members, as its own
// screen. Two groups that must never be added together: what is owed NOW
// (drawn, pending) and what will be owed eventually (never drawn). Every row
// carries the action that clears it, so this is a workspace, not a report.
export default async function WaitingPage() {
  const result = await getWaiting();
  if (!result.ok) {
    if (result.error === PRESENTATION_HIDDEN) return <PresentationHidden what="Who is waiting" />;
    return (
      <main className="space-y-4">
        <Alert kind="err">{result.error}</Alert>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Dashboard
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Who is waiting
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400 text-pretty">
          What the group owes its members. Money <strong>awaiting payment</strong> is already
          committed — it has been drawn and is waiting to be handed over. People{" "}
          <strong>awaiting their turn</strong> are not owed anything yet, but nobody should finish
          paying in and receive nothing.
        </p>
      </header>

      <WaitingView data={result.data} />
    </main>
  );
}
