import { redirect } from "next/navigation";
import { getGroupProgress } from "@/app/actions/member";
import { MemberGroupList } from "@/components/member/member-group-list";
import { NotInCycle } from "@/components/member/not-in-cycle";
import { notInCurrentCycleLine } from "@/lib/member-history";

export const dynamic = "force-dynamic";

// The social layer (2.8): progress shared, nothing else — name, weeks paid,
// behind count.
//
// WHERE THAT GUARANTEE LIVES CHANGED IN PHASE 5. This used to read "data comes
// through the member_progress view under the CALLER's session — the database
// itself cannot hand over amounts, numbers, payouts, or phones", and it was
// true: the view granted six columns and scoped rows through auth.uid(). The
// view is retired (it re-implemented the behind-count in SQL and had drifted
// past D-42), so the database no longer refuses anything on this path.
//
// The projection in getGroupProgress does, and lib/member-group-disclosure.test.ts
// fails if a seventh field appears. Said here because a security property that
// moves quietly is one the next reader assumes is still enforced a layer down.
export default async function GroupPage() {
  const result = await getGroupProgress();
  if (!result.ok) {
    if (result.error === "signed-out") redirect("/login");
    // "No active cycle" is not a fault — it is the same state home and
    // Schedule show as a card. Anything else genuinely is a fault.
    if (result.error === "No active cycle.") {
      return <NotInCycle line={notInCurrentCycleLine(false)} />;
    }
    return (
      <p role="alert" className="py-10 text-center text-sm text-red-800 dark:text-red-400">
        {result.error}
      </p>
    );
  }
  const d = result.data;

  return (
    <MemberGroupList
      viewer={d.viewer}
      peers={d.peers}
      currentWeek={d.currentWeek}
      plannedWeeks={d.plannedWeeks}
      currentCount={d.currentCount}
      totalMembers={d.totalMembers}
    />
  );
}
