"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteCashReading, recordCashReading } from "@/app/actions/cycle-position";
import { ConfirmDialog, type ConfirmSpec } from "@/components/ui/confirm-dialog";
import { AmountInput } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { moneyReceivedBounds } from "@/lib/date-bounds";
import { Alert, buttonCls, Card, CardHeader, inputCls } from "@/components/ui/primitives";
import { formatDateUTC, formatMoney, parseDollarsToCents } from "@/lib/format";
import type { PositionVerdict } from "@/lib/cycle-position";
import { Pager } from "@/components/ui/pager";
import type { PageInfo } from "@/lib/paging";

// WHAT HE ACTUALLY HOLDS — the only stored fact on this page.
//
// Everything else is derived. This is a reading at a moment in time, dated,
// kept forever, so he can look back at what he held in week 8 versus week 12.
//
// THE ANSWER IS NEVER JUST A NUMBER. The verdict says whether he is covered,
// in surplus or short, by how much, and — when short — what he would need to
// make it right.

type Reading = {
  id: string;
  readAt: string;
  totalAmount: number;
  bankAmount: number | null;
  cashAmount: number | null;
  note: string | null;
  differenceVsExpectedToday: number;
};

export function CashReadingPanel({
  expected,
  verdict,
  latest,
  readings,
  readingInfo,
}: {
  expected: number;
  verdict: PositionVerdict | null;
  latest: { totalAmount: number; readAt: string } | null;
  readings: Reading[];
  readingInfo: PageInfo;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [split, setSplit] = useState(false);
  const [total, setTotal] = useState("");
  const [bank, setBank] = useState("");
  const [cash, setCash] = useState("");
  const [readAt, setReadAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [onConfirm, setOnConfirm] = useState<(() => void) | null>(null);

  // When the two lines are given, the total follows from them — he should
  // never have to add them up himself, and a mismatch is impossible.
  const bankCents = parseDollarsToCents(bank);
  const cashCents = parseDollarsToCents(cash);
  const derivedTotal =
    split && bankCents !== null && cashCents !== null ? bankCents + cashCents : null;
  const totalCents = split ? derivedTotal : parseDollarsToCents(total);

  async function save() {
    if (totalCents === null) {
      setMsg({ kind: "err", text: "Enter what you are holding." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const result = await recordCashReading({
        totalAmount: totalCents,
        bankAmount: split ? bankCents : null,
        cashAmount: split ? cashCents : null,
        readAt: `${readAt}T00:00:00.000Z`,
        note: note || undefined,
      });
      if (!result.ok) setMsg({ kind: "err", text: result.error });
      else {
        setMsg({ kind: "ok", text: `✓ Recorded ${formatMoney(totalCents)} held on ${readAt}.` });
        setOpen(false);
        setTotal("");
        setBank("");
        setCash("");
        setNote("");
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — nothing was saved." });
    } finally {
      setBusy(false);
    }
  }

  const tone =
    verdict === null
      ? "neutral"
      : verdict.kind === "short"
        ? "bad"
        : verdict.kind === "covered"
          ? "warn"
          : "good";

  return (
    <Card>
      <CardHeader
        title="What you actually hold"
        sub="Across bank and cash on hand. The only figure on this page you enter yourself — everything else is worked out from money already recorded."
      />
      <div className="space-y-4 px-5 pb-4">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {/* THE ANSWER. */}
        {verdict === null ? (
          <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
            You have not recorded what you are holding yet. Enter it below and this will say
            whether you are covered, in surplus, or short — and by how much.
          </p>
        ) : (
          <div
            data-testid="position-verdict"
            className={
              "rounded-xl border-2 px-4 py-3 " +
              (tone === "bad"
                ? "border-red-400 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
                : tone === "warn"
                  ? "border-amber-400 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
                  : "border-emerald-400 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30")
            }
          >
            <p className="text-base font-bold leading-snug text-gray-900 dark:text-white">
              {verdict.sentence}
            </p>
            <p className="mt-2 text-xs tabular-nums text-gray-700 dark:text-gray-300">
              Expected {formatMoney(expected)} · you hold{" "}
              {formatMoney(latest?.totalAmount ?? 0)}
              {latest && <> · read {formatDateUTC(new Date(latest.readAt))}</>}
            </p>
          </div>
        )}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={buttonCls.secondary}>
            Record what you are holding…
          </button>
        ) : (
          <div className="space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={split}
                onChange={(e) => setSplit(e.target.checked)}
              />
              <span>Enter bank and cash on hand separately</span>
            </label>

            <div className="flex flex-wrap items-end gap-3">
              {split ? (
                <>
                  <Field label="Bank">
                    <AmountInput value={bank} onChange={setBank} ariaLabel="Bank balance in dollars" className="w-32" />
                  </Field>
                  <Field label="Cash on hand">
                    <AmountInput value={cash} onChange={setCash} ariaLabel="Cash on hand in dollars" className="w-32" />
                  </Field>
                  <p className="pb-2 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                    ={" "}
                    {derivedTotal === null ? "—" : formatMoney(derivedTotal)}
                  </p>
                </>
              ) : (
                <Field label="Total held">
                  <AmountInput value={total} onChange={setTotal} ariaLabel="Total held in dollars" className="w-36" />
                </Field>
              )}
              <Field label="Read on">
                <DatePicker
                  value={readAt}
                  onChange={setReadAt}
                  ariaLabel="Date of the reading"
                  bounds={moneyReceivedBounds()}
                />
              </Field>
              <Field label="Note (optional)">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. after Tuesday's deposits"
                  className={inputCls + " w-56"}
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || totalCents === null}
                onClick={() => void save()}
                className={buttonCls.primary}
              >
                Save this reading
              </button>
              <button type="button" onClick={() => setOpen(false)} className={buttonCls.ghost}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ————— HISTORY: drift across the cycle, not only today ————— */}
        {readingInfo.total > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Past readings
            </h3>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
              {readings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="tabular-nums text-gray-600 dark:text-gray-400">
                    {formatDateUTC(new Date(r.readAt))}
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                    {formatMoney(r.totalAmount)}
                  </span>
                  {r.bankAmount !== null && r.cashAmount !== null && (
                    <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      ({formatMoney(r.bankAmount)} bank + {formatMoney(r.cashAmount)} on hand)
                    </span>
                  )}
                  {r.note && (
                    <span className="text-xs italic text-gray-500 dark:text-gray-400">{r.note}</span>
                  )}
                  <span
                    className={
                      "ml-auto text-xs tabular-nums " +
                      (r.differenceVsExpectedToday < 0
                        ? "text-red-700 dark:text-red-400"
                        : "text-emerald-700 dark:text-emerald-400")
                    }
                  >
                    {r.differenceVsExpectedToday >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(r.differenceVsExpectedToday))} vs expected now
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirm({
                        title: `Delete the reading of ${formatMoney(r.totalAmount)}?`,
                        body: (
                          <p>
                            The reading taken on {formatDateUTC(new Date(r.readAt))} is removed from
                            the history. Nothing else changes — every other figure on this page is
                            derived. An audit entry records the deletion.
                          </p>
                        ),
                        confirmLabel: "Delete reading",
                      });
                      setOnConfirm(() => () => {
                        void (async () => {
                          setBusy(true);
                          const res = await deleteCashReading({ id: r.id });
                          if (!res.ok) setMsg({ kind: "err", text: res.error });
                          else router.refresh();
                          setBusy(false);
                          setConfirm(null);
                          setOnConfirm(null);
                        })();
                      });
                    }}
                    className={buttonCls.dangerQuiet + " !px-2 !py-0.5 !text-[11px]"}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <Pager
              className="mt-2"
              info={readingInfo}
              noun={{ one: "reading", many: "readings" }}
              label="Cash reading pages"
              hrefFor={(p) => `?readingsPage=${p}`}
            />
            <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              The comparison is against what is expected <strong>today</strong> — it shows drift,
              not what the books said on each of those days.
            </p>
          </div>
        )}
      </div>

      <ConfirmDialog
        spec={confirm}
        busy={busy}
        onConfirm={() => onConfirm?.()}
        onCancel={() => {
          setConfirm(null);
          setOnConfirm(null);
        }}
      />
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}
