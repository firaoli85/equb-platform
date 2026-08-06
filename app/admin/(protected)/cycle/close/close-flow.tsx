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

  async function doClose() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await closeCycle({
        cycleId: review.cycleId,
        typedName: review.cycleName,
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
                  <span className="tabular-nums text-gray-600 dark:text-gray-400">
                    ({m.numbers.map((n) => `#${n}`).join(", ")})
                  </span>
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
                    {m.name}
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

      {/* ————— STEP 2: the close ————— */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !ackOk}
          title={!ackOk ? "Write the acknowledgement reason first (2.27)" : undefined}
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
        onConfirm={() => void doClose()}
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

  async function doDelete() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await deleteClosedCycle({ cycleId: cycle.id, typedName: cycle.name });
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
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}
