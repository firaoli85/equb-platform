// The calm full-page notice for pages that are entirely identity or money
// (2.4/D-6). Rendered INSTEAD of querying — the sensitive data is never
// loaded, let alone sent.
//
// ON THE PLATFORM'S OWN TOKENS (14 Aug 2026 audit). It carried no dark-mode
// classes at all, so on a dark theme it rendered a white card in a black page
// — a foreign-looking box on the one screen that is deliberately shown to a
// room of people.
export function PresentationHidden({ what }: { what: string }) {
  return (
    <main>
      <h1 className="mb-2 text-xl font-black tracking-tight text-gray-900 dark:text-white">
        {what}
      </h1>
      <p className="max-w-md rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
        Hidden in presentation mode. Use the switch in the header to show this page again
        after the call.
      </p>
    </main>
  );
}
