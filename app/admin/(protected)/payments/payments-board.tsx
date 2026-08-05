"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { recordPayment } from "@/app/actions/payments";
import { deletePaymentEvent } from "@/app/actions/edits";
import { AllocationEntry } from "@/components/allocation-entry";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/controls";
import { describeAllocation, type RosterMember } from "@/lib/payments-view";
import { formatDateUTC, formatMoney } from "@/lib/format";

type Receipt = {
  eventId: string;
  appliedHere: number;
  eventAmount: number;
  method: string | null;
};

type Board = {
  presentation?: boolean;
  cycleName: string;
  weekNumber: number;
  weekDate: Date;
  isSkipped: boolean;
  currentCycleWeek: number;
  allWeeks: { weekNumber: number; date: Date }[];
  expected: number;
  receivedTotal: number;
  membersPaid: number;
  membersExpected: number;
  windowDaysLeft: number;
  owing: RosterMember[];
  paid: RosterMember[];
  receiptsByParticipation: Record<string, Receipt[]>;
};

// NOTE: the page renders <PaymentsBoard key={weekNumber}> so switching weeks
// remounts the board and recaptures the frozen row order below.
export function PaymentsBoard({ board }: { board: Board }) {
  const router = useRouter();
  const [banner, setBanner] = useState<{ kind: "ok" | "err", text: string } | null>(null);

  // Rows NEVER re-sort or vanish under the organizer's finger: the order is
  // frozen when the board opens, and a member who settles stays in place as
  // a visibly settled stub until the organizer moves on.
  const [visitOrder] = useState(() => board.owing.map((m) => m.participationId));
  const [settled, setSettled] = useState<Record<string, string>>({});

  // Presentation mode (2.4): the server sent numbers instead of names and no
  // amounts or receipts — the board is a read-only who-has-paid list, and
  // recording is refused server-side anyway. (All hooks run above this
  // return so the hook order is stable if the mode flips mid-session.)
  if (board.presentation === true) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold">
            Week {board.weekNumber} — {formatDateUTC(board.weekDate)}
            {board.weekNumber === board.currentCycleWeek && " (this week)"}
          </h1>
          <p className="mt-1 text-sm text-gray-700">
            {board.membersPaid} of {board.membersExpected} paid ·{" "}
            {board.isSkipped
              ? "week skipped — nothing is owed"
              : board.windowDaysLeft > 0
                ? `window closes in ${board.windowDaysLeft} day${board.windowDaysLeft === 1 ? "" : "s"}`
                : "payment window closed"}{" "}
            · amounts hidden in presentation mode
          </p>
          <label className="mt-3 block max-w-xs text-sm">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Week</span>
            <Select
              value={String(board.weekNumber)}
              onChange={(value) => router.push(`/admin/payments?view=week&week=${value}`)}
              ariaLabel="Choose the week"
              options={board.allWeeks.map((w) => ({
                value: String(w.weekNumber),
                label: `Week ${w.weekNumber} — ${formatDateUTC(w.date)}`,
              }))}
            />
          </label>
        </header>

        <section>
          <h2 className="mb-2 text-base font-semibold">Still owed ({board.owing.length})</h2>
          {board.owing.length === 0 ? (
            <p className="text-sm text-gray-600">Nobody — this week is settled.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {board.owing.map((m) => (
                <li key={m.participationId} className="border-b border-gray-200 py-1">
                  {m.name}
                  {m.weeksBehind > 0 && (
                    <span className="ml-2 text-red-800">
                      {m.weeksBehind} week{m.weeksBehind === 1 ? "" : "s"} behind
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-gray-700">Paid ({board.paid.length})</h2>
          {board.paid.length === 0 ? (
            <p className="text-sm text-gray-600">Nobody yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {board.paid.map((m) => (
                <li key={m.participationId} className="border-b border-gray-200 py-1">
                  {m.name}
                  <span className="ml-2 text-gray-600">
                    {m.isDeferred ? "deferred (excused)" : "paid"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  function markRecorded(participationId: string, message: string) {
    setBanner({ kind: "ok", text: message });
    setSettled((prev) => ({ ...prev, [participationId]: message }));
  }

  const byId = new Map(board.owing.map((m) => [m.participationId, m]));
  const orderedIds = [
    ...visitOrder,
    ...board.owing.map((m) => m.participationId).filter((id) => !visitOrder.includes(id)),
  ];
  const openRows = orderedIds.filter((id) => byId.has(id) || settled[id]);
  const remaining = orderedIds.filter((id) => byId.has(id)).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">
          Week {board.weekNumber} — {formatDateUTC(board.weekDate)}
          {board.weekNumber === board.currentCycleWeek && " (this week)"}
        </h1>
        <p className="mt-1 text-sm text-gray-700">
          Expected {formatMoney(board.expected)} · received{" "}
          <strong>{formatMoney(board.receivedTotal)}</strong> · {board.membersPaid} of{" "}
          {board.membersExpected} paid ·{" "}
          {board.isSkipped
            ? "week skipped — nothing is owed"
            : board.windowDaysLeft > 0
              ? `window closes in ${board.windowDaysLeft} day${board.windowDaysLeft === 1 ? "" : "s"}`
              : "payment window closed"}
        </p>
        <label className="mt-3 block max-w-xs text-sm">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">Week</span>
          <Select
            value={String(board.weekNumber)}
            onChange={(value) => router.push(`/admin/payments?view=week&week=${value}`)}
            ariaLabel="Choose the week"
            options={board.allWeeks.map((w) => ({
              value: String(w.weekNumber),
              label: `Week ${w.weekNumber} — ${formatDateUTC(w.date)}`,
            }))}
          />
        </label>
      </header>

      {banner && (
        <p
          role={banner.kind === "err" ? "alert" : "status"}
          className={`rounded border px-3 py-2 text-sm ${banner.kind === "err" ? "border-red-400 bg-red-50 text-red-800" : "border-green-500 bg-green-50 text-green-900"}`}
        >
          {banner.text}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold">Still owed ({remaining})</h2>
        {remaining === 0 ? (
          <p className="rounded border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-900">
            ✓ Everyone in this week is settled.
          </p>
        ) : null}
        <ul className="space-y-2">
          {openRows.map((id) => {
            const member = byId.get(id);
            return member ? (
              <PaymentRow
                key={id}
                member={member}
                weekNumber={board.weekNumber}
                onError={(text) => setBanner({ kind: "err", text })}
                onRecorded={(message) => markRecorded(id, message)}
              />
            ) : (
              <li
                key={id}
                className="rounded border border-green-500 bg-green-50 px-3 py-2 text-sm text-green-900"
              >
                {settled[id]}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-700">Paid ({board.paid.length})</h2>
        {board.paid.length === 0 ? (
          <p className="text-sm text-gray-600">Nobody yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {board.paid.map((m) => (
              <li
                key={m.participationId}
                className="flex flex-wrap items-center gap-2 border-b border-gray-200 py-1"
              >
                <Link href={`/admin/participations/${m.participationId}`} className="underline">
                  {m.name}
                </Link>
                <span className="text-gray-600">
                  {m.isDeferred ? "deferred (excused)" : formatMoney(m.amountPaidThisWeek)}
                </span>
                {(board.receiptsByParticipation[m.participationId] ?? []).map((r) => (
                  <UndoButton
                    key={r.eventId}
                    receipt={r}
                    memberName={m.name}
                    weekNumber={board.weekNumber}
                    onResult={setBanner}
                  />
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PaymentRow({
  member,
  weekNumber,
  onError,
  onRecorded,
}: {
  member: RosterMember;
  weekNumber: number;
  onError: (text: string) => void;
  onRecorded: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [showEntry, setShowEntry] = useState(false);
  const [rowNote, setRowNote] = useState<string | null>(null);

  // The idempotency key is armed from the member's CURRENT data and re-armed
  // ONLY when refreshed data actually arrives. After a save it is disarmed
  // (""), so no second receipt is possible until the board catches up — the
  // window between "saved" and "refreshed" is completely closed.
  const fingerprint = `${member.amountPaidThisWeek}|${member.amountOwed}|${member.weeksBehind}`;
  const [idempotencyKey, setIdempotencyKey] = useState("");
  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, [fingerprint]);

  const locked = busy || refreshing || !idempotencyKey;
  const remainingThisWeek = member.amountDue - member.amountPaidThisWeek;

  async function oneTap(method: "ZELLE" | "CASH") {
    if (locked) return;
    setBusy(true);
    try {
      const key = idempotencyKey;
      setIdempotencyKey(""); // disarm BEFORE the request — no same-key or fresh-key retap
      const result = await recordPayment({
        participationId: member.participationId,
        amount: remainingThisWeek,
        method,
        idempotencyKey: key,
      });
      if (!result.ok) {
        onError(`Not recorded for ${member.name}: ${result.error}`);
        setIdempotencyKey(crypto.randomUUID()); // failed: re-arm so they can retry
        return;
      }
      // Oldest debt first (2.15) — always say where the money actually went.
      const where = describeAllocation({ allocations: result.data.allocations, unallocated: 0 });
      const message = `✓ ${formatMoney(result.data.totalApplied)} ${method} from ${member.name} — ${where}.`;
      setRowNote(message);
      if (result.data.allocations.some((a) => a.weekNumber === weekNumber && a.fillsWeek)) {
        onRecorded(message); // this week settled: row becomes a stub in place
      }
      // Otherwise the money landed on earlier debt and this week is still
      // owed — keep the row with the note inline; the fingerprint effect
      // re-arms the key only when the refreshed figures arrive.
      startTransition(() => router.refresh());
    } catch {
      onError(`Could not reach the server — ${member.name}'s payment was NOT confirmed.`);
      setIdempotencyKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded border border-gray-300 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/participations/${member.participationId}`} className="font-medium underline">
          {member.name}
        </Link>
        <span>
          due <strong>{formatMoney(remainingThisWeek)}</strong>
        </span>
        {member.weeksBehind > 0 && (
          <span className="text-red-800">
            {member.weeksBehind} week{member.weeksBehind === 1 ? "" : "s"} behind ·{" "}
            {formatMoney(member.amountOwed)} owed
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => oneTap("ZELLE")}
            disabled={locked}
            className="rounded bg-black px-3 py-1.5 font-medium text-white disabled:opacity-40"
          >
            {busy || refreshing ? "…" : `Zelle ${formatMoney(remainingThisWeek)}`}
          </button>
          <button
            type="button"
            onClick={() => oneTap("CASH")}
            disabled={locked}
            className="rounded bg-black px-3 py-1.5 font-medium text-white disabled:opacity-40"
          >
            {busy || refreshing ? "…" : `Cash ${formatMoney(remainingThisWeek)}`}
          </button>
          <button
            type="button"
            onClick={() => setShowEntry((s) => !s)}
            className="rounded border border-gray-400 px-3 py-1.5"
          >
            {showEntry ? "Close" : "Different amount"}
          </button>
        </span>
      </div>

      {rowNote && (
        <p role="status" className="mt-1 rounded bg-green-50 px-2 py-1 text-green-900">
          {rowNote}
        </p>
      )}

      {member.weeksBehind > 0 && (
        <p className="mt-1 text-xs text-gray-600">
          Oldest debt is paid first, so this may clear an earlier week than week {weekNumber}.
        </p>
      )}

      {showEntry && (
        <div className="mt-2">
          <AllocationEntry
            participationId={member.participationId}
            memberName={member.name}
            defaultAmountCents={remainingThisWeek}
            onSaved={(message) => {
              // The entry unmounts here — carry its confirmation on the
              // banner and the row so it is never lost (2.10).
              setShowEntry(false);
              setRowNote(message);
              onRecorded(message);
              startTransition(() => router.refresh());
            }}
          />
        </div>
      )}
    </li>
  );
}

function UndoButton({
  receipt,
  memberName,
  weekNumber,
  onResult,
}: {
  receipt: Receipt;
  memberName: string;
  weekNumber: number;
  onResult: (b: { kind: "ok" | "err"; text: string }) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const spansOtherWeeks = receipt.appliedHere < receipt.eventAmount;

  async function doUndo() {
    setBusy(true);
    try {
      const result = await deletePaymentEvent({ eventId: receipt.eventId });
      if (!result.ok) {
        onResult({ kind: "err", text: `Not undone: ${result.error}` });
        return;
      }
      onResult({
        kind: "ok",
        text: `✓ Undone — ${formatMoney(receipt.eventAmount)} receipt from ${memberName} deleted and weeks recalculated.`,
      });
      startTransition(() => router.refresh());
    } catch {
      onResult({ kind: "err", text: "Could not reach the server — nothing was undone." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setConfirm({
            title: `Undo this ${formatMoney(receipt.eventAmount)} receipt from ${memberName}?`,
            body: (
              <>
                {spansOtherWeeks ? (
                  <p>
                    Only {formatMoney(receipt.appliedHere)} of it sits on week {weekNumber} — the
                    rest covers other weeks. The WHOLE receipt is deleted and every week
                    recalculates.
                  </p>
                ) : (
                  <p>The receipt is deleted and week {weekNumber} recalculates.</p>
                )}
                <p>
                  The member&apos;s standing and the cash position recalculate immediately. An
                  audit entry records what was removed.
                </p>
              </>
            ),
            confirmLabel: "Undo receipt",
          })
        }
        disabled={busy || refreshing}
        className="rounded border border-gray-400 px-2 py-0.5 text-xs disabled:opacity-40"
        title={`${formatMoney(receipt.appliedHere)} of a ${formatMoney(receipt.eventAmount)} receipt`}
      >
        {busy || refreshing ? "Undoing…" : "Undo"}
      </button>
      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => void doUndo()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
