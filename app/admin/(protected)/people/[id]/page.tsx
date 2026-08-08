import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatchUpWeeks } from "@/app/actions/payments-view";
import { getMemberStanding } from "@/app/actions/payments";
import { listMemberSignIns } from "@/app/actions/sessions";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { finishLine, finishPreview, resolveWeekDate, storedWeekDates } from "@/lib/commitment";
import { formatDateLongUTC, formatDateUTC, formatMoney } from "@/lib/format";
import { ledgerBalance, ledgerStory } from "@/lib/ledger";
import { calculateFinishWeek } from "@/lib/money";
import type { PinState } from "@/lib/person-record";
import { defaultPinForPhone } from "@/lib/pin";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { calculatePayout } from "@/lib/wheel";
import { AssignPayout } from "./assign-payout";
import { CarriedBalance } from "./carried-balance";
import { MemberPayments } from "./member-payments";
import { MemberSignIns } from "./member-sign-ins";
import { MemberTabBar, parseTab } from "./member-tabs";
import { MessagesOptOut } from "./messages-opt-out";
import { ParticipationEditor } from "./participation-editor";
import { PersonEditForm } from "./person-edit-form";
import { PinControls } from "./pin-controls";

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
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // A member's identity and money (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Member" />;
  const { id } = await params;
  const tab = parseTab((await searchParams).tab);

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
          paymentEvents: { orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] },
          payments: { include: { week: true }, orderBy: { week: { weekNumber: "asc" } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!person) notFound();

  const active =
    person.participations.find((p) => p.status === "ACTIVE" && p.cycle.status === "ACTIVE") ?? null;

  const [standing, catchUp] = active
    ? await Promise.all([getMemberStanding(active.id), getCatchUpWeeks(active.id)])
    : [null, null];

  // Ruling 6. Fetched only for the tab that shows it — the sign-in history is
  // never needed to render Payments or Payout.
  const signIns =
    tab === "settings"
      ? await listMemberSignIns({ personId: person.id })
      : ({ ok: true as const, data: [] });

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

  // The two counts the removal dialog needs to tell the truth about what the
  // database will actually allow, and what the delete would take with it.
  // Only the Settings tab renders that form.
  const [messageCount, sessionCount] =
    tab === "settings"
      ? await Promise.all([
          prisma.messageLog.count({ where: { personId: person.id } }),
          prisma.signInSession.count({ where: { personId: person.id } }),
        ])
      : [0, 0];

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
            label: "Overdue",
            value: formatMoney(standing.data.amountOutstanding),
            sub:
              standing.data.amountOutstanding === 0
                ? "nothing owed right now"
                : "weeks whose window has closed",
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
      {/* ————— HEADER — always visible, never scrolls away ————— */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-gray-200 dark:border-gray-800 bg-[var(--page-bg)]/95 px-4 pb-2 pt-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--page-bg)]/80 sm:-mx-6 sm:px-6">
        <p className="mb-1 text-sm">
          <Link href="/admin/people" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Directory
          </Link>
        </p>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <span
            className="flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-lg font-black text-indigo-700 dark:text-indigo-300"
            aria-hidden="true"
          >
            {[...person.nameEnglishFirst][0] ?? [...person.nameAmharic][0] ?? "?"}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-black leading-tight text-gray-900 dark:text-white text-balance">
              {person.nameAmharic}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
              <span>
                {person.nameEnglishFirst} {person.nameEnglishLast ?? ""}
              </span>
              <span className="tabular-nums">{person.phone ?? "no phone"}</span>
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
            </p>
          </div>

          {/* Lucky numbers with amounts — the canonical place they are shown. */}
          {active && (
            <span className="flex flex-wrap gap-1.5">
              {active.luckyNumbers.map((n) => (
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
            </span>
          )}

          {/* The primary action, always reachable. */}
          {active && standing?.ok && (
            <Link
              href={`/admin/people/${person.id}?tab=payments`}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97]"
            >
              {standing.data.amountOutstanding > 0
                ? `${formatMoney(standing.data.amountOutstanding)} overdue — Record payment`
                : "Record payment"}
            </Link>
          )}
        </div>

        {/* The five key figures, compact. */}
        {stats.length > 0 && (
          <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-5">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  {s.label}
                </dt>
                <dd className="text-sm font-black tabular-nums text-gray-900 dark:text-white">
                  {s.value}{" "}
                  <span className="font-normal text-[11px] text-gray-600 dark:text-gray-400">
                    {s.sub}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-2">
          <MemberTabBar
            personId={person.id}
            active={tab}
            counts={{
              receipts: active?.paymentEvents.length ?? 0,
              numbers: active?.luckyNumbers.length ?? 0,
              cycles: person.participations.length,
            }}
          />
        </div>
      </header>

      {active === null && tab !== "settings" && tab !== "history" && (
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
                status:
                  standing.data.weeks.find((sw) => sw.weekNumber === w.weekNumber)?.status ??
                  (w.isSkipped ? "SKIPPED" : w.isDeferred ? "DEFERRED" : "UNPAID"),
              }))}
            />
          </div>
        </Card>
      )}

      {/* ————— TAB 2: PAYOUT ————— */}
      {tab === "payout" && (
        <div className="space-y-4">
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
                }}
                luckyNumbers={active.luckyNumbers.map((n) => ({
                  id: n.id,
                  number: n.number,
                  amount: n.amount,
                }))}
                events={active.paymentEvents.map((e) => ({
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
          </div>
        </Card>
      )}

      {/* ————— TAB 4: SETTINGS — participation lives HERE and nowhere else ————— */}
      {tab === "settings" && (
        <div className="space-y-4">
          {active !== null && (
            <Card>
              <CardHeader
                title="Participation and lucky numbers"
                sub="The one place these are edited. Saving replays their receipts against the new shape, with a live settlement step if they have already been drawn (2.18)."
              />
              <div className="px-5 pb-4">
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
                  }}
                  luckyNumbers={active.luckyNumbers.map((n) => ({
                    id: n.id,
                    number: n.number,
                    amount: n.amount,
                  }))}
                  events={active.paymentEvents.map((e) => ({
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
          )}

          <Card>
            <CardHeader title="Person" sub="Carries to every cycle (2.5)." />
            <div className="grid gap-6 px-5 pb-5 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Names and phone
                </h3>
                <PersonEditForm
                  person={{
                    id: person.id,
                    nameAmharic: person.nameAmharic,
                    nameEnglishFirst: person.nameEnglishFirst,
                    nameEnglishLast: person.nameEnglishLast,
                    phone: person.phone,
                    participationCount: person.participations.length,
                    // The form warns about a credential change and states the
                    // real blockers on a removal. It can do neither without
                    // the facts, and this page already holds all of them.
                    pinState,
                    ledgerEntryCount: person.ledgerEntries.length,
                    messageCount: messageCount,
                    sessionCount: sessionCount,
                  }}
                />
              </div>
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  PIN sign-in
                </h3>
                <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
                  {pinState === "own" ? (
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      They set their own PIN.
                    </span>
                  ) : pinState === "default" ? (
                    // The badge the ruling keeps. The wording changed with it:
                    // the default now signs in on its own, so this is a
                    // standing risk to nudge, not a half-open door.
                    <span className="rounded bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-amber-900 dark:text-amber-300">
                      Still on the default — the last 4 digits of their phone sign them in. Anyone
                      who has their number could use it.
                    </span>
                  ) : (
                    <span className="text-gray-600 dark:text-gray-400">
                      No PIN — they sign in with a code, or set a PIN below.
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
                <div className="mt-5 border-t border-gray-200 dark:border-gray-800 pt-4">
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                    Messaging
                  </h3>
                  <MessagesOptOut personId={person.id} noMessages={person.noMessages} />
                </div>
              </div>
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
              <MemberSignIns rows={signIns.ok ? signIns.data : []} />
              {!signIns.ok && (
                <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-400">
                  {signIns.error}
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ————— TAB 5: HISTORY ————— */}
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
