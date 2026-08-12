import Link from "next/link";
import { getCyclePosition } from "@/app/actions/cycle-position";
import { CashReadingPanel } from "./cash-reading-panel";
import { PresentationHidden } from "@/components/presentation-hidden";
import { Card, CardHeader, Pill } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateUTC, formatMoney } from "@/lib/format";
import { SectionHeading, SectionNav } from "@/components/ui/section-nav";
import { parsePage } from "@/lib/paging";
import { parsePositionSection, positionSections } from "./sections";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";

export const dynamic = "force-dynamic";

// THE CYCLE POSITION — the number the organizer has calculated by hand for
// six years. Replaces the old /admin/cycle/weeks, whose only purpose was
// skipping weeks: there are no skipped weeks in an Equb, every week is a
// commitment.
//
// "Am I in negative, am I using someone else's money, or am I on track."
//
// Every figure is derived (2.14) and drills down to who makes it up. The one
// stored fact on the page is the cash reading he enters himself.

export default async function CyclePositionPage({
  searchParams,
}: {
  searchParams: Promise<{
    readingsPage?: string | string[];
    section?: string | string[];
  }>;
}) {
  const { readingsPage, section: rawSection } = await searchParams;
  const section = parsePositionSection(rawSection);
  const result = await getCyclePosition({ readingsPage: parsePage(readingsPage) });
  if (!result.ok) {
    if (result.error === PRESENTATION_HIDDEN) {
      return <PresentationHidden what="The cycle position" />;
    }
    return (
      <main>
        <p className="text-sm text-red-800 dark:text-red-400">{result.error}</p>
      </main>
    );
  }
  const d = result.data;
  const c = d.collection;
  const h = d.holding;
  const sections = positionSections({
    owedByCount: c.owedBy.length,
    shortfall: c.shortfall,
    aheadByCount: c.aheadBy.length,
    paidAhead: c.paidAhead,
    // Money he has to find himself is worth a dot on Collection even when
    // nobody is behind — it is the one figure on this page that appears in no
    // total, because those weeks stopped being expected.
    toCover: c.toCover,
    holdingLessThanOwed: h.shouldBeHolding < h.paidEarly + h.drawnNotHandedOut,
    verdictKind: d.verdict?.kind ?? null,
  });
  const href = (key: string) => `?section=${key}`;

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin/cycle" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Cycle
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Where this cycle stands
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {d.cycleName} · week {d.currentWeek} of {d.plannedWeeks}
        </p>
      </header>

      {/* THE SENTENCE FIRST — the same register as the dashboard's cash line. */}
      <p className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-5 py-4 text-base font-bold leading-snug text-indigo-950 dark:text-indigo-100 animate-fade-in-up-1">
        {d.collectionSentence}
      </p>

      <SectionNav
        sections={sections}
        active={section}
        hrefFor={href}
        label="Cycle position sections"
        className="animate-fade-in-up-1"
      />

      {/* ————— Collection: should vs actual ————— */}
      {section === "collection" && (
        <>
          <SectionHeading title="What should have come in, and what did">
            Every elapsed week&apos;s expectation against what actually arrived. Elapsed means
            the week&apos;s own payment window has closed — not a week number counted off the
            start date.
          </SectionHeading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 animate-fade-in-up-1">
        <StatCard
          label="Should have come in"
          cents={c.shouldHaveCollected}
          sub={`every week through week ${c.elapsedThroughWeek}`}
        />
        <StatCard
          label="Actually collected"
          cents={c.collected}
          sub="for those same weeks"
          emphasis
        />
        <StatCard
          label="Outstanding"
          cents={c.shortfall}
          sub={
            c.shortfall === 0
              ? "nothing is owed for elapsed weeks"
              : `${c.owedBy.length} member${c.owedBy.length === 1 ? "" : "s"} owe it`
          }
          emphasis={c.shortfall > 0}
        />
      </div>

        </>
      )}

      {/* ————— PAID AHEAD — the piece he could not see ————— */}
      {section === "ahead" && (
        <>
          <SectionHeading title="Money paid toward weeks after this one">
            It is in your hands and it is not yours to spend. Kept separate from collection
            for exactly that reason.
          </SectionHeading>
      <Card className="animate-fade-in-up-2">
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Paid ahead
              <Pill tone={c.paidAhead > 0 ? "attention" : "neutral"}>for weeks not yet reached</Pill>
            </span>
          }
          sub="Money received for weeks AFTER this one. It is in your hands, but it belongs to those weeks — spending it is spending someone else's money. This week's own money is not here; a week whose payment window is still open has still happened."
        />
        <div className="px-5 pb-4">
          <p className="text-2xl font-black tabular-nums text-gray-900 dark:text-white">
            {formatMoney(c.paidAhead)}
          </p>
          {/* THE WEEK THAT IS HAPPENING NOW, stated before the ahead list.
              Its money used to be swept in here: a week's payment window stays
              open for five days after it arrives, and the split was made on
              "has the window closed" rather than "has the week happened". On
              the live cycle mid-week 13 that put $9,375 of ordinary on-time
              money — and 13 members — on this list. */}
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
            Week {c.currentWeek} is still open:{" "}
            <strong className="tabular-nums">{formatMoney(c.collectedThisWeek)}</strong> of{" "}
            <strong className="tabular-nums">{formatMoney(c.expectedThisWeek)}</strong> is in. That
            is this week&apos;s ordinary money — not paid ahead, and nobody is short for it until
            the week closes.
          </p>
          {c.aheadBy.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Nobody has paid ahead. Everything received belongs to this week or an earlier one.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
              {c.aheadBy.map((m) => (
                <li key={m.participationId} className="flex items-center gap-3 py-2 text-sm">
                  <Link
                    href={`/admin/participations/${m.participationId}`}
                    className="font-semibold text-gray-900 dark:text-white hover:underline"
                  >
                    {m.name}
                  </Link>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {m.weeks} week{m.weeks === 1 ? "" : "s"} ahead
                  </span>
                  <span className="ml-auto tabular-nums text-gray-800 dark:text-gray-200">
                    {formatMoney(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

        </>
      )}

      {/* Who makes up the shortfall belongs with Collection, not on its own:
          the figure and the people behind it are one question. */}
      {section === "collection" && c.owedBy.length > 0 && (
        <Card className="animate-fade-in-up-2">
          <CardHeader
            title="Who the outstanding money is with"
            sub="Elapsed weeks only — money whose payment window has closed unpaid. Not what is still to save."
          />
          <ul className="divide-y divide-gray-100 dark:divide-gray-800/60 border-t border-gray-100 dark:border-gray-800/60">
            {c.owedBy.map((m) => (
              <li key={m.participationId} className="flex items-center gap-3 px-5 py-2 text-sm">
                <Link
                  href={`/admin/participations/${m.participationId}`}
                  className="font-semibold text-gray-900 dark:text-white hover:underline"
                >
                  {m.name}
                </Link>
                <span className="ml-auto tabular-nums text-gray-800 dark:text-gray-200">
                  {formatMoney(m.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ————— MEMBERS WHO HAVE STOPPED — never in the list above ————— */}
      {section === "collection" && c.stoppedBy.length > 0 && (
        <Card className="animate-fade-in-up-2">
          <CardHeader
            title="Members who have stopped"
            sub="Separate from the list above on purpose. Someone behind is going to pay; someone who has stopped is not, and counting them together is what made this figure wrong."
          />
          <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800/60 dark:border-gray-800/60">
            {c.stoppedBy.map((m) => (
              <li key={m.participationId} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/admin/participations/${m.participationId}`}
                    className="font-semibold text-gray-900 hover:underline dark:text-white"
                  >
                    {m.name}
                  </Link>
                  <Pill tone="neutral">stopped at week {m.closedAtWeek}</Pill>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{m.reason}</span>
                </div>
                {/* THE SENTENCE, not a row of figures. It is the one thing on
                    this page the organizer cannot work out for himself. */}
                <p className="mt-1 text-gray-700 dark:text-gray-300">
                  {m.alreadyPaidOut > 0 ? (
                    <>
                      {m.name} was paid{" "}
                      <strong className="tabular-nums">{formatMoney(m.alreadyPaidOut)}</strong> and
                      stopped at week {m.closedAtWeek}.{" "}
                      {m.shortfallToCover > 0 && (
                        <>
                          <strong className="tabular-nums">
                            {formatMoney(m.shortfallToCover)}
                          </strong>{" "}
                          of their contributions will not arrive — you would need to cover that.
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {m.name} stopped at week {m.closedAtWeek}.{" "}
                      {m.amountLeaving > 0 && (
                        <>
                          <strong className="tabular-nums">{formatMoney(m.amountLeaving)}</strong>{" "}
                          of their contributions will not arrive. They were never paid out, so
                          there is nothing for you to cover.
                        </>
                      )}
                    </>
                  )}
                  {m.balanceRecorded > 0 && (
                    <>
                      {" "}
                      <strong className="tabular-nums">
                        {formatMoney(m.balanceRecorded)}
                      </strong>{" "}
                      they had not paid is on their own record.
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
          {c.toCover > 0 && (
            <p className="border-t border-gray-100 px-5 py-3 text-sm font-bold text-amber-900 dark:border-gray-800/60 dark:text-amber-200">
              <span className="tabular-nums">{formatMoney(c.toCover)}</span> in total is yours to
              cover. It is not in any figure above — those weeks stopped being expected, which is
              exactly why it has to be said here.
            </p>
          )}
        </Card>
      )}

      {/* ————— What he SHOULD be holding, decomposed ————— */}
      {section === "holding" && (
        <>
          <SectionHeading title="What the books say you are holding">
            Money in, money out, what is left. Every figure has already happened — your fee is
            an estimate and is kept out of it.
          </SectionHeading>
      {/* THREE FACTS. Money in, money out, what is left.
          The fee is NOT here — it is a projection of what he might keep, and a
          projection inside a cash position makes the whole figure less
          believable. It has its own card below, labelled an estimate.
          A payout DRAWN BUT NOT HANDED OVER is not subtracted either: the cash
          is still in his hand. It is stated beneath instead. */}
      <Card className="animate-fade-in-up-2">
        <CardHeader
          title="What you should be holding"
          sub="Money in, money out, what is left. Every figure here has already happened."
        />
        <div className="px-5 pb-4">
          <dl className="space-y-2">
            <PlainRow label="Money collected" cents={h.collected} />
            <PlainRow
              label="Money handed out"
              cents={h.handedOut}
              note="payouts you have actually handed over"
            />
            <PlainRow label="You should be holding" cents={h.shouldBeHolding} big />
          </dl>

          {/* Statements ABOUT the figure, never arithmetic inside it. */}
          {(h.paidEarly > 0 || h.drawnNotHandedOut > 0) && (
            <ul className="mt-4 space-y-1.5 border-t border-gray-100 pt-3 text-sm text-gray-700 dark:border-gray-800/60 dark:text-gray-300">
              {h.paidEarly > 0 && (
                <li>
                  <strong className="tabular-nums">{formatMoney(h.paidEarly)}</strong> of this was
                  paid early for weeks that have not happened yet.
                </li>
              )}
              {h.drawnNotHandedOut > 0 && (
                <li>
                  <strong className="tabular-nums">{formatMoney(h.drawnNotHandedOut)}</strong> is
                  drawn but not handed out yet.
                </li>
              )}
            </ul>
          )}
        </div>
      </Card>

      {/* THE FEE — separate, and labelled an estimate. */}
      <Card className="animate-fade-in-up-2">
        <CardHeader
          title="Your fee, estimated"
          sub="What you keep if the cycle finishes as planned. An estimate — it is not part of what you are holding above, and it is not money you can count on until the payouts are done."
        />
        <div className="px-5 pb-4">
          <p className="text-2xl font-black tabular-nums text-gray-900 dark:text-white">
            {formatMoney(d.fee.total)}
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {formatMoney(d.fee.soFar)} from payouts already handed out
            {d.fee.ifRemainingPayoutsComplete > 0 && (
              <>
                , and {formatMoney(d.fee.ifRemainingPayoutsComplete)} more if the payouts already
                drawn are all handed over
              </>
            )}
            .
          </p>
        </div>
      </Card>

        </>
      )}

      {/* ————— What he ACTUALLY holds, and the verdict ————— */}
      {section === "cash" && (
        <>
          <SectionHeading title="What you actually hold, and what it means">
            The one figure you enter yourself. Everything it is compared against is worked
            out from money already recorded.
          </SectionHeading>
      <div className="animate-fade-in-up-2">
        <CashReadingPanel
          expected={h.shouldBeHolding}
          verdict={d.verdict}
          latest={
            d.latestReading
              ? {
                  totalAmount: d.latestReading.totalAmount,
                  readAt: d.latestReading.readAt.toISOString(),
                }
              : null
          }
          readingInfo={d.readingInfo}
          readings={d.readings.map((r) => ({
            id: r.id,
            readAt: r.readAt.toISOString(),
            totalAmount: r.totalAmount,
            bankAmount: r.bankAmount,
            cashAmount: r.cashAmount,
            note: r.note,
            differenceVsExpectedToday: r.differenceVsExpectedToday,
          }))}
        />
      </div>

        </>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Every figure above except your entered reading is derived from the money already
        recorded — nothing here is stored, so it can never drift from the dashboard
        {c.elapsedThroughWeek > 0 && ` or from week ${c.elapsedThroughWeek}'s own records`}.
      </p>
    </main>
  );
}

/**
 * One line of the cash position.
 *
 * No colour coding by "tone". These are facts, and tinting a fact red or green
 * tells the reader how to feel about it before they have read it — which is
 * exactly the editorialising the plain-English pass removed from the words.
 */
function PlainRow({
  label,
  cents,
  note,
  big = false,
}: {
  label: string;
  cents: number;
  note?: string;
  big?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-wrap items-baseline gap-x-3 " +
        (big ? "border-t border-gray-200 pt-2 dark:border-gray-700" : "")
      }
    >
      <dt
        className={
          big
            ? "text-base font-black text-gray-900 dark:text-white"
            : "text-sm font-semibold text-gray-800 dark:text-gray-200"
        }
      >
        {label}
      </dt>
      <dd
        className={
          "ml-auto tabular-nums text-gray-900 dark:text-white " +
          (big ? "text-2xl font-black" : "text-sm font-bold")
        }
      >
        {formatMoney(cents)}
      </dd>
      {note && (
        <span className="basis-full text-xs text-gray-500 dark:text-gray-400">{note}</span>
      )}
    </div>
  );
}
