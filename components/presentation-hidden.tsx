// The calm full-page notice for pages that are entirely identity or money
// (2.4/D-6). Rendered INSTEAD of querying — the sensitive data is never
// loaded, let alone sent.
export function PresentationHidden({ what }: { what: string }) {
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold">{what}</h1>
      <p className="max-w-md rounded border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        Hidden in presentation mode. Use the switch in the header to show this page again
        after the call.
      </p>
    </main>
  );
}
