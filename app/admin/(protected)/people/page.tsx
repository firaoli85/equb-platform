import Link from "next/link";
import { listPeople } from "@/app/actions/people";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Alert, buttonCls } from "@/components/ui/primitives";
import { TruncationNotice } from "@/components/ui/pager";
import { CAPS, truncationNotice } from "@/lib/paging";
import { defaultPinForPhone } from "@/lib/pin";
import { getSetting } from "@/lib/settings";
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
      {/* THE ACTION IS AT THE TOP, NOT THE BOTTOM.
          Adding a member creates a person, a participation and their lucky
          numbers, and can surface a balance they carry in from an earlier
          cycle. That is not a footnote to a list — it was a form sitting 95%
          of the way down this page, under the whole directory, which is how a
          job with real consequences becomes something you scroll past. */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 animate-fade-in-up">
        <div>
          <h1 className="text-xl font-black text-gray-900 dark:text-white">Member directory</h1>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
            Everyone, forever (2.5) — participation belongs to cycles, people belong here.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
          <Link href="/admin/cycle/add" className={buttonCls.primary + " justify-center"}>
            Add a member
          </Link>
          {/* The rarer door, named as such rather than given equal weight —
              adding someone who is NOT joining is the unusual case (2.5). */}
          <Link
            href="/admin/people/new"
            className="text-xs text-gray-600 underline-offset-2 hover:underline dark:text-gray-400 sm:text-right"
          >
            Add to the directory only
          </Link>
        </div>
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
        // An empty list with the add form removed would be a dead end. The
        // header actions are still there, but an empty screen should say what
        // to do rather than leave the reader to look for it.
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {query ? `No one matches “${query}”.` : "Nobody is in the directory yet."}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-600 dark:text-gray-400">
            {query ? (
              <>
                Try a shorter search, or{" "}
                <Link href="/admin/people" className="font-semibold underline">
                  clear it
                </Link>
                .
              </>
            ) : (
              <>
                <Link href="/admin/cycle/add" className="font-semibold underline">
                  Add a member
                </Link>{" "}
                to put someone in the current cycle, which creates their directory entry at
                the same time.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <PeopleDirectory rows={rows} />
          {/* Silent only until it is actually reached — see lib/paging.ts. */}
          <TruncationNotice
            notice={truncationNotice({
              shown: rows.length,
              cap: CAPS.people,
              noun: "people",
              fullListAt: "a narrower search",
            })}
          />
        </>
      )}

    </main>
  );
}
