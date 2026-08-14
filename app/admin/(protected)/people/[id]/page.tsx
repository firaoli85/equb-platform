import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemberAgreementState } from "@/app/actions/agreement";
import { getCatchUpWeeks } from "@/app/actions/payments-view";
import { getMemberStanding } from "@/app/actions/payments";
import { getMemberMessaging } from "@/app/actions/member-messaging";
import { listMemberSignIns } from "@/app/actions/sessions";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { AgreementSigningCard } from "@/components/admin/agreement-signing";
import { PayoutEquation } from "@/components/admin/payout-equation";
import { Pager, TruncationNotice } from "@/components/ui/pager";
import { SectionHeading, SectionNav } from "@/components/ui/section-nav";
import { finishLine, finishPreview, resolveWeekDate, storedWeekDates } from "@/lib/commitment";
import { paymentStatus } from "@/lib/derived";
import { formatDateLongUTC, formatDateUTC, formatMoney } from "@/lib/format";
import { finalPosition, finalPositionAdminLine } from "@/lib/final-position";
import { ledgerBalance, ledgerStory } from "@/lib/ledger";
import { calculateFinishWeek } from "@/lib/money";
import { CAPS, PAGE_SIZES, pageInfo, parsePage, parsePageSize, truncationNotice } from "@/lib/paging";
import { PageSizeSelect } from "@/components/ui/page-size";
import type { PinState } from "@/lib/person-record";
import { defaultPinForPhone } from "@/lib/pin";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { calculatePayout } from "@/lib/wheel";
import { AssignPayout } from "./assign-payout";
import { CarriedBalance } from "./carried-balance";
import { MemberPayments } from "./member-payments";
import { MemberMessaging } from "./member-messaging";
import { MemberSignIns } from "./member-sign-ins";
import {
  MemberTabBar,
  parseSection,
  parseTab,
  SETTINGS_SECTION_LABELS,
} from "./member-tabs";
import { MessagesOptOut } from "./messages-opt-out";
import { ParticipationEditor } from "./participation-editor";
import { PersonEditForm } from "./person-edit-form";
import { PinControls } from "./pin-controls";
import { personDisplayName, personSecondaryName } from "@/lib/person-name";

export const dynamic = "force-dynamic";

