import Link from "next/link";
import { getMessagingTiming, getPlatformSettings } from "@/app/actions/settings";
import { Alert } from "@/components/ui/primitives";
import { telegramMissingConfig } from "@/lib/telegram";
import { MessageTimingForm } from "./message-timing-form";
import { MessagingForm } from "./messaging-form";

export const dynamic = "force-dynamic";

export default async function MessagingSettingsPage() {
  const result = await getPlatformSettings();
  if (!result.ok) return <Alert kind="err">{result.error}</Alert>;
  const timing = await getMessagingTiming();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Channels</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Which channels the platform will actually use. A door that cannot deliver is never
          offered to a member — the sign-in screen reads these switches too (2.28).
        </p>
      </section>

      <MessagingForm initial={result.data} />

      <section>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">
          When each message sends
        </h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Whether a message goes out on its own or waits for you, and — for the two that run on
          a clock — which day and time. These are yours to change: the platform works out what
          is true, you decide when a member hears it.
        </p>
        {/* WHAT IS AND IS NOT LIVE, SAID ONCE AND UP FRONT. These settings are
            stored before anything reads them (the engine's phase order), and a
            switch that looks armed but is not would be worse than no switch. */}
        <p className="mt-2 max-w-prose text-sm font-semibold text-amber-800 dark:text-amber-300">
          Saved and kept, but not yet acted on. Message sending still behaves exactly as it
          does today; these choices take effect when the message work lands.
        </p>
      </section>

      {timing.ok ? (
        <MessageTimingForm initial={timing.data} />
      ) : (
        <Alert kind="err">{timing.error}</Alert>
      )}

      {/* The factual state of each channel, stated once. It is not a
          preference — SMS is closed at the carrier level and re-proposing it
          is how the same afternoon gets spent twice. */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">
          Where each channel stands
        </h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-gray-900 dark:text-white">
              WhatsApp Business — approved
            </dt>
            <dd className="mt-0.5 max-w-prose text-gray-700 dark:text-gray-300">
              Business verified with Meta, sender +1 301 683 5755, display name &ldquo;Equb&rdquo;,
              wired through Twilio. This is the per-member channel: confirmations, behind
              notices, winner announcements, closing statements — each carried by a
              Meta-approved template.
            </dd>
          </div>
          <div>
            {/* DERIVED, NEVER A STORED CLAIM (§5.15). This line said
                "working" while zero Telegram code existed — a sentence nobody
                could check. Now it reads the same config check the send path
                refuses on, so the two cannot disagree. */}
            <dt className="font-semibold text-gray-900 dark:text-white">
              Telegram group —{" "}
              {telegramMissingConfig().length === 0 ? "configured" : "not configured"}
            </dt>
            <dd className="mt-0.5 max-w-prose text-gray-700 dark:text-gray-300">
              The weekly group broadcast only: one bot, one chat, one message to everyone, sent
              by hand from Messages → Send.
              {telegramMissingConfig().length > 0 && (
                <>
                  {" "}
                  Not configured — set{" "}
                  <code className="font-mono text-xs">{telegramMissingConfig().join(" and ")}</code>{" "}
                  in <code className="font-mono text-xs">.env.local</code> once the bot exists.
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-gray-900 dark:text-white">
              US SMS — closed, do not re-propose
            </dt>
            <dd className="mt-0.5 max-w-prose text-gray-700 dark:text-gray-300">
              Since February 2025 US carriers block unregistered A2P traffic from 10-digit
              numbers outright — undelivered, not delayed. The gate is The Campaign Registry,
              which sits underneath every provider, so changing vendor changes nothing.
              Registration was rejected with a privacy page and terms already in place.
            </dd>
          </div>
        </dl>
      </section>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        The wording of every message lives with the messages themselves —{" "}
        <Link
          href="/admin/messages"
          className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
        >
          open Messages to edit a template →
        </Link>
      </p>
    </div>
  );
}
