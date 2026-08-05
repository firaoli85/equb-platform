import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatchUpWeeks } from "@/app/actions/payments-view";
import { getMemberStanding } from "@/app/actions/payments";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateUTC, formatMoney } from "@/lib/format";
import { ledgerBalance } from "@/lib/ledger";
import { calculateFinishWeek, dateOfWeek } from "@/lib/money";
import { defaultPinForPhone } from "@/lib/pin";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { calculatePayout } from "@/lib/wheel";
import { MemberPayments } from "./member-payments";
import { MessagesOptOut } from "./messages-opt-out";
import { ParticipationEditor } from "./participation-editor";
import { PersonEditForm } from "./person-edit-form";
import { PinControls } from "./pin-controls";

export const dynamic = "force-dynamic";

// THE member page: the whole person in one place. Section 1 is the person
// (2.5: permanent, carries to every cycle); section 2 is this cycle's
// participation and standing (per-cycle, resets); section 3 is history.
// Standing is derived by getMemberStanding — nothing recomputed here (2.14).
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  // A member's identity and money (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Member" />;
  const { id } = await params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      ledgerEntries: { orderBy: { createdAt: "asc" } },
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
    person.participations.find((p) => p.status === "ACTIVE" && p.cycle.status === "ACTIVE") ??
    null;

  const [standing, catchUp] = active
    ? await Promise.all([getMemberStanding(active.id), getCatchUpWeeks(active.id)])
    : [null, null];

  const carried = ledgerBalance(person.ledgerEntries);
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
  const pinState =
    person.pinHash !== null
      ? "own"
      : defaultPinOn && defaultPinForPhone(person.phone) !== null
        ? "default"
        : "none";

  return (
    <main className="space-y-6">
      {/* ————— Identity header ————— */}
      <header className="flex items-start gap-4 animate-fade-in-up">
        <span
          className="flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-xl font-black text-indigo-700 dark:text-indigo-300"
          aria-hidden="true"
        >
          {[...person.nameEnglishFirst][0] ?? [...person.nameAmharic][0] ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-sm">
            <Link href="/admin/people" className="text-gray-500 dark:text-gray-400 hover:underline">
              ← Directory
            </Link>
          </p>
          <h1 className="text-2xl font-black leading-tight text-gray-900 dark:text-white text-balance">
            {person.nameAmharic}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
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
      </header>

      {/* ————— SECTION 2 first in reading order: This cycle ————— */}
      {active === null ? (
        <Card className="animate-fade-in-up-1 px-5 py-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">This cycle</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Not in the current cycle.{" "}
            <Link href="/admin/cycle/add" className="font-semibold text-indigo-700 dark:text-indigo-300 underline">
              Add them
            </Link>{" "}
            to include them.
          </p>
        </Card>
      ) : (
        <section className="space-y-4 animate-fade-in-up-1" aria-label={`This cycle — ${active.cycle.name}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-black text-gray-900 dark:text-white">
              This cycle — {active.cycle.name}
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-500">resets next cycle (2.5)</span>
          </div>

          {/* Standing as stat cards — derived by getMemberStanding (2.14) */}
          {standing?.ok && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="Cycle week" figure={`${standing.data.currentCycleWeek}`} sub={`of ${active.cycle.plannedWeeks} planned`} />
              <StatCard
                label="Weeks paid"
                figure={`${Math.min(standing.data.weeksCredited, standing.data.weeksCommitted)} of ${standing.data.weeksCommitted}`}
                sub={`their window: wk ${active.startWeek}–${standing.data.finishWeek}`}
                delayClass="animate-fade-in-up-1"
              />
              <StatCard
                label="Weeks behind"
                figure={`${standing.data.weeksBehind}`}
                sub={standing.data.weeksBehind === 0 ? "current" : "needs catching up"}
                delayClass="animate-fade-in-up-1"
              />
              <StatCard
                label="Outstanding"
                cents={standing.data.amountOutstanding}
                sub={standing.data.surplus > 0 ? `${formatMoney(standing.data.surplus)} paid ahead` : "at the current rate"}
                delayClass="animate-fade-in-up-2"
              />
              <StatCard
                label="Last payment"
                figure={standing.data.lastPaymentWeek === null ? "—" : `wk ${standing.data.lastPaymentWeek}`}
                sub={
                  standing.data.lastPaymentWeek === null
                    ? "nothing yet"
                    : formatDateUTC(
                        standing.data.weeks.find(
                          (w) => w.weekNumber === standing.data.lastPaymentWeek,
                        )!.date,
                      )
                }
                delayClass="animate-fade-in-up-2"
              />
            </div>
          )}

          {/* Carried balance (2.18) — shown only when the person owes. */}
          {carried > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-300">
              Carried balance from earlier: <strong className="tabular-nums">{formatMoney(carried)}</strong>{" "}
              still owed (2.18 — remembered, never enforced).
            </div>
          )}

          {/* THE payment hub: record, catch up, defer, undo, note — every
              money action from HERE (2.19: same one engine underneath). */}
          {catchUp?.ok && standing?.ok && (
            <Card tone="hero">
              <CardHeader
                title="Payments"
                sub="Their weeks, and every action on them — recording flows through the one engine (2.19)."
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
                    status:
                      standing.data.weeks.find((sw) => sw.weekNumber === w.weekNumber)?.status ??
                      (w.isDeferred ? "DEFERRED" : "UNPAID"),
                  }))}
                />
              </div>
            </Card>
          )}

          {/* Participation facts */}
          <Card>
            <CardHeader
              title="Participation"
              sub={
                <>
                  {formatMoney(active.weeklyAmount)}/week · weeks {active.startWeek}–
                  {calculateFinishWeek(active.startWeek, active.weeksCommitted)} · finishes{" "}
                  {formatDateUTC(
                    dateOfWeek(
                      active.cycle.startDate,
                      calculateFinishWeek(active.startWeek, active.weeksCommitted),
                    ),
                  )}
                </>
              }
              right={
                <span className="flex flex-wrap justify-end gap-1.5">
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
              }
            />

            {/* Payout per lucky number */}
            {standing?.ok && (
              <div className="px-5 pb-4">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {["Number", "Gross", "Fee", "Net", "Draw status"].map((h, i) => (
                        <th
                          key={h}
                          className={`border-b border-gray-200 dark:border-gray-800 py-2 pr-3 text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 ${i === 4 ? "" : ""} text-left`}
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
              </div>
            )}
          </Card>

          {/* Edit participation — live recalculation preview before saving. */}
          <Card>
            <div className="px-5 py-4">
              <ParticipationEditor
                participation={{
                  id: active.id,
                  weeklyAmount: active.weeklyAmount,
                  startWeek: active.startWeek,
                  weeksCommitted: active.weeksCommitted,
                  plannedWeeks: active.cycle.plannedWeeks,
                  personName: person.nameEnglishFirst,
                  cycleName: active.cycle.name,
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
        </section>
      )}

      {/* ————— SECTION 1 — Person (permanent) ————— */}
      <Card className="animate-fade-in-up-2">
        <CardHeader title="Person" sub="Carries to every cycle (2.5)." />
        <div className="grid gap-6 px-5 pb-5 md:grid-cols-2">
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Edit person (D-32)
            </h3>
            <PersonEditForm
              person={{
                id: person.id,
                nameAmharic: person.nameAmharic,
                nameEnglishFirst: person.nameEnglishFirst,
                nameEnglishLast: person.nameEnglishLast,
                phone: person.phone,
                participationCount: person.participations.length,
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
                <span className="rounded bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-amber-900 dark:text-amber-300">
                  Still on the default — the last 4 digits of their phone sign them in.
                </span>
              ) : (
                <span className="text-gray-600 dark:text-gray-400">
                  No PIN and no usable phone for the default — they need OTP, or set a PIN below.
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

      {/* ————— SECTION 3 — History ————— */}
      <Card className="animate-fade-in-up-3">
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
    </main>
  );
}
