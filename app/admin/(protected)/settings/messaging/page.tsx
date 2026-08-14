import Link from "next/link";
import { getPlatformSettings } from "@/app/actions/settings";
import { Alert } from "@/components/ui/primitives";
import { MessagingForm } from "./messaging-form";

export const dynamic = "force-dynamic";

export default async function MessagingSettingsPage() {
  const result = await getPlatformSettings();
  if (!result.ok) return <Alert kind="err">{result.error}</Alert>;

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
            <dt className="font-semibold text-gray-900 dark:text-white">
              Telegram group — working
            </dt>
            <dd className="mt-0.5 max-w-prose text-gray-700 dark:text-gray-300">
              The weekly group broadcast only. One bot, one chat, one message to everyone.
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
