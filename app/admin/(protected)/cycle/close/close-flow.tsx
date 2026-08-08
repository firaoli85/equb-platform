"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { closeCycle, deleteClosedCycle, getDeleteReview } from "@/app/actions/cycle-close";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Alert, buttonCls, Card, CardHeader, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import type { MemberFinal } from "@/lib/cycle-close";
import { formatMoney } from "@/lib/format";

type Review = {
  cycleId: string;
  cycleName: string;
  plannedWeeks: number;
  members: MemberFinal[];
  undrawn: { name: string; numbers: number[] }[];
  pendingPayouts: { number: number; who: string; net: number }[];
  openWeeks: number[];
  cash: { received: number; paidOut: number; stillHeld: number };
  totalOutstanding: number;
  membersShort: number;
  statementsSent: number;
  memberCount: number;
  /**
   * How long since the final week, against the configured wait (2.6). The
   * whole point is to say WHY closing is not offered yet — a button that is
   * simply dead reads as a bug.
   */
  timing: {
    state: "too-soon" | "ready";
    reason: string;
    daysRemaining: number;
    availableOn: string | null;
  };
};

// STEP 1 (review) + STEP 2 (close). Statements ride the one messaging flow
// (2.20/2.21) and go out BEFORE the status flips — the review keeps count.
export function CloseFlow({ review }: { review: Review }) {
  const router = useRouter();
  const [acknowledge, setAcknowledge] = useState("");
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const needsAck = review.undrawn.length > 0;
  const ackOk = !needsAck || acknowledge.trim().length > 0;
  const tooSoon = review.timing.state === "too-soon";

  async function doClose(typedPhrase: string) {
    setBusy(true);
    setMsg(null);
    try {
      const result = await closeCycle({
        cycleId: review.cycleId,
        // WHAT THE ORGANIZER TYPED. This sent `review.cycleName` — the
        // component's own copy of the expected value — so the server's
        // `input.typedName.trim() !== cycle.name` check passed
        // unconditionally. Closing writes a carried debt onto every short
        // member and freezes the books; the confirmation that guards it
        // must be a real one, not the client agreeing with itself.
        typedName: typedPhrase,
        acknowledgeUndrawn: needsAck ? acknowledge : undefined,
      });
      if (!result.ok) setMsg({ kind: "err", text: `Not closed: ${result.error}` });
      else {
        setMsg({
          kind: "ok",
          text: `✓ ${review.cycleName} is CLOSED — ${result.data.debts} carried debt${result.data.debts === 1 ? "" : "s"} written to the ledger, archive saved.`,
        });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing was closed." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {/* ————— 2.27: nobody may be quietly missed ————— */}
      {needsAck ? (
        <Card tone="danger">
          <CardHeader
            title={`${review.undrawn.length} member${review.undrawn.length === 1 ? " has" : "s have"} paid in and never been drawn`}
            sub="Closing is blocked until this is resolved on the wheel — or explicitly acknowledged with a reason (2.27)."
          />
          <div className="space-y-3 px-5 pb-4">
            <ul className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
              {review.undrawn.map((m) => (
                <li key={m.name}>
                  <strong>{m.name}</strong>{" "}
                  {/* The blocker says this is resolved on the wheel, so the
                      numbers ARE the way there — §8: a lucky number opens the
                      wheel. Naming a fix without a route to it is the gap this
                      sweep exists to close. */}
                  <Link
                    href="/admin/wheel/setup"
                    className="tabular-nums text-gray-600 hover:text-indigo-700 hover:underline dark:text-gray-400 dark:hover:text-indigo-300"
                  >
                    ({m.numbers.map((n) => `#${n}`).join(", ")})
                  </Link>
                </li>
              ))}
            </ul>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                To close anyway, write down WHY — the audit entry keeps it
              </span>
              <textarea
                value={acknowledge}
                onChange={(e) => setAcknowledge(e.target.value)}
                rows={2}
                placeholder="e.g. They agreed to roll into Cycle 2 with their balance intact"
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </label>
          </div>
        </Card>
      ) : (
        <Alert kind="ok">Everyone has been drawn — 2.27 is satisfied.</Alert>
      )}

      {/* ————— The cash position ————— */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Received" cents={review.cash.received} sub="every receipt in this cycle" />
        <StatCard label="Paid out" cents={review.cash.paidOut} sub="collected payouts, net" />
        <StatCard
          label="Still held"
          cents={review.cash.stillHeld}
          sub="received minus handed over"
          emphasis={review.cash.stillHeld !== 0}
        />
      </div>

      {/* ————— Unfinished business (shown, never silently skipped) ————— */}
      {(review.pendingPayouts.length > 0 || review.openWeeks.length > 0) && (
        <Card>
          <CardHeader title="Still unfinished" sub="Closing does not resolve these — they are listed so nothing closes unseen." />
          <div className="space-y-2 px-5 pb-4 text-sm">
            {review.pendingPayouts.length > 0 && (
              <p className="text-gray-800 dark:text-gray-200">
                <Pill tone="attention">
                  {review.pendingPayouts.length} pending payout{review.pendingPayouts.length === 1 ? "" : "s"}
                </Pill>{" "}
                {review.pendingPayouts
                  .map((p) => `#${p.number} ${p.who} (${formatMoney(p.net)})`)
                  .join(" · ")}{" "}
                — money drawn but not handed over.{" "}
                <Link href="/admin/collections" className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">
                  Collections →
                </Link>
              </p>
            )}
            {review.openWeeks.length > 0 && (
              <p className="text-gray-800 dark:text-gray-200">
                <Pill tone="neutral">
                  {review.openWeeks.length} week{review.openWeeks.length === 1 ? "" : "s"} without a draw
                </Pill>{" "}
                <span className="tabular-nums">weeks {review.openWeeks.join(", ")}</span> — not
                skipped and never drawn.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ————— Every member's final position ————— */}
      <Card>
        <CardHeader
          title="Final positions"
          sub={`${review.memberCount} members · ${review.membersShort} short by ${formatMoney(review.totalOutstanding)} in total — each shortfall becomes a carried ledger debt on the PERSON at close (2.18).`}
        />
        <div className="max-h-96 overflow-y-auto border-t border-gray-100 dark:border-gray-800/60">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Member", "Weeks paid", "Outstanding", "Drawn", "Received (net)"].map((h) => (
                  <th
                    key={h}
                    className="sticky top-0 bg-gray-50/95 dark:bg-[#1a1a1a] px-5 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {review.members.map((m) => (
                <tr key={m.participationId}>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-5 py-1.5 font-semibold text-gray-900 dark:text-white">
                    {/* §8: a name is a link to the person it names. This table
                        is the last look before 25 ledger debts are written —
                        the moment the organizer most needs to check one. */}
                    <Link
                      href={`/admin/participations/${m.participationId}`}
                      className="hover:text-indigo-700 hover:underline dark:hover:text-indigo-300"
                    >
                      {m.name}
                    </Link>
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-5 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {m.weeksPaid} of {m.weeksCommitted}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-5 py-1.5">
                    {m.outstanding > 0 ? (
                      <Pill tone="problem">{formatMoney(m.outstanding)}</Pill>
                    ) : (
                      <Pill tone="good">settled</Pill>
                    )}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-5 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {m.drawnWeek !== null ? `week ${m.drawnWeek}` : "—"}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-5 py-1.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {m.receivedNet > 0 ? formatMoney(m.receivedNet) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ————— Closing statements (2.21) go out BEFORE the close ————— */}
      <Card>
        <CardHeader
          title="Closing statements"
          sub="Factual and calm, one per member (2.21). Sent manually through Messages — never automatically (2.20)."
          right={
            review.statementsSent >= review.memberCount ? (
              <Pill tone="good">{review.statementsSent} sent</Pill>
            ) : (
              <Pill tone="attention">
                {review.statementsSent} of {review.memberCount} sent
              </Pill>
            )
          }
        />
        <div className="px-5 pb-4 text-sm text-gray-700 dark:text-gray-300">
          Send them <strong>before</strong> closing — the messenger reads each member&apos;s live
          standing, which closing freezes.{" "}
          <Link href="/admin/messages" className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline">
            Open Messages and choose “Cycle closing statement” →
          </Link>
        </div>
      </Card>

      {/* ————— THE WAIT PERIOD (2.6 / 2.9) —————
          Stated as a sentence with a date, not a greyed-out button. The
          organizer is not being stopped by the product; they are being told
          that last week's money is still allowed to arrive. */}
      {tooSoon ? (
        <Card>
          <CardHeader
            title={`Closing opens in ${review.timing.daysRemaining} day${review.timing.daysRemaining === 1 ? "" : "s"}`}
            sub="Configurable in Settings — set it to 0 to close as soon as the last week passes."
          />
          <div className="px-5 pb-4 text-sm text-gray-800 dark:text-gray-200">
            <p>{review.timing.reason}</p>
            {review.timing.availableOn && (
              <p className="mt-2">
                Available from <strong className="tabular-nums">{review.timing.availableOn}</strong>.
                Everything below is already final except late money for the last week — send the
                closing statements now, and close then.
              </p>
            )}
          </div>
        </Card>
      ) : (
        <p className="text-xs text-gray-600 dark:text-gray-400">{review.timing.reason}</p>
      )}

      {/* ————— STEP 2: the close ————— */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !ackOk || tooSoon}
          title={
            tooSoon
              ? review.timing.reason
              : !ackOk
                ? "Write the acknowledgement reason first (2.27)"
                : undefined
          }
          onClick={() =>
            setConfirm({
              title: `Close ${review.cycleName}?`,
              body: (
                <>
                  <p>
                    In one transaction: {review.membersShort} carried debt
                    {review.membersShort === 1 ? "" : "s"} totalling{" "}
                    <strong className="tabular-nums">{formatMoney(review.totalOutstanding)}</strong>{" "}
                    {review.membersShort === 1 ? "is" : "are"} written to the members&apos; personal
                    ledgers (2.18), the readable archive is frozen (2.9), and the cycle becomes
                    CLOSED.
                  </p>
                  {needsAck && (
                    <p>
                      {review.undrawn.length} undrawn member{review.undrawn.length === 1 ? "" : "s"}{" "}
                      acknowledged: <em>&quot;{acknowledge.trim()}&quot;</em>
                    </p>
                  )}
                  {review.statementsSent < review.memberCount && (
                    <p className="text-amber-800 dark:text-amber-400">
                      Only {review.statementsSent} of {review.memberCount} closing statements have
                      been sent — after closing, the messenger can no longer read this
                      cycle&apos;s standings.
                    </p>
                  )}
                  <p>Weeks and receipts stay exactly as they are; recording money afterwards targets the carried ledger (2.19). An audit entry records everything.</p>
                </>
              ),
              confirmLabel: `Close ${review.cycleName}`,
              requirePhrase: review.cycleName,
            })
          }
          className={buttonCls.danger}
        >
          Close {review.cycleName}…
        </button>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          Typed confirmation required — this writes ledger debts.
        </span>
      </div>

      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={(typedPhrase) => void doClose(typedPhrase)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

// ————— STEP 5: the clean delete, per closed cycle —————

export function DeleteCycleCard({
  cycle,
}: {
  cycle: { id: string; name: string; closedAt: string; archived: boolean };
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function openDelete() {
    setBusy(true);
    setMsg(null);
    try {
      const review = await getDeleteReview(cycle.id);
      if (!review.ok) {
        setMsg({ kind: "err", text: review.error });
        return;
      }
      setConfirm({
        title: `Delete ${cycle.name} permanently?`,
        body: (
          <>
            <p className="font-semibold">Removed for good:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {review.data.plan.removed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="font-semibold">Kept, untouched:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {review.data.plan.kept.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ),
        confirmLabel: `Delete ${cycle.name}`,
        requirePhrase: cycle.name,
      });
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(typedPhrase: string) {
    setBusy(true);
    setMsg(null);
    try {
      // Same shape, same fix: the typed value, not our copy of it. This one
      // wipes every participation, week, receipt, draw and payout in the
      // cycle.
      const result = await deleteClosedCycle({ cycleId: cycle.id, typedName: typedPhrase });
      if (!result.ok) setMsg({ kind: "err", text: `Not deleted: ${result.error}` });
      else {
        setMsg({ kind: "ok", text: `✓ ${cycle.name} deleted — its archive and every ledger remain.` });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing was deleted." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
        <span className="font-bold text-gray-900 dark:text-white">{cycle.name}</span>
        <span className="tabular-nums text-gray-600 dark:text-gray-400">closed {cycle.closedAt}</span>
        {cycle.archived ? (
          <Link
            href={`/admin/cycles/${cycle.id}/archive`}
            className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
          >
            View archive →
          </Link>
        ) : (
          <Pill tone="problem">no archive — do not delete</Pill>
        )}
        <span className="ml-auto">
          <button
            type="button"
            disabled={busy || !cycle.archived}
            title={!cycle.archived ? "Archive first — closing writes one (2.9)" : undefined}
            onClick={() => void openDelete()}
            className={buttonCls.danger + " !px-3 !py-1.5 !text-xs"}
          >
            Delete cycle…
          </button>
        </span>
      </div>
      {msg && (
        <div className="px-5 pb-3">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={(typedPhrase) => void doDelete(typedPhrase)}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
