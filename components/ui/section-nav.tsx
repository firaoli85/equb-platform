import Link from "next/link";

// A SECOND LEVEL OF NAVIGATION, for screens that are doing more than one job.
//
// Two screens grew into walls: the member profile's Settings tab stacked
// participation, lucky numbers, names, phone, PIN, messaging and sign-in
// history into one scroll, and Messages stacked four alerts, a composer, four
// template editors and a six-column log. Both were readable line by line and
// unreadable as a screen — you could not tell where one job ended and the next
// began, so every visit meant scrolling past three things to reach the fourth.
//
// The rule this applies is the one docs/ADMIN_IA.md argues at the top level,
// one level down: WEIGHT MATCHES PLACEMENT. A job that has its own reason to
// exist gets its own section, with room to explain itself.
//
// PILLS, NOT UNDERLINES. Where this sits inside a tabbed screen the parent
// tabs already own the underline. A nested nav in the same style competes with
// its parent and the reader loses track of which level they are changing.
//
// STATE IN THE URL. These are plain links to a server-rendered page, so a
// section is linkable, survives a reload, and — because the page branches on
// the parameter — only the chosen section is ever built.

export type Section = {
  key: string;
  label: string;
  /** Shown as a count bubble; omit when there is nothing to count. */
  count?: number;
  /** Draws attention to a section that needs the organizer. */
  attention?: boolean;
};

export function SectionNav({
  sections,
  active,
  /** Builds the href for a section — the caller owns its own query shape. */
  hrefFor,
  label,
  className = "",
}: {
  sections: readonly Section[];
  active: string;
  hrefFor: (key: string) => string;
  /** Names the group for a screen reader: "Settings sections", "Messaging". */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      {/* Scrolls inside itself at 390px — four pills do not fit a phone, and
          the page must never scroll sideways (UI_STANDARDS rule 11). */}
      <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 touch-pan-x">
        {sections.map((section) => {
          const isActive = section.key === active;
          return (
            <li key={section.key} className="shrink-0">
              <Link
                href={hrefFor(section.key)}
                aria-current={isActive ? "page" : undefined}
                scroll={false}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] md:min-h-9 ${
                  isActive
                    ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-500 dark:bg-indigo-500"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-[#141414] dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-white"
                }`}
              >
                {section.label}
                {section.count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400"
                    }`}
                  >
                    {section.count}
                  </span>
                )}
                {/* A dot, not a colour change: rule 4 forbids colour as the
                    only carrier, and a section that needs attention has to
                    survive being read in greyscale. */}
                {section.attention && (
                  <span
                    aria-label="needs attention"
                    role="img"
                    className={`h-1.5 w-1.5 rounded-full ${
                      isActive ? "bg-white" : "bg-amber-500 dark:bg-amber-400"
                    }`}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The heading that opens a section, with room to say what the section is for.
 *
 * Separate from `CardHeader` on purpose: a section is not a card. Wrapping a
 * whole job in a bordered box adds a frame the reader has to look past, and
 * nested cards — a card of cards — are always wrong. This is a heading and a
 * sentence, and the content below it stands on the page.
 */
export function SectionHeading({
  title,
  children,
  right,
}: {
  title: string;
  /** One or two sentences. What this section is for, and what it will not do. */
  children?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="max-w-prose">
        <h2 className="text-base font-black tracking-tight text-gray-900 dark:text-white">
          {title}
        </h2>
        {children && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 text-pretty">{children}</p>
        )}
      </div>
      {right}
    </div>
  );
}
