import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { PresentationHidden } from "@/components/presentation-hidden";
import { formatDateUTC, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Drill-down: who received the paid-out money, and when.
export default async function PaidOutBreakdownPage() {
  const result = await getDashboard();
  if (!result.ok) return <main className="text-sm text-red-800">{result.error}</main>;
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="Paid out to date" />;

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/admin" className="underline">← Dashboard</Link>
      </p>
      <h1 className="mb-6 text-xl font-semibold">
        Paid out to date: {formatMoney(d.position.totalPaidOut)}
      </h1>
      {d.paidOutDetail.length === 0 ? (
        <p className="text-sm text-gray-700">Nothing has been paid out.</p>
      ) : (
        <table className="w-full max-w-2xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left">
              <th className="py-1 pr-3 font-medium">Winner</th>
              <th className="py-1 pr-3 font-medium">Week won</th>
              <th className="py-1 pr-3 font-medium">Net paid</th>
              <th className="py-1 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {d.paidOutDetail.map((p) => (
              <tr key={p.id} className="border-b border-gray-200">
                <td className="py-1 pr-3">
                  <Link href="/admin/collections" className="underline">
                    {p.who}
                  </Link>
                </td>
                <td className="py-1 pr-3">{p.weekNumber ?? "—"}</td>
                <td className="py-1 pr-3">{formatMoney(p.netAmount)}</td>
                <td className="py-1">{p.paidAt ? formatDateUTC(p.paidAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
