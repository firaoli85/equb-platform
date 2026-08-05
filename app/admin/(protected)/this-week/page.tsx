import Link from "next/link";
import { getDashboard } from "@/app/actions/dashboard";
import { PresentationHidden } from "@/components/presentation-hidden";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Drill-down: this week's payments — who has paid and who has not.
export default async function ThisWeekBreakdownPage() {
  const result = await getDashboard();
  if (!result.ok) return <main className="text-sm text-red-800">{result.error}</main>;
  const d = result.data;
  if (d.presentation) return <PresentationHidden what="This week" />;
  const groups = {
    PAID: d.thisWeekMembers.filter((m) => m.status === "PAID"),
    PARTIAL: d.thisWeekMembers.filter((m) => m.status === "PARTIAL"),
    UNPAID: d.thisWeekMembers.filter((m) => m.status === "UNPAID"),
    DEFERRED: d.thisWeekMembers.filter((m) => m.status === "DEFERRED"),
  };

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/admin" className="underline">← Dashboard</Link>
      </p>
      <h1 className="mb-2 text-xl font-semibold">Week {d.currentWeek}</h1>
      {d.thisWeek && (
        <p className="mb-6 text-sm text-gray-700">
          Expected {formatMoney(d.thisWeek.expected)} · received{" "}
          {formatMoney(d.thisWeek.received)} · {d.thisWeek.membersPaid} of{" "}
          {d.thisWeek.membersExpected} paid
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {(
          [
            ["UNPAID", "Have not paid"],
            ["PARTIAL", "Partially paid"],
            ["PAID", "Paid"],
            ["DEFERRED", "Deferred (excused)"],
          ] as const
        ).map(([key, title]) => (
          <section key={key}>
            <h2 className="mb-2 text-base font-semibold">
              {title} ({groups[key].length})
            </h2>
            {groups[key].length === 0 ? (
              <p className="text-sm text-gray-600">Nobody.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {groups[key].map((m) => (
                  <li key={m.participationId}>
                    <Link href={`/admin/participations/${m.participationId}`} className="underline">
                      {m.name}
                    </Link>{" "}
                    — {formatMoney(m.amountPaid)} of {formatMoney(m.weeklyAmount)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
