import { redirect } from "next/navigation";
import { getGroupProgress } from "@/app/actions/member";
import { MemberGroupList } from "@/components/member/member-group-list";

export const dynamic = "force-dynamic";

// The social layer (2.8): progress shared, nothing else. Data comes through
// the member_progress view under the CALLER's session — the database itself
// cannot hand over amounts, numbers, payouts, or phones.
export default async function GroupPage() {
  const result = await getGroupProgress();
  if (!result.ok) {
    if (result.error === "signed-out") redirect("/login");
    return (
      <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-300">{result.error}</p>
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
