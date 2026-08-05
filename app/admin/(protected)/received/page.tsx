import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { PresentationHidden } from "@/components/presentation-hidden";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Drill-down: what "received to date" is made of — by week and by member.
// ("Collections" means payouts to winners; money coming in is "received".)
export default async function ReceivedBreakdownPage() {
  const result = await getDashboard();
  if (!result.ok) return <main className="text-sm text-red-800">{result.error}</main>;
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="Received to date" />;

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/admin" className="underline">← Dashboard</Link>
      </p>
      <h1 className="mb-6 text-xl font-semibold">
        Received to date: {formatMoney(d.position.totalReceived)}
      </h1>

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-base font-semibold">By week</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th className="py-1 pr-3 font-medium">Week</th>
                <th className="py-1 pr-3 font-medium">Received</th>
                <th className="py-1 font-medium">Expected</th>
              </tr>
            </thead>
            <tbody>
              {d.series.map((w) => (
                <tr key={w.weekNumber} className="border-b border-gray-200">
                  <td className="py-1 pr-3">{w.weekNumber}</td>
                  <td className="py-1 pr-3">{formatMoney(w.received)}</td>
                  <td className="py-1 text-gray-600">{formatMoney(w.expected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold">By member</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {d.receivedByMember.map((m) => (
                <tr key={m.participationId} className="border-b border-gray-200">
                  <td className="py-1 pr-3">
                    <Link href={`/admin/participations/${m.participationId}`} className="underline">
                      {m.name}
                    </Link>
                  </td>
                  <td className="py-1 text-right">{formatMoney(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
