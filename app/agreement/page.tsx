import { redirect } from "next/navigation";
import { getMyAgreement } from "@/app/actions/agreement";
import { getCurrentUser } from "@/lib/auth";
import { AgreementSigner } from "./agreement-signer";

export const dynamic = "force-dynamic";

// THE SIGNING SCREEN — the one thing standing between a member and their
// portal, and the only member route outside /me.
//
// It is outside on purpose: `app/me/layout.tsx` is the gate, and a screen
// inside that layout could not redirect to itself. The proxy still requires a
// signed-in member here, so this is not a way around the front door.
//
// NOTHING ELSE IS ON THIS PAGE. No tab bar, no sidebar, no links away. A
// member who is here has one thing to do, and a screen offering somewhere else
// to go is a screen that gets left.
export default async function AgreementPage() {
  const claims = await getCurrentUser();
  if (!claims) redirect("/login");

  const result = await getMyAgreement();

  // NOTHING OWED — they arrived by typing the URL, or signed in another tab.
  // Send them where they were going rather than showing an empty page.
  if (result.ok && result.data === null) redirect("/me");

  if (!result.ok) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-red-300 bg-red-50 px-5 py-4 dark:border-red-900 dark:bg-red-950/30">
          <h1 className="text-base font-black text-red-900 dark:text-red-300">
            Your agreement could not be prepared
          </h1>
          {/* The reason, verbatim — and the portal stays shut. Opening the
              money because a check failed is the wrong way to fail. */}
          <p className="mt-1 text-sm text-red-800 dark:text-red-400">{result.error}</p>
        </div>
      </main>
    );
  }

  return <AgreementSigner agreement={result.data!} />;
}
