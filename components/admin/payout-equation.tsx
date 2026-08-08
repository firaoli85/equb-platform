import { formatMoney } from "@/lib/format";

// WHAT THIS MEMBER RECEIVES, AND WHAT THE FEE TAKES OUT OF IT.
//
// The fee was already on the profile — as one column of a five-column table,
// one tab in. Correct, and not findable: the organizer's most common question
// about a member's payout is "what do they actually get, and what is my cut",
// and answering it meant reading across a row.
//
// It is now the arithmetic itself, written out: gross MINUS fee EQUALS net.
// The equation is the point — three bare figures side by side do not say
// which one is subtracted from which, and the fee is the number the organizer
// is checking.
//
// COLOUR CARRIES MEANING HERE AND ONLY HERE. Amber for the fee because it is
// money leaving the member's total; emerald for the net because it is the
// figure they are handed. The operators are drawn, not implied by spacing.

export function PayoutEquation({
  gross,
  fee,
  net,
  feePercent,
  /** True once a real payout exists — before the draw these are projections. */
  settled,
  numberCount,
  className = "",
}: {
  gross: number;
  fee: number;
  net: number;
  feePercent: number;
  settled: boolean;
  numberCount: number;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="payout-equation"
      className={`rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#141414] ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4">
        <h2 id="payout-equation" className="text-sm font-bold text-gray-900 dark:text-white">
          {settled ? "Their payout" : "Their payout, when drawn"}
        </h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 tabular-nums">
          {numberCount === 1 ? "1 lucky number" : `${numberCount} lucky numbers`}
          {" · "}
          {feePercent}% fee
        </p>
      </div>

      {/* The equation. Wraps to two rows on a phone without losing the
          operators, because the operators are what make it readable. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pb-4 pt-3">
        <Figure label="They receive" amount={gross} tone="plain" />
        <Operator>−</Operator>
        <Figure label={`Fee (${feePercent}%)`} amount={fee} tone="fee" />
        <Operator>=</Operator>
        <Figure label="They get" amount={net} tone="net" emphasis />
      </div>

      {!settled && (
        <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-600 dark:border-gray-800/60 dark:text-gray-400">
          Projected from their weekly amount and commitment — nothing is recorded until their
          number is drawn.
        </p>
      )}

      {/* The same arithmetic in one sentence, for a screen reader and for
          anyone who reads the words rather than the layout. */}
      <p className="sr-only">
        {formatMoney(gross)} gross, minus a {feePercent}% fee of {formatMoney(fee)}, leaves{" "}
        {formatMoney(net)} for the member.
      </p>
    </section>
  );
}

function Operator({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="select-none text-lg font-black text-gray-400 dark:text-gray-600"
    >
      {children}
    </span>
  );
}

function Figure({
  label,
  amount,
  tone,
  emphasis = false,
}: {
  label: string;
  amount: number;
  tone: "plain" | "fee" | "net";
  emphasis?: boolean;
}) {
  const colour =
    tone === "fee"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "net"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-gray-900 dark:text-white";
  return (
    <span className="min-w-0">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {label}
      </span>
      <span
        className={`block font-black tabular-nums leading-none ${colour} ${
          emphasis ? "text-2xl" : "text-xl"
        }`}
      >
        {formatMoney(amount)}
      </span>
    </span>
  );
}
