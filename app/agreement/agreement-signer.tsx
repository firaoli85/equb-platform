"use client";

import { useState } from "react";
import type { AgreementToSign } from "@/app/actions/agreement";
import { signMyAgreement } from "@/app/actions/agreement";
import { SIGNATURE_NOTICE } from "@/lib/agreement";
import { SaveButton, type SaveState } from "@/components/ui/save-button";

// READ IT, THEN SIGN IT.
//
// Written for someone who is not comfortable with apps: their own terms in one
// sentence first, then the document, then one tick and one button. No jargon,
// nothing collapsed behind a "show more", and no way onward that skips it.
//
// THE THREE THINGS THE BROWSER CAN HONESTLY GIVE are collected at the moment
// of pressing — screen size and timezone from the browser, and the hash of the
// document that was actually on screen. Everything else (IP, user agent,
// browser, OS, device, location) is read from the request on the server, where
// it cannot be edited by the page.
//
// THERE IS NO MAC ADDRESS. A web page cannot read one, on any browser. The
// notice above the button says what IS recorded and claims nothing more.

export function AgreementSigner({ agreement }: { agreement: AgreementToSign }) {
  const [read, setRead] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  async function sign() {
    setSave({ kind: "saving" });
    try {
      const result = await signMyAgreement({
        participationId: agreement.participationId,
        // The hash of what was RENDERED HERE. The server re-renders from live
        // terms and refuses if the two differ — so a member can never sign a
        // document that changed while the page sat open.
        documentHash: agreement.documentHash,
        screen:
          typeof window === "undefined"
            ? undefined
            : `${window.screen.width}x${window.screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (!result.ok) {
        setSave({ kind: "err", message: result.error });
        return;
      }
      // A FULL LOAD, not a client transition. The gate lives in the member
      // layout, which is a server component — a soft navigation could be
      // served from the router cache and bounce them straight back here.
      window.location.assign("/me");
    } catch {
      setSave({
        kind: "err",
        message:
          "Could not reach the server, so nothing was signed. Check your connection and press Sign again.",
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">
          Welcome, {agreement.memberFirstName}
        </h1>
        {/* THEIR TERMS, IN ONE SENTENCE, BEFORE THE DOCUMENT. Dates and their
            own counts — never a cycle week number (UI_STANDARDS 8c). */}
        <p className="text-base font-semibold text-indigo-800 dark:text-indigo-300 text-pretty">
          {agreement.welcome}
        </p>
        {/* WHY THEY ARE HERE — the route's own sentence, from the server. A
            member gated for having no payment recorded was never sent a
            message, and the copy below must not tell them to check one. */}
        <p className="text-sm text-gray-600 dark:text-gray-400 text-pretty">
          {agreement.requirementReason}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-pretty">
          It is your own agreement — every figure in it is yours.
        </p>
      </header>

      <article
        data-testid="agreement-document"
        className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-5 shadow-sm sm:px-6 dark:border-gray-800 dark:bg-[#141414]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 pb-3 dark:border-gray-800">
          <h2 className="text-sm font-black tracking-tight text-gray-900 dark:text-white">
            Equb participation agreement
          </h2>
          <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
            Version {agreement.version}
          </span>
        </div>

        {agreement.clauses.map((clause) => (
          <section key={clause.heading} className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{clause.heading}</h3>
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 text-pretty">
              {clause.body}
            </p>
          </section>
        ))}
      </article>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-6 dark:border-gray-800 dark:bg-[#141414]">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={read}
            onChange={(e) => {
              setRead(e.target.checked);
              setSave({ kind: "idle" });
            }}
            data-testid="agreement-read"
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500/40 dark:border-gray-600"
          />
          <span className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
            I have read this agreement and I agree to it.
          </span>
        </label>

        {/* WHAT IS RECORDED, SAID PLAINLY — not a legal notice, a sentence.
            It names what is kept and claims nothing it cannot hold. */}
        <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 text-pretty">
          {SIGNATURE_NOTICE}
        </p>

        <SaveButton
          state={save}
          onSave={() => void sign()}
          onStateSettled={() => setSave({ kind: "idle" })}
          label="Sign and see my payments"
          savingLabel="Signing…"
          dirty={read}
          notDirtyHint="Tick the box above once you have read it."
        />
      </div>
    </main>
  );
}
