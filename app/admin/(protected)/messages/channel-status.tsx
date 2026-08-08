import Link from "next/link";

// ONE STATUS PANEL, NOT FOUR STACKED ALERTS.
//
// This screen opened with up to four alert boxes in a row — the statements
// block, the channel switch, a missing-config warning, and the Meta 24-hour
// rule — before the organizer reached anything he could press. Every one of
// them was true and worth saying. Stacked, they read as an error state, and a
// screen that looks broken every time you open it stops being read at all.
//
// They are one panel now, because they are one fact: CAN A STATEMENT GO OUT
// RIGHT NOW, AND IF NOT, WHY. The answer leads; the reasoning is underneath it
// in a disclosure the organizer opens when he wants it, and which stays open
// on its own page state rather than resetting.

export function ChannelStatus({
  blockedReason,
  whatsappEnabled,
  disabledReason,
  missingConfig,
}: {
  /** Why statements cannot leave, from the engine. Empty when they can. */
  blockedReason: string;
  whatsappEnabled: boolean;
  disabledReason: string;
  missingConfig: readonly string[];
}) {
  const blocked = blockedReason.length > 0;

  return (
    <section
      aria-labelledby="channel-status"
      className={`rounded-2xl border ${
        blocked
          ? "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
          : "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
      }`}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-5 pt-4 pb-3">
        {/* Shape as well as colour: a filled dot for blocked, a ring for
            clear. Rule 4 — the panel has to survive greyscale. */}
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            blocked
              ? "bg-amber-500 dark:bg-amber-400"
              : "border-2 border-emerald-600 dark:border-emerald-400"
          }`}
        />
        <div className="min-w-0 flex-1">
          <h2
            id="channel-status"
            className={`text-sm font-bold ${
              blocked
                ? "text-amber-900 dark:text-amber-200"
                : "text-emerald-900 dark:text-emerald-200"
            }`}
          >
            {blocked ? "Statements are not going out" : "Statements can go out"}
          </h2>
          <p
            className={`mt-0.5 text-sm text-pretty ${
              blocked
                ? "text-amber-900/90 dark:text-amber-200/90"
                : "text-emerald-900/90 dark:text-emerald-200/90"
            }`}
          >
            {blocked
              ? `${blockedReason} Nothing on this page is being sent — every statement is refused before it reaches Twilio, so nothing is attempted and nothing is billed. Preparing and previewing still work, and everything you prepare is shown exactly as it would go out.`
              : "Prepared statements will be delivered. Nothing leaves until you press send (2.20)."}
          </p>
        </div>
      </div>

      {/* The reasoning, folded. `<details>` rather than a state hook: it is a
          server component, it needs no JavaScript to open, and it keeps the
          page renderable with scripting off. */}
      <details className="group border-t border-black/5 px-5 py-3 dark:border-white/5">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-semibold text-gray-700 marker:content-none dark:text-gray-300">
          <svg
            className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path d="M7.5 4.5L13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Why, and what the channel switch actually controls
        </summary>

        <div className="mt-3 space-y-3 pl-5.5 text-xs leading-relaxed text-gray-700 dark:text-gray-300">
          <p className="text-pretty">
            <strong className="font-semibold">The 24-hour window (2.28).</strong> Meta delivers a
            freeform WhatsApp message only within 24 hours of the member&apos;s own last reply to
            the Equb sender. Outside that window Meta requires a pre-approved template. Once Meta
            approves one, record its name or SID against the matching wording below so this
            message type maps to it.
          </p>
          <p className="text-pretty">
            <strong className="font-semibold">Login codes are unaffected.</strong> They go through
            Twilio Verify as a pre-approved template, which needs no window. This is not a setting,
            and turning WhatsApp on does not change it.
          </p>
          {!whatsappEnabled && (
            <p className="text-pretty">
              <strong className="font-semibold">The channel switch is off.</strong> {disabledReason}{" "}
              That switch controls WhatsApp <em>login codes</em>, which do work. It lives on{" "}
              <Link
                href="/admin/settings/messaging"
                className="font-semibold underline underline-offset-2 hover:text-indigo-700 dark:hover:text-indigo-300"
              >
                Settings → Messaging
              </Link>
              .
            </p>
          )}
          {whatsappEnabled && missingConfig.length > 0 && (
            <p className="text-pretty text-red-800 dark:text-red-300">
              <strong className="font-semibold">Not configured on this machine</strong> — missing{" "}
              <code className="rounded bg-black/5 px-1 py-0.5 font-mono dark:bg-white/10">
                {missingConfig.join(", ")}
              </code>{" "}
              in <code className="font-mono">.env.local</code>. Prepares and previews work; sends
              will fail honestly until the variables are set.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
