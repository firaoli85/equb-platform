import { redirect } from "next/navigation";
import { getMemberCollections } from "@/app/actions/member";
import { MemberCollectionsList } from "@/components/member/member-collections-list";

export const dynamic = "force-dynamic";

// Draw history by NUMBER only (2.8) — the server action sends no names, no
// amounts, no methods. The member's own status is the one personal line.
export default async function CollectionsPage() {
  const result = await getMemberCollections();
  if (!result.ok) {
    if (result.error === "signed-out") redirect("/login");
    return (
      <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-300">{result.error}</p>
    );
  }
  const d = result.data;

  return (
    <MemberCollectionsList
      draws={d.draws}
      myNumbers={d.myNumbers}
      nextDraw={d.nextDraw}
      currentWeek={d.currentWeek}
    />
  );
}
