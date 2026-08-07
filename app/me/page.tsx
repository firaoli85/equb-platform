import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyPortal } from "@/app/actions/member";
import { myNewDeviceNotice } from "@/app/actions/sessions";
import { NewDeviceNotice } from "@/components/member/new-device-notice";
import { MemberPayoutCard } from "@/components/member/member-payout-card";
import { MemberPersonalSummary } from "@/components/member/member-personal-summary";
import { SavedCard } from "@/components/member/saved-card";
import { WeekStampList, type StampWeek } from "@/components/member/week-stamp-list";
import { formatDateLongUTC, formatDateUTC } from "@/lib/format";

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

  if (!participation) {
    return (
      <div className="space-y-4">
        {newDevice && (
          <NewDeviceNotice sessionId={newDevice.sessionId} message={newDevice.message} />
        )}
        <MemberPersonalSummary
          displayName={displayName}
          paidCount={0}
          lateCount={0}
          totalWeeks={0}
        />
        <p className="text-center text-sm text-gray-600 dark:text-gray-300 py-6">
          You are not in the current cycle. Contact the organizer to join.
        </p>
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
