import type { EndOfCycle } from "@/lib/end-of-cycle";
import { formatMoney } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/primitives";
import { RefundInProjectionToggle } from "./refund-in-projection-toggle";

// WHERE THE CYCLE FINISHES — the second question, on the page that already
// answers the first.
//
// The organizer worked this out on paper every week and got about $875 short
// while the screen said $6,325. Both were right. The cash position above looks
// BACKWARD at money that has already moved; this looks FORWARD over money that
// has not. Nothing said they were different questions, so the two figures read
// as one figure disagreeing with itself.
//
// THE LAYOUT IS THE ARITHMETIC. In, out, in hand, answer — the same four
// blocks in the same order he wrote them in, so he can check the screen
// against his own paper line by line rather than trusting it. The signature
// element is the last row, and everything above it is deliberately quiet: this
// is a working surface, not a dashboard, and a page of equally loud figures is
// how the fee got lost in the first place.

function Line({
  label,
  cents,
  hint,
  muted,
}: {
  label: string;
  cents: number;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p
          className={`text-sm ${muted ? "text-gray-600 dark:text-gray-400" : "font-medium text-gray-900 dark:text-gray-100"}`}
        >
          {label}
        </p>
        {hint && <p className="text-[11px] text-gray-600 dark:text-gray-400">{hint}</p>}
      </div>
      <p
        className={`shrink-0 text-sm tabular-nums ${muted ? "text-gray-600 dark:text-gray-400" : "font-semibold text-gray-900 dark:text-white"}`}
      >
        {formatMoney(cents)}
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-0.5">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function EndOfCyclePanel({
  projection: p,
  sentence,
  hasReading,
}: {
  projection: EndOfCycle;
  sentence: string;
  hasReading: boolean;
}) {
  const short = p.endOfCycle < 0;

  return (
    <Card>
      <CardHeader
        title="Where the cycle finishes"
        sub="If everyone pays what they owe and you pay what you owe. This is a different question from the cash above, which asks whether today's money matches the books."
      />
      <div className="space-y-5 px-5 py-4">
        <Group title="Money still to come in">
          <Line
            label="Contributions on weeks still to come"
            cents={p.futureContributions}
            hint="What is not already paid for those weeks"
          />
          <Line
            label="Owed on weeks that have passed"
            cents={p.arrears}
            hint="Money that should have arrived and has not"
          />
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-gray-100 pt-1.5 dark:border-gray-800/60">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Coming in</p>
            <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
              {formatMoney(p.comingIn)}
            </p>
          </div>
        </Group>

        <Group title="Money still to go out">
          <Line
            label="Payouts still to be drawn"
            cents={p.payoutsStillToGoOut}
            // "net" is on the cash screen's banned word list, so this says what
            // the figure IS rather than naming the accounting operation.
            hint="What actually crosses the table, with your fee already taken out"
          />
          <Line
            label="Owed back to members who stopped"
            cents={p.refundsCounted}
            hint={
              p.refundsHandledByHand > 0
                ? `${formatMoney(p.refundsHandledByHand)} more is owed and you are handling it yourself, so it is not in this sum`
                : undefined
            }
          />
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-gray-100 pt-1.5 dark:border-gray-800/60">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Going out</p>
            <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
              {formatMoney(p.goingOut)}
            </p>
          </div>
        </Group>

        <Group title="In hand">
          <Line
            label="What you counted"
            cents={p.inHand}
            hint={hasReading ? undefined : "You have not entered a reading yet"}
            muted={!hasReading}
          />
        </Group>

        {/* THE ANSWER. The one loud thing on the panel. */}
        <div
          className={`rounded-2xl px-4 py-3 ${
            !hasReading
              ? "bg-gray-100 dark:bg-white/5"
              : short
                ? "bg-red-50 dark:bg-red-950/30"
                : "bg-emerald-50 dark:bg-emerald-950/30"
          }`}
        >
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm font-bold text-gray-900 dark:text-white">Where it finishes</p>
            {hasReading && (
              <p
                className={`text-xl font-black tabular-nums ${
                  short
                    ? "text-red-800 dark:text-red-300"
                    : "text-emerald-800 dark:text-emerald-300"
                }`}
              >
                {formatMoney(p.endOfCycle)}
              </p>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-800 dark:text-gray-200">{sentence}</p>
        </div>

        {/* The fee, stated and never used. It is already inside the payout
            figure above; a second line adding it back is the one mistake this
            whole panel exists to stop him making. */}
        {p.feeStillToEarn > 0 && (
          <p className="text-[11px] text-gray-600 dark:text-gray-400">
            Of the payouts still to go out, {formatMoney(p.feeStillToEarn)} is your fee and stays
            with you. It is already taken out of the figure above, so it is not added anywhere else.
          </p>
        )}

        {p.refunds.length > 0 && (
          <section className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800/60">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400">
                What you owe members who stopped
              </h3>
              <p className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                {formatMoney(p.refundsOwedInFull)} in total. Each one is owed whichever way you set
                it here. The choice only decides whether it is in the sum above.
              </p>
            </div>
            <ul className="space-y-3">
              {p.refunds.map((r) => (
                <li
                  key={r.participationId}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-800"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{r.name}</p>
                    <p className="text-xs tabular-nums text-gray-700 dark:text-gray-300">
                      {formatMoney(r.amount)} owed back
                    </p>
                  </div>
                  <RefundInProjectionToggle
                    participationId={r.participationId}
                    name={r.name}
                    amount={r.amount}
                    counted={r.counted}
                    formattedAmount={formatMoney(r.amount)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}