// THE member page: a header that never scrolls away, then ONE thing at a
// time behind five tabs. Every capability the old stacked page had still
// exists — each now in exactly one place:
//   PAYMENTS  their weeks + per-week panel + allocation entry + bulk catch-up
//   PAYOUT    lucky numbers, gross/fee/net, draw status, carried ledger
//   RECEIPTS  the payment-event audit trail, editable and undoable
//   SETTINGS  participation (the ONLY editor), lucky numbers, person, PIN, hardship
//   HISTORY   every cycle this person has been in
// Standing is derived by getMemberStanding — nothing recomputed here (2.14).
// One finish sentence for the whole platform (2.22) — the same finishLine the
// wizard and the participation editor render, so the card cannot drift into a
// fourth phrasing of the same fact.
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    section?: string | string[];
    receiptsPage?: string | string[];
    receiptsPageSize?: string | string[];
  }>;
}) {
  // A member's identity and money (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Member" />;
  const { id } = await params;
  const query = await searchParams;
  const tab = parseTab(query.tab);
  // The Settings tab is three jobs, so it carries a second level (see
  // components/ui/section-nav.tsx for why).
  const section = parseSection(query.section);

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      // Oldest first: the running total only makes sense in the order the
      // events actually happened.
      ledgerEntries: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] },
      participations: {
        include: {
          cycle: {
            select: {
              id: true,
              name: true,
              status: true,
              startDate: true,
              plannedWeeks: true,
              feePercent: true,
              // The live fee calculator reads both from the cycle, never a
              // constant (2.6) — the split depends on the unit.
              unitAmount: true,
              // The stored week rows win over any projection (2.14, 2.7).
              weeks: { select: { weekNumber: true, date: true } },
            },
          },
          luckyNumbers: {
            orderBy: { number: "asc" },
            include: {
              payouts: true,
              slotMembers: {
                include: { slot: { include: { draws: { include: { week: true } } } } },
              },
            },
          },
          // RECEIPTS ARE NOT LOADED HERE.
          //
          // They were — for EVERY participation, meaning every cycle this
          // person has ever been in, with no limit. PaymentEvent grows with
          // every payment and is never deleted, so a member in their fourth
          // cycle loaded four cycles of receipts to render a page that reads
          // them for exactly one. They are fetched below for the ACTIVE
          // participation only, and only on the two tabs that use them.
          payments: { include: { week: true }, orderBy: { week: { weekNumber: "asc" } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!person) notFound();

  // THEIR RECORD IN THE LIVE CYCLE — whether or not they are still
  // contributing.
  //
  // This used to require `p.status === "ACTIVE"`, so the moment a member
  // stopped their entire record disappeared from this page: no receipts, no
  // weeks, no lucky numbers, and no way to say "they are contributing again".
  // 2.18 is explicit that closed members stay VISIBLE and keep their record —
  // "dignity, and a useful record for them" — and a close that cannot be seen
  // also cannot be reversed.
  const active = person.participations.find((p) => p.cycle.status === "ACTIVE") ?? null;
  /** Where they stopped, for the panel that offers the way back. */
  const closedState =
    active && active.status === "CLOSED"
      ? {
          atWeek: active.closedAtWeek,
          reason: active.closeReason,
          note: active.closeNote,
        }
      : null;

  /**
   * WHAT HE OWES THEM, OR THEY OWE HIM (2.18).
   *
   * The SAME derivation the member reads on their own portal, from the same
   * two facts — everything they paid in, and everything they were handed — so
   * his screen and hers can never disagree about the direction or the figure.
   *
   * The receipts are aggregated rather than taken from the paged list below:
   * total contributed is the sum of the receipts (2.14), and that page is one
   * page. A total computed from a page would be wrong the moment there were
   * more receipts than fit on it.
   */
  const finalStanding =
    active && active.status === "CLOSED"
      ? finalPosition({
          paidIn:
            (
              await prisma.paymentEvent.aggregate({
                where: { participationId: active.id },
                _sum: { amount: true },
              })
            )._sum.amount ?? 0,
          received: active.luckyNumbers
            .flatMap((n) => n.payouts)
            .filter((po) => po.status === "COLLECTED")
            .reduce((sum, po) => sum + po.netAmount, 0),
          weeklyAmount: active.weeklyAmount,
          weeksCommitted: active.weeksCommitted,
          // 2.6: the cycle's real unit and fee, never a constant.
          unitAmount: active.cycle.unitAmount,
          feePercent: active.cycle.feePercent,
        })
      : null;

  const [standing, catchUp] = active
    ? await Promise.all([getMemberStanding(active.id), getCatchUpWeeks(active.id)])
    : [null, null];

  // RECEIPTS: ONE PAGE, ON THE ONE TAB THAT SHOWS THEM.
  //
  // This loaded every receipt the member has ever produced, on BOTH the
  // Receipts and Settings tabs. PaymentEvent grows with every payment and is
  // never deleted, so the list has no ceiling — and Settings renders the
  // receipts section with `receipts: false`, which is a CSS `hidden`, not an
  // unmount. Every row therefore crossed the wire to be displayed to nobody.
  //
  // The old comment justified the whole set by the removal confirmation's
  // count and total. That was stale: `RemoveFromCycle` takes only ids and
  // fetches its own figures through `participationRemovalPreview`, which
  // counts and sums in SQL. Nothing on Settings reads these rows.
  const receiptsPage = parsePage(query.receiptsPage);
  const receiptsPageSize = parsePageSize(query.receiptsPageSize, PAGE_SIZES.receipts);
  const receiptTotal =
    active && tab === "receipts"
      ? await prisma.paymentEvent.count({ where: { participationId: active.id } })
      : 0;
  const receiptInfo = pageInfo(receiptTotal, receiptsPage, receiptsPageSize);
  // Only for the tab that shows it.
  const messaging =
    tab === "messages" ? await getMemberMessaging({ personId: person.id }) : null;

  const paymentEvents =
    active && tab === "receipts"
      ? await prisma.paymentEvent.findMany({
          where: { participationId: active.id },
          orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
          skip: receiptInfo.skip,
          take: receiptInfo.take,
        })
      : [];

  // Ruling 6. Fetched only for the tab that shows it — the sign-in history is
  // never needed to render Payments or Payout.
  const signIns =
    tab === "settings"
      ? await listMemberSignIns({ personId: person.id })
      : ({ ok: true as const, data: { total: 0, rows: [] } });

  // WHERE THEY STAND ON SIGNING — read only by the section that renders it.
  //
  // Unlike the sign-in count, nothing in the section nav quotes this, so it
  // does not have to be paid for on the other two Settings sections. The
  // action reads their most recent participation; the directory chip reads the
  // same one (see app/actions/people.ts), so the list and this page cannot
  // report a different requirement for the same member.
  const agreement =
    tab === "settings" && section === "access"
      ? await getMemberAgreementState({ personId: person.id })
      : null;

  // The one finish preview this page shows (2.22) — same pure module as every
  // editable surface, so the card, the editor and the wizard all agree.
  const payoutFinish = active
    ? finishPreview({
        cycleStartDate: active.cycle.startDate,
        plannedWeeks: active.cycle.plannedWeeks,
        startWeek: active.startWeek,
        weeksCommitted: active.weeksCommitted,
        stored: storedWeekDates(active.cycle.weeks),
      })
    : null;

  const carried = ledgerBalance(person.ledgerEntries);
  // The STORY, not just the number: where each debt came from, every payment
  // and write-off against it, and the running total after each (2.18).
  const balanceStory = ledgerStory(person.ledgerEntries);
  // Lock state (2.23), computed once server-side — the client renders labels.
  const now = new Date();
  const isLocked = person.pinLockedUntil !== null && person.pinLockedUntil > now;
  const lockedMinutesLeft = isLocked
    ? Math.max(1, Math.ceil((person.pinLockedUntil!.getTime() - now.getTime()) / 60_000))
    : null;
  const lockedUntilLabel = isLocked
    ? person.pinLockedUntil!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;
  const defaultPinOn = await getSetting("defaultPinFromPhone");
  const pinState: PinState =
    person.pinHash !== null
      ? "own"
      : defaultPinOn && defaultPinForPhone(person.phone) !== null
        ? "default"
        : "none";

  // THREE COUNTS, ON EVERY TAB.
  //
  // The tab bar shows a number beside Receipts, Messages and History, so these
  // are needed whichever tab is open — and they are `count` queries, not row
  // loads, which is the whole reason the rows themselves could stop being
  // fetched everywhere. The message count also feeds the removal dialog on
  // Settings, which states what the delete is blocked by.
  const [messageCount, paymentEventCount] = await Promise.all([
    prisma.messageLog.count({ where: { personId: person.id } }),
    active
      ? prisma.paymentEvent.count({ where: { participationId: active.id } })
      : Promise.resolve(0),
  ]);

  // Only the Settings tab renders the removal form that needs this one.
  const sessionCount =
    tab === "settings"
      ? await prisma.signInSession.count({ where: { personId: person.id } })
      : 0;

  // THE PAYOUT TOTALS, across every number they hold. A member with two
  // numbers receives twice, so the figure that answers "what do they get" is
  // the sum — the per-number table below still breaks it down.
  //
  // Recorded payouts win over projections: once a number is drawn the stored
  // gross/fee/net is the fact, and recomputing it would let a later fee
  // change silently rewrite a payout that already happened (2.14).
  const payoutTotals = active
    ? active.luckyNumbers.reduce(
        (acc, n) => {
          const recorded = n.payouts[0] ?? null;
          const projected = calculatePayout({
            luckyNumber: { id: n.id, amount: n.amount },
            participation: { weeksCommitted: active.weeksCommitted },
            cycle: { feePercent: active.cycle.feePercent },
          });
          return {
            gross: acc.gross + (recorded?.grossAmount ?? projected.gross),
            fee: acc.fee + (recorded?.feeAmount ?? projected.fee),
            net: acc.net + (recorded?.netAmount ?? projected.net),
            settled: acc.settled || recorded !== null,
          };
        },
        { gross: 0, fee: 0, net: 0, settled: false },
      )
    : null;

  // MONEY FIRST, THEN TIME. The six were in no order at all — paid in, still
  // to save, cycle week, weeks behind, overdue, last payment — so the eye had
  // to sort them. Grouped, the first three answer "what about their money" and
  // the last three answer "where are they in the cycle".
  //
  // `tone` marks the one figure that may need action. Nothing else is
  // coloured, so when something IS coloured it means something.
  const stats =
    standing?.ok && active
      ? [
          {
            // 2.1: a savings group. What they have put in comes first.
            label: "Paid in",
            value: formatMoney(standing.data.contribution.paidIn),
            sub: `${standing.data.contribution.weeksCovered} of ${standing.data.contribution.weeksCommitted} weeks saved`,
          },
          {
            label: "Still to save",
            value: formatMoney(standing.data.contribution.stillToSave),
            sub:
              standing.data.contribution.stillToSave === 0
                ? "commitment complete"
                : "over the rest of their weeks",
          },
          {
            label: "Overdue",
            value: formatMoney(standing.data.amountOutstanding),
            sub:
              standing.data.amountOutstanding === 0
                ? "nothing owed right now"
                : "weeks whose window has closed",
            tone:
              standing.data.amountOutstanding > 0 ? ("problem" as const) : ("good" as const),
          },
          {
            label: "Cycle week",
            value: `${standing.data.currentCycleWeek}`,
            sub: `of ${active.cycle.plannedWeeks} · their wk ${active.startWeek}–${standing.data.finishWeek}`,
          },
          {
            label: "Weeks behind",
            value: `${standing.data.weeksBehind}`,
            sub: standing.data.weeksBehind === 0 ? "current" : "needs catching up",
          },
          {
            label: "Last payment",
            value:
              standing.data.lastPaymentWeek === null ? "—" : `wk ${standing.data.lastPaymentWeek}`,
            sub:
              standing.data.lastPaymentWeek === null
                ? "nothing yet"
                : formatDateUTC(
                    standing.data.weeks.find(
                      (w) => w.weekNumber === standing.data.lastPaymentWeek,
                    )!.date,
                  ),
          },
        ]
      : [];

  return (
    <main className="space-y-4">
      {/* ————— HEADER — a profile, not a row of facts —————

          It was one flat plane: name, phone, three chips of three different
          KINDS and a big button all on one line, then six figures in a
          five-column grid so the sixth wrapped alone onto a second row. There
          was nothing to read first.

          Now it is what a profile is: WHO on the left with their identity
          chips under the name, the one action on the right, and the figures on
          their own strip below a rule — separated, evenly weighted, and in a
          deliberate order. */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-[var(--page-bg)] px-4 pb-3 pt-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--page-bg)]/85 dark:border-gray-800 sm:-mx-6 sm:px-6">
        <p className="mb-2 text-sm">
          <Link
            href="/admin/people"
            className="inline-flex min-h-8 items-center gap-1 text-gray-600 transition-colors hover:text-indigo-700 hover:underline dark:text-gray-400 dark:hover:text-indigo-300"
          >
            ← Directory
          </Link>
        </p>

        {/* ——— Identity ——— */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <span
            className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-indigo-100 text-2xl font-black text-indigo-700 ring-1 ring-indigo-200/70 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-900/70"
            aria-hidden="true"
          >
            {[...person.nameEnglishFirst][0] ?? [...person.nameAmharic][0] ?? "?"}
          </span>

          <div className="min-w-0 flex-1">
            {/* LATIN PRIMARY (14 Aug 2026) — the Amharic name renders under
                it where present, and nothing renders where it is absent. */}
            <h1 className="text-2xl font-black leading-tight tracking-tight text-gray-900 dark:text-white text-balance">
              {personDisplayName(person)}
            </h1>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              {personSecondaryName(person)}
              {person.phone && (
                <>
                  <span aria-hidden="true" className="mx-1.5 opacity-50">
                    ·
                  </span>
                  <a
                    href={`tel:${person.phone}`}
                    className="tabular-nums hover:text-indigo-700 hover:underline dark:hover:text-indigo-300"
                  >
                    {person.phone}
                  </a>
                </>
              )}
              {!person.phone && (
                <>
                  <span aria-hidden="true" className="mx-1.5 opacity-50">
                    ·
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">no phone</span>
                </>
              )}
            </p>

            {/* Chips on their OWN line, in one order: what they hold, then how
                they get in. Mixed into the name line they read as one
                undifferentiated cluster. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {active?.luckyNumbers.map((n) => (
                <span
                  key={n.id}
                  className="inline-flex select-none items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black tabular-nums"
                  style={{
                    background: "var(--gold-badge-bg)",
                    borderColor: "var(--gold-badge-border)",
                    color: "var(--gold-badge-text)",
                  }}
                >
                  #{n.number}
                  <span className="font-semibold opacity-75">{formatMoney(n.amount)}/wk</span>
                </span>
              ))}
              {pinState === "own" ? (
                <Pill tone="good">Own PIN</Pill>
              ) : pinState === "default" ? (
                <Pill tone="attention">Default PIN (last 4)</Pill>
              ) : (
                <Pill tone="neutral">OTP only</Pill>
              )}
              <Pill tone={person.authUserId ? "accent" : "neutral"}>
                {person.authUserId ? "Sign-in linked" : "Never signed in"}
              </Pill>
            </div>
          </div>

          {/* The one action. Solid ONLY when something is actually owed — a
              permanently loud button teaches the organizer to ignore it. */}
          {active && standing?.ok && (
            <Link
              href={`/admin/people/${person.id}?tab=payments`}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-bold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                standing.data.amountOutstanding > 0
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "border border-gray-300 bg-white text-gray-800 hover:border-gray-400 dark:border-gray-700 dark:bg-[#141414] dark:text-gray-200 dark:hover:border-gray-600"
              }`}
            >
              Record payment
            </Link>
          )}
        </div>

        {/* ——— The figures, on their own strip ———
            Six across at desktop so none is orphaned, three at tablet, two on
            a phone. Divided rather than merely spaced: at 2-up the eye needs
            to know which sub-line belongs to which figure. */}
        {stats.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 sm:grid-cols-3 xl:grid-cols-6">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-[var(--page-bg)] px-3 py-2">
                <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  {stat.label}
                </dt>
                <dd
                  className={`mt-0.5 text-base font-black tabular-nums leading-none ${
                    "tone" in stat && stat.tone === "problem"
                      ? "text-red-700 dark:text-red-400"
                      : "text-gray-900 dark:text-white"
                  }`}
                >
                  {stat.value}
                </dd>
                <dd className="mt-1 text-[11px] leading-snug text-gray-600 dark:text-gray-400 text-pretty">
                  {stat.sub}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {/* The tabs belong INSIDE the sticky header: they are how you move
            around this page, and a navigation that scrolls away is a
            navigation you have to scroll back to find. */}
        <MemberTabBar
          personId={person.id}
          active={tab}
          counts={{
            receipts: paymentEventCount,
            numbers: active?.luckyNumbers.length ?? 0,
            cycles: person.participations.length,
            messages: messageCount,
          }}
        />
      </header>

      {/* NOT ON THE MESSAGES TAB.
          `active` is the participation in a cycle whose status is ACTIVE, so
          the moment a cycle closes it is null for EVERY member — and this card
          then led every profile with "Not in the current cycle · Add them",
          directly above the closing-statement panel that exists for exactly
          that day. The advice was also wrong: adding a member to a cycle that
          has ended is not what the organizer is there to do.
          Messages works without a live participation on purpose (2.18), so it
          is the one tab this card must not cover. */}
      {active === null && tab !== "settings" && tab !== "history" && tab !== "messages" && (
        <Card className="px-5 py-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Not in the current cycle</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            <Link
              href="/admin/cycle/add"
              className="font-semibold text-indigo-700 dark:text-indigo-300 underline"
            >
              Add them
            </Link>{" "}
            to include them, or use Settings and History.
          </p>
        </Card>
      )}

      {/* ————— TAB 1: PAYMENTS — everything about money IN ————— */}
      {tab === "payments" && active && catchUp?.ok && standing?.ok && (
        <Card>
          <CardHeader
            title={`Payments — ${active.cycle.name}`}
            sub="Their weeks and every action on them. Recording flows through the one engine (2.19)."
          />
          <div className="px-5 pb-4">
            <MemberPayments
              participationId={active.id}
              memberName={person.nameEnglishFirst}
              outstanding={standing.data.amountOutstanding}
              carriedBalance={carried}
              personId={person.id}
              weeks={catchUp.data.weeks.map((w) => ({
                weekNumber: w.weekNumber,
                date: w.date.toISOString(),
                amountDue: w.amountDue,
                amountAlreadyPaid: w.amountAlreadyPaid,
                isDeferred: w.isDeferred,
                isSkipped: w.isSkipped,
                // THE FALLBACK USED TO GUESS. It read
                // `isSkipped ? … : isDeferred ? … : "UNPAID"` — no date, no
                // clock — so a week whose window had closed unpaid came out
                // UNPAID, the same collapse that put seven late members under
                // "have not paid" on /admin/this-week. It only fires when a
                // week is missing from the standing, which should not happen;
                // when it does, the answer must still be derived rather than
                // assumed (2.14, 2.19).
                status:
                  standing.data.weeks.find((sw) => sw.weekNumber === w.weekNumber)?.status ??
                  paymentStatus({
                    amountPaid: w.amountAlreadyPaid,
                    amountDue: w.amountDue,
                    isDeferred: w.isDeferred,
                    isSkipped: w.isSkipped,
                    weekDate: w.date,
                    today: new Date(),
                  }),
              }))}
            />
          </div>
        </Card>
      )}

      {/* ————— TAB 2: PAYOUT ————— */}
      {tab === "payout" && (
        <div className="space-y-4">
          {/* The fee, findable. It was one column of a five-column table. */}
          {active && payoutTotals && (
            <PayoutEquation
              gross={payoutTotals.gross}
              fee={payoutTotals.fee}
              net={payoutTotals.net}
              feePercent={active.cycle.feePercent}
              settled={payoutTotals.settled}
              numberCount={active.luckyNumbers.length}
              className="animate-fade-in-up-1"
            />
          )}
          {(carried > 0 || person.ledgerEntries.length > 0) && (
            <Card>
              <CardHeader
                title="Carried balance"
                sub="From earlier cycles — it belongs to them, not to a cycle, and can be settled or written off at any time (2.18)."
                right={
                  <Link
                    href="/admin/balances"
                    className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
                  >
                    All balances →
                  </Link>
                }
              />
              <div className="px-5 pb-4">
                <CarriedBalance
                  personId={person.id}
                  personName={person.nameEnglishFirst}
                  story={{
                    balance: balanceStory.balance,
                    raised: balanceStory.raised,
                    repaid: balanceStory.repaid,
                    forgiven: balanceStory.forgiven,
                    entries: balanceStory.entries.map((e) => ({
                      id: e.id,
                      type: e.type,
                      amount: e.amount,
                      description: e.description,
                      notes: e.notes,
                      method: e.method,
                      occurredAt: e.occurredAt.toISOString(),
                      balanceAfter: e.balanceAfter,
                    })),
                  }}
                />
              </div>
            </Card>
          )}
          {active === null ? (
            <Card className="px-5 py-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No payout — they are not in the current cycle.
              </p>
            </Card>
          ) : (
            <Card>
              <CardHeader
                title="Payout"
                sub={
                  <>
                    {formatMoney(active.weeklyAmount)}/week · from week {active.startWeek}
                    {payoutFinish !== null && <> · {finishLine(payoutFinish, formatDateLongUTC, active.cycle.plannedWeeks)}</>}
                  </>
                }
              />
              <div className="px-5 pb-4">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {["Number", "Gross", "Fee", "Net", "Draw status"].map((h) => (
                        <th
                          key={h}
                          className="border-b border-gray-200 dark:border-gray-800 py-2 pr-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {active.luckyNumbers.map((n) => {
                      const projected = calculatePayout({
                        luckyNumber: { id: n.id, amount: n.amount },
                        participation: { weeksCommitted: active.weeksCommitted },
                        cycle: { feePercent: active.cycle.feePercent },
                      });
                      const payout = n.payouts[0] ?? null;
                      const draw = n.slotMembers.map((sm) => sm.slot.draws[0]).find(Boolean) ?? null;
                      return (
                        <tr key={n.id}>
                          <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 font-semibold tabular-nums text-gray-900 dark:text-white">
                            #{n.number}
                          </td>
                          <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                            {formatMoney(payout?.grossAmount ?? projected.gross)}
                          </td>
                          <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                            {formatMoney(payout?.feeAmount ?? projected.fee)}
                          </td>
                          <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 font-bold tabular-nums text-gray-900 dark:text-white">
                            {formatMoney(payout?.netAmount ?? projected.net)}
                          </td>
                          <td className="border-b border-gray-100 dark:border-gray-800/60 py-2">
                            {draw ? (
                              payout?.status === "COLLECTED" ? (
                                <Pill tone="good">drawn wk {draw.week.weekNumber} · collected</Pill>
                              ) : payout ? (
                                <Pill tone="attention">drawn wk {draw.week.weekNumber} · pending</Pill>
                              ) : (
                                <Pill tone="attention">drawn wk {draw.week.weekNumber}</Pill>
                              )
                            ) : (
                              <Pill tone="accent">still in the draw</Pill>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {active.luckyNumbers.some((n) => n.payouts.length > 0) && (
                  <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                    Net is what actually crosses the table — a win-week contribution settled from
                    the payout is already deducted. Manage the payout rows on{" "}
                    <Link
                      href="/admin/collections"
                      className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
                    >
                      Collections
                    </Link>
                    .
                  </p>
                )}

                {/* 2.2: the organizer may simply DECIDE to pay someone out. */}
                <div className="mt-4 border-t border-gray-100 dark:border-gray-800/60 pt-4">
                  <AssignPayout participationId={active.id} />
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ————— TAB 3: RECEIPTS — the audit trail ————— */}
      {tab === "receipts" && (
        <Card>
          <CardHeader
            title="Receipts"
            sub="Every payment event, newest facts first in the money's own order. Week amounts derive from these — edit or delete one and every week recalculates (D-32)."
          />
          <div className="px-5 pb-4">
            {active === null ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No receipts — they are not in the current cycle.
              </p>
            ) : (
              <ParticipationEditor
                show={{ participation: false, luckyNumbers: false, receipts: true, weeks: false }}
                participation={{
                  id: active.id,
                  weeklyAmount: active.weeklyAmount,
                  startWeek: active.startWeek,
                  weeksCommitted: active.weeksCommitted,
                  plannedWeeks: active.cycle.plannedWeeks,
                  cycleStartDate: active.cycle.startDate.toISOString(),
                  cycleWeeks: active.cycle.weeks.map((w) => ({
                    weekNumber: w.weekNumber,
                    date: w.date.toISOString(),
                  })),
                  personName: person.nameEnglishFirst,
                  cycleName: active.cycle.name,
                  unitAmount: active.cycle.unitAmount,
                  feePercent: active.cycle.feePercent,
                  closed: closedState,
                }}
                luckyNumbers={active.luckyNumbers.map((n) => ({
                  id: n.id,
                  number: n.number,
                  amount: n.amount,
                }))}
                events={paymentEvents.map((e) => ({
                  id: e.id,
                  amount: e.amount,
                  method: e.method,
                  receivedAt: e.receivedAt.toISOString(),
                  notes: e.notes,
                  // Structural, per the schema comment on PaymentEvent: this
                  // pair of links IS the definition of a settlement receipt.
                  settlement: e.pinnedWeekId !== null && e.settlementPayoutId !== null,
                }))}
                weeks={active.payments.map((p) => ({
                  paymentId: p.id,
                  weekNumber: p.week.weekNumber,
                  date: formatDateUTC(p.week.date),
                  amountPaid: p.amountPaid,
                  isDeferred: p.isDeferred,
                  method: p.method,
                  paidAt: p.paidAt?.toISOString() ?? null,
                  notes: p.notes,
                }))}
              />
            )}
            {/* Always rendered, even on a single page: "All 12 receipts." is
                what stops someone concluding a receipt was never recorded
                because they could not scroll to it. */}
            {active !== null && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800/60">
                <Pager
                  info={receiptInfo}
                  noun={{ one: "receipt", many: "receipts" }}
                  label="Receipt pages"
                  hrefFor={(p) => `?tab=receipts&receiptsPage=${p}${receiptsPageSize !== PAGE_SIZES.receipts ? `&receiptsPageSize=${receiptsPageSize}` : ""}`}
                />
                <PageSizeSelect
                  param="receiptsPageSize"
                  pageParam="receiptsPage"
                  dflt={PAGE_SIZES.receipts}
                  storageKey="admin-receipts-page-size"
                />
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ————— TAB 4: MESSAGES — the individual case —————

          The batch composer sends one type to everyone it applies to, and
          that stays. What it could not do is the common thing: the organizer
          is looking at someone six weeks behind and wants to send HER a
          notice, which meant leaving her page, opening Messages, finding her
          in a batch and unchecking twenty-six people. */}
      {tab === "messages" && (
        <div className="animate-fade-in-up-1">
          {messaging === null || !messaging.ok ? (
            <Card className="px-5 py-4">
              <p className="text-sm text-red-800 dark:text-red-400">
                {messaging && !messaging.ok ? messaging.error : "Could not load messaging."}
              </p>
            </Card>
          ) : (
            <MemberMessaging view={messaging.data} personName={person.nameEnglishFirst} />
          )}
        </div>
      )}

      {/* ————— TAB 5: SETTINGS — participation lives HERE and nowhere else ————— */}
      {/* ————— TAB 4: SETTINGS — three jobs, one at a time —————

          This was a single scroll holding participation, lucky numbers, names,
          phone, PIN, messaging and sign-in history. Every form was correct and
          the screen was unreadable: you could not tell where one job ended and
          the next began, so reaching the PIN controls meant scrolling past a
          money form that can re-settle a payout.

          Nothing was removed. They are separated, and each one now has room to
          say what it is for. */}
      {tab === "settings" && (
        <div className="space-y-5">
          <SectionNav
            label="Settings sections"
            active={section}
            sections={[
              { key: "participation", label: SETTINGS_SECTION_LABELS.participation },
              { key: "person", label: SETTINGS_SECTION_LABELS.person },
              {
                key: "access",
                label: SETTINGS_SECTION_LABELS.access,
                count: signIns.ok ? signIns.data.total : undefined,
                // The default PIN is a standing risk, so the section that
                // fixes it says so from the nav rather than only once opened.
                attention: pinState === "default",
              },
            ]}
            hrefFor={(key) => `/admin/people/${person.id}?tab=settings&section=${key}`}
            className="animate-fade-in-up"
          />

          {section === "participation" && (
            <div className="space-y-4 animate-fade-in-up-1">
              <SectionHeading title="Participation and money">
                What they pay, for how long, and which numbers are theirs. Saving replays
                their receipts against the new shape — with a live settlement step if they
                have already been drawn (2.18). Nothing here is written until you press save.
              </SectionHeading>
              {/* No CardHeader on the card below: the SectionHeading above
                  already says this, and a heading repeated verbatim two lines
                  apart reads as a rendering fault rather than as emphasis. */}
              {active !== null ? (
            <Card>
              <div className="px-5 py-5">
                <ParticipationEditor
                  show={{
                    participation: true,
                    luckyNumbers: true,
                    receipts: false,
                    weeks: false,
                  }}
                  participation={{
                    id: active.id,
                    weeklyAmount: active.weeklyAmount,
                    startWeek: active.startWeek,
                    weeksCommitted: active.weeksCommitted,
                    plannedWeeks: active.cycle.plannedWeeks,
                    cycleStartDate: active.cycle.startDate.toISOString(),
                    cycleWeeks: active.cycle.weeks.map((w) => ({
                      weekNumber: w.weekNumber,
                      date: w.date.toISOString(),
                    })),
                    personName: person.nameEnglishFirst,
                    cycleName: active.cycle.name,
                    unitAmount: active.cycle.unitAmount,
                    feePercent: active.cycle.feePercent,
                    closed: closedState,
                  }}
                  luckyNumbers={active.luckyNumbers.map((n) => ({
                    id: n.id,
                    number: n.number,
                    amount: n.amount,
                  }))}
                  events={paymentEvents.map((e) => ({
                    id: e.id,
                    amount: e.amount,
                    method: e.method,
                    receivedAt: e.receivedAt.toISOString(),
                    notes: e.notes,
                    settlement: e.pinnedWeekId !== null && e.settlementPayoutId !== null,
                  }))}
                  weeks={active.payments.map((p) => ({
                    paymentId: p.id,
                    weekNumber: p.week.weekNumber,
                    date: formatDateUTC(p.week.date),
                    amountPaid: p.amountPaid,
                    isDeferred: p.isDeferred,
                    method: p.method,
                    paidAt: p.paidAt?.toISOString() ?? null,
                    notes: p.notes,
                  }))}
                />
              </div>
            </Card>
              ) : (
                <Card className="px-5 py-4">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    {person.nameEnglishFirst} is not in the running cycle, so there is no
                    participation to edit. Their name, phone and access are still on the other
                    two sections, and their record is under History.
                  </p>
                </Card>
              )}
            </div>
          )}

          {section === "person" && (
            <div className="space-y-4 animate-fade-in-up-1">
              <SectionHeading title="Name and phone">
                Carries to every cycle (2.5). The phone is also their sign-in identity on
                every door, so changing it is a credential change — the form says so before
                it saves.
              </SectionHeading>
              <Card>
                <div className="px-5 py-5">
                  <PersonEditForm
                    person={{
                      id: person.id,
                      nameAmharic: person.nameAmharic,
                      nameEnglishFirst: person.nameEnglishFirst,
                      nameEnglishLast: person.nameEnglishLast,
                      phone: person.phone,
                      participationCount: person.participations.length,
                      pinState,
                      ledgerEntryCount: person.ledgerEntries.length,
                      messageCount: messageCount,
                      sessionCount: sessionCount,
                    }}
                  />
                </div>
              </Card>
            </div>
          )}

          {section === "access" && (
            <div className="space-y-4 animate-fade-in-up-1">
              <SectionHeading title="Access and messaging">
                How {person.nameEnglishFirst} gets in, what the product is allowed to send
                them, and the evidence that answers &ldquo;was that really them?&rdquo;
              </SectionHeading>

              {/* FIRST, BECAUSE IT IS THE OUTERMOST DOOR. A PIN gets them to
                  the portal; an unsigned agreement stops them at it whatever
                  their PIN is. It also states whether they set their own PIN,
                  which is the fact the card below then gives the controls
                  for — both read `pinHash`, so they cannot disagree. */}
              {agreement !== null &&
                (agreement.ok ? (
                  <AgreementSigningCard
                    personName={person.nameEnglishFirst}
                    state={agreement.data}
                  />
                ) : (
                  <Card className="px-5 py-4">
                    <p role="alert" className="text-sm text-red-800 dark:text-red-400">
                      {agreement.error}
                    </p>
                  </Card>
                ))}

              <Card>
                <CardHeader title="PIN sign-in" />
                <div className="px-5 pb-5">
                  <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
                    {pinState === "own" ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        They set their own PIN.
                      </span>
                    ) : pinState === "default" ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                        Still on the default — the last 4 digits of their phone sign them in.
                        Anyone who has their number could use it.
                      </span>
                    ) : (
                      <span className="text-gray-600 dark:text-gray-400">
                        No PIN — they sign in with a code, or set one below.
                      </span>
                    )}
                  </p>
                  <PinControls
                    personId={person.id}
                    personName={person.nameEnglishFirst}
                    pinSet={person.pinHash !== null}
                    pinLoginAllowed={person.pinLoginAllowed}
                    pinFailedAttempts={person.pinFailedAttempts}
                    lockedMinutesLeft={lockedMinutesLeft}
                    lockedUntilLabel={lockedUntilLabel}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Messaging"
                  sub="Whether this member receives anything the product sends (2.28)."
                />
                <div className="px-5 pb-5">
                  <MessagesOptOut personId={person.id} noMessages={person.noMessages} />
                </div>
              </Card>

              {/* Ruling 6: "was that you?", answerable. Sits under Settings
                  beside the PIN controls, because reset-their-PIN is the action
                  this evidence usually leads to. */}
              <Card>
                <CardHeader
                  title="Recent sign-ins"
                  sub="Device, network and time for this member's last sign-ins — so you can answer “was that you?”"
                />
                <div className="px-5 pb-4">
                  <MemberSignIns rows={signIns.ok ? signIns.data.rows : []} />
              <TruncationNotice
                notice={truncationNotice({
                  shown: signIns.ok ? signIns.data.rows.length : 0,
                  cap: CAPS.memberSignIns,
                  noun: "sign-ins",
                  fullListAt: "the audit log",
                })}
              />
                  {!signIns.ok && (
                    <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-400">
                      {signIns.error}
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ————— TAB 6: HISTORY ————— */}
      {tab === "history" && (
        <Card>
          <CardHeader title="History" sub="Every cycle this person has been part of." />
          <div className="px-5 pb-4">
            {person.participations.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">Never been in a cycle.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["Cycle", "Contribution", "Weeks", "Status"].map((h) => (
                      <th
                        key={h}
                        className="border-b border-gray-200 dark:border-gray-800 py-2 pr-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {person.participations.map((p) => (
                    <tr key={p.id}>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 font-semibold text-gray-900 dark:text-white">
                        {p.cycle.name}
                        {p.cycle.status === "ACTIVE" ? " (current)" : ""}
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                        {formatMoney(p.weeklyAmount)}/week
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                        {p.startWeek}–{calculateFinishWeek(p.startWeek, p.weeksCommitted)}
                        <span className="ml-1.5 font-normal text-gray-600 dark:text-gray-400">
                          {(() => {
                            const r = resolveWeekDate({
                              weekNumber: calculateFinishWeek(p.startWeek, p.weeksCommitted),
                              stored: storedWeekDates(p.cycle.weeks),
                              cycleStartDate: p.cycle.startDate,
                            });
                            return r === null ? "" : formatDateUTC(r.date);
                          })()}
                        </span>
                      </td>
                      <td className="border-b border-gray-100 dark:border-gray-800/60 py-2">
                        <Pill tone={p.status === "ACTIVE" ? "good" : "neutral"}>
                          {p.status === "ACTIVE" ? "Active" : "Closed"}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}
    </main>
  );
}
