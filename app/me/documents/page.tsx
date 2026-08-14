import Link from "next/link";
import { redirect } from "next/navigation";
import { getMySignedAgreements } from "@/app/actions/agreement";
import { SignedAgreements } from "@/components/member/signed-agreements";

export const dynamic = "force-dynamic";

// Documents — the member's own signed agreements (Cycle-2 build, feature B).
//
// Each card is the EXACT text stored beside their signature, never a
// re-render from the current version: the member reads the words they
// actually agreed to. A member who has not signed sees the honest empty
// state saying what will appear here. The query behind this is scoped to the
// signed-in member's own signature rows by construction — the action takes
// no input at all.
export default async function DocumentsPage() {
  const result = await getMySignedAgreements();
  if (!result.ok) {
    if (result.error === "Not signed in.") redirect("/login");
    return (
      <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-300">{result.error}</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* The back link sits ABOVE the title with a real hit area — the same
          control History uses, rather than a 20px text link floated into the
          heading row. */}
      <div>
        <p className="mb-1 text-sm">
          <Link
            href="/me"
            className="inline-flex min-h-11 items-center text-gray-600 hover:underline dark:text-gray-400"
          >
            ← Home
          </Link>
        </p>
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Documents</h1>
      </div>

      <SignedAgreements agreements={result.data} />
    </div>
  );
}
