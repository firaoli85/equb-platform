// ONE PRESENTATION OF "YOU ARE NOT IN A CYCLE" (14 Aug 2026 audit).
//
// The same state read three different ways: home rendered a styled card with
// guidance, Schedule a bare centred paragraph, and Group leaked the action's
// raw error string as unstyled text. A member who taps between the three in
// one sitting is being told the same thing in three voices, one of which
// looks like a fault.
//
// The card is home's — it was the one that already said something useful —
// so this is that markup with a name, not a fourth design.

export function NotInCycle({
  title = "You’re not in the current cycle",
  line,
}: {
  title?: string;
  /** The sentence under the title — callers pass notInCurrentCycleLine(). */
  line: string;
}) {
  return (
    <section className="animate-fade-in-up rounded-2xl border border-gray-200 bg-white px-5 py-6 text-center dark:border-gray-800 dark:bg-[#141414]">
      <h1 className="text-xl font-black text-gray-900 dark:text-white text-balance">{title}</h1>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-600 dark:text-gray-400 text-pretty">
        {line}
      </p>
    </section>
  );
}
