import { listAuditLog } from "@/app/actions/edits";
import { PresentationHidden } from "@/components/presentation-hidden";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  // The audit log narrates everything (2.4). The action refuses too — this
  // guard just renders the calmer notice.
  if (await getSetting("presentationMode")) return <PresentationHidden what="Audit log" />;
  const result = await listAuditLog();

  return (
    <main>
      <h1 className="mb-6 text-xl font-semibold">Audit log</h1>
      {!result.ok ? (
        <p role="alert" className="text-sm text-red-800">
          {result.error}
        </p>
      ) : result.data.length === 0 ? (
        <p className="text-sm text-gray-700">No changes recorded yet.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left">
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">Entity</th>
              <th className="py-2 pr-4 font-medium">Action</th>
              <th className="py-2 font-medium">What changed</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((entry) => (
              <tr key={entry.id} className="border-b border-gray-200 align-top">
                <td className="whitespace-nowrap py-2 pr-4 text-gray-600">
                  {entry.createdAt.toLocaleString("en-US")}
                </td>
                <td className="py-2 pr-4">{entry.entity}</td>
                <td className="py-2 pr-4">{entry.action}</td>
                <td className="py-2">
                  {entry.summary}
                  {(entry.before || entry.after) && (
                    <details className="mt-1 text-xs text-gray-600">
                      <summary className="cursor-pointer">from / to</summary>
                      {entry.before && <pre className="overflow-x-auto">before: {entry.before}</pre>}
                      {entry.after && <pre className="overflow-x-auto">after:  {entry.after}</pre>}
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
