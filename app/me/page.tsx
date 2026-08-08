import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyPortal } from "@/app/actions/member";
import { getMyPastCycles } from "@/app/actions/member-history";
import { myNewDeviceNotice } from "@/app/actions/sessions";
import { NewDeviceNotice } from "@/components/member/new-device-notice";
import { PastCycleCard } from "@/components/member/past-cycle-card";
import { MemberPayoutCard } from "@/components/member/member-payout-card";
import { MemberPersonalSummary } from "@/components/member/member-personal-summary";
import { SavedCard } from "@/components/member/saved-card";
import { WeekStampList, type StampWeek } from "@/components/member/week-stamp-list";
import { formatDateLongUTC, formatDateUTC, formatMoney } from "@/lib/format";
import { notInCurrentCycleLine } from "@/lib/member-history";

export const dynamic = "force-dynamic";

// The member's own world (2.8): two cards — "You" and "Your payout" — then
// their week list. Everything counts THEIR window (2.22); weeks before a
// late joiner's start are simply not theirs and never rendered.
export default async function MePage() {
  const result = await getMyPortal();
  // Ruling 5: this goes ABOVE the money. A member who signed in with four
  // digits anyone could guess finds out here if someone else did.
  const notice = await myNewDeviceNotice();
  const newDevice = notice.ok ? notice.data : null;
  if (!result.ok) {
    // Only a missing session goes to login — a transient error must never
    // bounce a signed-in member into a silent login loop.
    if (result.error === "signed-out") redirect("/login");
    return (
      <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-300">{result.error}</p>
    );
  }
  const { person, participation } = result.data;

  const displayName = `${person.nameEnglishFirst} / ${person.nameAmharic}`;

  // ————— NOT IN THE RUNNING CYCLE — one calm page —————
  //
  // This rendered MemberPersonalSummary with paidCount 0, lateCount 0 and
  // totalWeeks 0: a savings card reading "0%, 0/0 wks, Perfect record" over
  // a sentence saying they were not in a cycle. A member who had just
  // completed twenty weeks saw their record as zeroes, on the day the closing
  // statement told them to go and look.
  //
  // Nothing that implies participation now renders: no ring, no week grid, no
  // "next due". Their most recent finished cycle is summarised below, clearly
  // labelled as finished, with the full record one tap away.
  if (!participation) {
    const past = await getMyPastCycles();
    const cycles = past.ok ? past.data.cycles : [];
    const mostRecent = cycles[0] ?? null;
    const carried = past.ok ? past.data.carried.balance : 0;

    return (
      <div className="space-y-4">
        {newDevice && (
          <NewDeviceNotice sessionId={newDevice.sessionId} message={newDevice.message} />
        )}

        <section className="animate-fade-in-up rounded-2xl border border-gray-200 bg-white px-5 py-6 text-center dark:border-gray-800 dark:bg-[#141414]">
          <h1 className="text-xl font-black text-gray-900 dark:text-white text-balance">
            You&rsquo;re not in the current cycle
          </h1>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-600 dark:text-gray-400 text-pretty">
            {notInCurrentCycleLine(mostRecent !== null)}
          </p>
        </section>

        {carried > 0 && (
          <Link
            href="/me/history"
            className="animate-fade-in-up-1 block rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 transition-colors hover:border-amber-400 dark:border-amber-900 dark:bg-amber-950/25"
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
              Carried balance
            </p>
            <p className="mt-0.5 text-2xl font-black tabular-nums text-amber-900 dark:text-amber-200">
              {formatMoney(carried)}
            </p>
            <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">
              Still owed from a finished cycle. Tap to see where it came from.
            </p>
          </Link>
        )}

        {mostRecent && (
          <div className="animate-fade-in-up-2 space-y-3">
            <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Your most recent cycle
            </h2>
            <PastCycleCard cycle={mostRecent} />
            {cycles.length > 1 && (
              <Link
                href="/me/history"
                className="flex min-h-11 items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-[#141414] dark:text-gray-200 dark:hover:border-gray-700"
              >
                All {cycles.length} past cycles →
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  const p = participation;
  const drawnWeeks = new Set(
    p.numbers.map((n) => n.drawnWeekNumber).filter((w): w is number => w !== null),
  );
  const stampWeeks: StampWeek[] = p.weeks.map((w) => ({
    id: `w${w.weekNumber}`,
    weekNumber: w.weekNumber,
    date: formatDateUTC(w.date),
    status: w.status,
    isPayoutWeek: drawnWeeks.has(w.weekNumber),
    // The amounts the list was missing — a member must be able to read down
    // the column and trust the total above it.
    amountPaid: w.amountPaid,
    amountDue: w.amountDue,
  }));

  // 2.22: a member always sees their OWN finish date — the week number on its
  // own means nothing to the person reading it.
  const finishOn = p.finishDate === null ? null : formatDateLongUTC(new Date(p.finishDate));
  const finishTail = finishOn === null ? "." : ` — you finish ${finishOn}.`;
  const joinedLine =
    p.startWeek > 1
      ? `You joined in week ${p.startWeek}. Your weeks run from ${p.startWeek} to ${p.finishWeek}${finishTail}`
      : `Your weeks run from ${p.startWeek} to ${p.finishWeek}${finishTail}`;

  // Their payout: the sum across their numbers, and whether any has landed.
  const payoutNet = p.numbers.reduce((sum, n) => sum + n.netAmount, 0);
  const payoutReceived = p.numbers.some((n) => n.payoutStatus === "COLLECTED");

  return (
    <div className="space-y-4">
      {/* Ruling 5. The ONE thing allowed above the savings figure — and only
          when it is actually there, which lib/device.ts keeps rare. */}
      {newDevice && (
        <NewDeviceNotice sessionId={newDevice.sessionId} message={newDevice.message} />
      )}

      {/* 2.1: a savings group leads with what you have SAVED. Nothing else on
          the page may be more prominent than this figure. */}
      <SavedCard
        contribution={p.contribution}
        weeklyAmount={p.weeklyAmount}
        payoutNet={payoutNet}
        payoutReceived={payoutReceived}
      />

      <MemberPersonalSummary
        displayName={displayName}
        paidCount={p.weeksCredited}
        lateCount={p.lateCount}
        totalWeeks={p.weeksCommitted}
        joinedLine={joinedLine}
      />

      <MemberPayoutCard
        numbers={p.numbers}
        paidCount={p.weeksCredited}
        totalWeeks={p.weeksCommitted}
        nextDue={p.nextDue}
      />

      {/* ── Their weeks ──────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm px-3 py-3 animate-fade-in-up-2">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white px-2 mb-2">
          Your weeks — {p.cycleName}
        </h2>
        <WeekStampList weeks={stampWeeks} sessionKey={p.id} />
      </section>

      {/* ── Onward links ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 animate-fade-in-up-3">
        <Link
          href="/me/schedule"
          className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.98] transition-colors"
          style={{ touchAction: "manipulation", minHeight: "44px" }}
        >
          <svg className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          Schedule
        </Link>
        <Link
          href="/me/documents"
          className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm text-sm font-semibold text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.98] transition-colors"
          style={{ touchAction: "manipulation", minHeight: "44px" }}
        >
          <svg className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Documents
        </Link>

      </div>
    </div>
  );
}
