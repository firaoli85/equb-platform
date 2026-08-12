import Link from "next/link";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader } from "@/components/ui/primitives";
import { getSetting } from "@/lib/settings";
import { AddPersonForm } from "../add-person-form";

export const dynamic = "force-dynamic";

// ADD SOMEONE TO THE DIRECTORY, WITHOUT PUTTING THEM IN A CYCLE.
//
// This form used to sit at the bottom of the directory listing — 95% of the way
// down a page whose job is reading, under everything else. Creating a PERSON is
// a different job from reading a list of them, and a job you scroll past is a
// job nobody knows exists.
//
// IT IS THE RARER OF THE TWO DOORS, and that is why it is here rather than on
// the directory itself. 2.5: people are permanent and participation is
// per-cycle, so someone can exist in the directory while sitting a cycle out —
// but the ordinary act is adding someone TO the running cycle, which is the
// guided flow at /admin/cycle/add. That one creates the person AND the
// participation in a single step (D-30), so coming here first is only correct
// when they are genuinely not joining.
//
// The link back to the guided flow is prominent for exactly that reason: an
// organizer who lands here by accident should be able to see, immediately, that
// the other door is the one they wanted.

export default async function NewPersonPage() {
  // Names and phones (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Add a person" />;

  return (
    <main className="max-w-xl space-y-5">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link
            href="/admin/people"
            className="text-gray-600 dark:text-gray-400 hover:underline"
          >
            ← Member directory
          </Link>
        </p>
        <h1 className="text-xl font-black text-gray-900 dark:text-white">
          Add a person to the directory
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          For someone who is <strong>not</strong> joining the current cycle — a person the
          directory should remember so they can be added to a later one without being
          re-typed (2.5).
        </p>
      </header>

      {/* The other door, said plainly. Someone who wanted the cycle should not
          have to discover that by filling this in and finding nothing changed. */}
      <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-3 animate-fade-in-up-1">
        <p className="text-sm text-indigo-950 dark:text-indigo-100">
          <strong>Adding them to the current cycle instead?</strong> Use{" "}
          <Link href="/admin/cycle/add" className="font-semibold underline">
            Add a member
          </Link>
          . That flow creates the person and their participation together, sets their
          contribution and lucky numbers, and surfaces any balance they carry in.
        </p>
      </div>

      <Card className="animate-fade-in-up-2">
        <CardHeader
          title="Their permanent details"
          sub="Name and phone only. Contribution, weeks and lucky numbers belong to a cycle, not to the person."
        />
        <div className="px-5 pb-5">
          <AddPersonForm />
        </div>
      </Card>
    </main>
  );
}
