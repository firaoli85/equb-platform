import { listPeople } from "@/app/actions/people";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";
import { defaultPinForPhone } from "@/lib/pin";
import { getSetting } from "@/lib/settings";
import { AddPersonForm } from "./add-person-form";
import { PeopleDirectory, type DirectoryRow } from "./people-directory";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  // The directory is names and phones (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Member directory" />;
  const { q } = await searchParams;
  const query = Array.isArray(q) ? q[0] : q;
  const result = await listPeople(query);
  const defaultPinOn = await getSetting("defaultPinFromPhone");

  const now = new Date();
  const rows: DirectoryRow[] = result.ok
    ? result.data.map((p) => ({
        id: p.id,
        nameAmharic: p.nameAmharic,
        nameEnglish: `${p.nameEnglishFirst} ${p.nameEnglishLast ?? ""}`.trim(),
        phone: p.phone,
        contributedThisCycle: p.contributedThisCycle,
        pinState:
          p.pinHash !== null
            ? ("own" as const)
            : defaultPinOn && defaultPinForPhone(p.phone) !== null
              ? ("default" as const)
              : ("none" as const),
        lockedMinutesLeft:
          p.pinLockedUntil !== null && p.pinLockedUntil > now
            ? Math.max(1, Math.ceil((p.pinLockedUntil.getTime() - now.getTime()) / 60_000))
            : null,
        cycles:
          p.participations.length === 0
            ? "Not in any cycle yet"
            : p.participations
                .map((pt) => `${pt.cycle.name}${pt.cycle.status === "ACTIVE" ? " (active)" : ""}`)
                .join(", "),
        inActiveCycle: p.participations.some((pt) => pt.cycle.status === "ACTIVE"),
      }))
    : [];

  return (
    <main className="space-y-5">
      <header className="animate-fade-in-up">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Member directory</h1>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
          Everyone, forever (2.5) — participation belongs to cycles, people belong here.
        </p>
      </header>

      <form action="/admin/people" className="flex gap-2 animate-fade-in-up-1">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by name or phone"
          className="w-72 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-4 py-2 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97]"
        >
          Search
        </button>
      </form>

      {!result.ok ? (
        <Alert kind="err">{result.error}</Alert>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {query ? `No one matches “${query}”.` : "The directory is empty."}
        </p>
      ) : (
        <PeopleDirectory rows={rows} />
      )}

      <Card className="max-w-md animate-fade-in-up-2">
        <CardHeader title="Add a person to the directory" />
        <div className="px-5 pb-5">
          <AddPersonForm />
        </div>
      </Card>
    </main>
  );
}
