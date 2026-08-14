// THE MEMBER'S OWN SIGNED DOCUMENTS (Cycle-2 build, feature B).
//
// A plain presentational component — no hooks, no client directive — so the
// documents page stays a server component and the tests can render this
// directly with fixture rows.
//
// WHAT RENDERS IS THE STORED TEXT. Each card shows `documentText` exactly as
// it was stored beside the signature — never a re-render from the current
// version, whose wording or figures may have moved on since. A member
// re-reading "their agreement" is reading the words they actually agreed to;
// that is the promise the signature row's copy exists to keep.

export type SignedAgreement = {
  id: string;
  /** ISO — formatted here in the member's own clock, like the signing screen. */
  signedAt: string;
  version: number;
  cycleName: string;
  documentText: string;
};

function signedMoment(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SignedAgreements({ agreements }: { agreements: SignedAgreement[] }) {
  if (agreements.length === 0) {
    // The honest empty state: what WILL appear here, and what puts it there.
    return (
      <div className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm px-5 py-10 text-center">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">No documents yet</p>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 text-pretty">
          When you sign your Equb agreement, your own copy appears here — the exact words you
          signed, kept for you.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {agreements.map((agreement) => (
        <li key={agreement.id}>
          <article
            aria-label={`Your signed agreement — ${agreement.cycleName}`}
            className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-gray-100 dark:border-gray-800 px-5 py-3">
              <h2 className="text-sm font-black text-gray-900 dark:text-white">
                Your Equb agreement — {agreement.cycleName}
              </h2>
              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                v{agreement.version}
              </span>
            </header>
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Signed {signedMoment(agreement.signedAt)}
              </p>
              {/* The exact text they signed — verbatim, whitespace kept. */}
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                {agreement.documentText}
              </p>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
