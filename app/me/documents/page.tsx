import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyPortal } from "@/app/actions/member";

export const dynamic = "force-dynamic";

// Documents — nothing is shared yet in this build; the empty state is an
// honest invitation, never a dead end.
export default async function DocumentsPage() {
  const result = await getMyPortal();
  if (!result.ok) {
    if (result.error === "signed-out") redirect("/login");
    return (
      <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-300">{result.error}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Documents</h1>
        <Link href="/me" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          ← Home
        </Link>
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm px-5 py-10 text-center animate-fade-in-up">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">No documents yet</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          When the organizer shares something with the group, it appears here.
        </p>
      </div>
    </div>
  );
}
