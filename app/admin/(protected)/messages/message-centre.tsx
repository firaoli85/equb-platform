"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ConversationMessage, MessageThread } from "@/app/actions/message-centre";
import { sendToMember } from "@/app/actions/member-messaging";
import type { MemberMessagingView } from "@/app/actions/member-messaging";
import { SaveButton, SaveFeedback, type SaveState } from "@/components/ui/save-button";
import { Pill } from "@/components/ui/primitives";
import type { ConversationFilter } from "@/lib/message-centre";

// THE MESSAGE CENTRE (2.20).
//
// People on the left, the conversation on the right — the shape every
// messaging tool has, because the question is always about ONE person. The old
// screen was a single reverse-chronological log of every send to everybody:
// finding what had been said to Tsion meant reading past twenty-six other
// people, and deciding what to send her next meant leaving for her profile.
//
// TWO DELIBERATE DEPARTURES FROM THE OLD LOG:
//
//   NEWEST LAST. A log is newest-first because you open it to see what just
//   happened. A conversation is the opposite — you open it to read the story,
//   and a story runs forwards. It opens on the last page for the same reason.
//
//   EVERY PERSON APPEARS, not only those with history. A list built from the
//   message log would hide the members he most needs to find: the ones he has
//   never contacted at all.
//
// The batch composer keeps its own view. Sending one type to everyone it
// applies to is a genuinely different job from talking to one person, and
// merging them would make both worse.

export function MessageCentre({
  threads,
  info,
  search,
  totalPeople,
  selected,
  conversation,
  sendPanel,
}: {
  threads: MessageThread[];
  info: { page: number; pages: number; total: number };
  search: string;
  totalPeople: number;
  selected: string | null;
  conversation: {
    person: { id: string; nameAmharic: string; nameEnglish: string; phone: string | null; noMessages: boolean };
    messages: ConversationMessage[];
    info: { page: number; pages: number; total: number };
    filter: ConversationFilter;
    total: number;
    summary: string | null;
  } | null;
  /** What can be sent to the selected member right now, with previews. */
  sendPanel: MemberMessagingView | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <ThreadList
        threads={threads}
        info={info}
        search={search}
        totalPeople={totalPeople}
        selected={selected}
      />
      {conversation === null ? (
        <EmptyPane />
      ) : (
        <Conversation
          conversation={conversation}
          sendPanel={sendPanel}
        />
      )}
    </div>
  );
}

// ————————————————— The people —————————————————

function ThreadList({
  threads,
  info,
  search,
  totalPeople,
  selected,
}: {
  threads: MessageThread[];
  info: { page: number; pages: number; total: number };
  search: string;
  totalPeople: number;
  selected: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(search);

  // TYPE-AND-WAIT, not type-and-thrash. The search runs on the server so it
  // reaches every person, not only the current page — and a request per
  // keystroke would send one for "T", "Ts", "Tsi". 250ms is below the point
  // where a search feels laggy and above the point where it fires mid-word.
  const settled = useRef(search);
  useEffect(() => {
    if (query === settled.current) return;
    const timer = setTimeout(() => {
      settled.current = query;
      const params = new URLSearchParams();
      params.set("section", "people");
      if (query.trim()) params.set("q", query.trim());
      if (selected) params.set("person", selected);
      router.replace(`/admin/messages?${params}`);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, router, selected]);

  const hrefFor = (personId: string) => {
    const params = new URLSearchParams({ section: "people", person: personId });
    if (search.trim()) params.set("q", search.trim());
    return `/admin/messages?${params}`;
  };

  return (
    <aside className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#141414]">
      <div className="border-b border-gray-100 p-3 dark:border-gray-800">
        <label className="block">
          <span className="sr-only">Search people by name or phone</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or phone"
            data-testid="thread-search"
            className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none dark:border-gray-700 dark:bg-[#1a1a1a] dark:text-white"
          />
        </label>
        {/* A SEARCH MUST NEVER READ AS "NOBODY". Stating the roster size next
            to the match count is what separates "no such member" from "no
            match for what you typed". */}
        <p className="mt-1.5 px-0.5 text-[11px] text-gray-600 dark:text-gray-400">
          {search.trim()
            ? `${info.total} of ${totalPeople} people match “${search.trim()}”`
            : `${totalPeople} people`}
        </p>
      </div>

      {threads.length === 0 ? (
        <p className="px-3.5 py-4 text-sm text-gray-600 dark:text-gray-400">
          Nobody matches that. Clear the search to see everyone.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {threads.map((t) => (
            <li key={t.personId}>
              <Link
                href={hrefFor(t.personId)}
                data-person={t.personId}
                aria-current={t.personId === selected ? "true" : undefined}
                className={
                  "flex min-h-11 flex-col gap-0.5 px-3.5 py-2.5 transition-colors " +
                  (t.personId === selected
                    ? "bg-indigo-50 dark:bg-indigo-950/40"
                    : "hover:bg-gray-50 dark:hover:bg-white/5")
                }
              >
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-bold text-gray-900 dark:text-white">
                    {t.nameAmharic}
                  </span>
                  <span className="truncate text-xs text-gray-600 dark:text-gray-400">
                    {t.nameEnglish}
                  </span>
                </span>
                <span
                  className={
                    "text-[11px] " +
                    (t.lastFailed
                      ? "font-bold text-red-700 dark:text-red-400"
                      : "text-gray-600 dark:text-gray-400")
                  }
                >
                  {t.subtitle}
                </span>
                {/* 2.20: the hardship flag stops every send. Saying so in the
                    list means he never composes a message that cannot go. */}
                {t.noMessages && (
                  <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-400">
                    No messages (hardship)
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {info.pages > 1 && (
        <ThreadPager info={info} search={search} selected={selected} />
      )}
    </aside>
  );
}

function ThreadPager({
  info,
  search,
  selected,
}: {
  info: { page: number; pages: number; total: number };
  search: string;
  selected: string | null;
}) {
  const href = (page: number) => {
    const params = new URLSearchParams({ section: "people", page: String(page) });
    if (search.trim()) params.set("q", search.trim());
    if (selected) params.set("person", selected);
    return `/admin/messages?${params}`;
  };
  return (
    <nav
      aria-label="People pages"
      className="flex items-center justify-between gap-2 border-t border-gray-100 px-3.5 py-2 text-xs dark:border-gray-800"
    >
      <PagerLink href={href(info.page - 1)} disabled={info.page <= 1}>
        ← Previous
      </PagerLink>
      <span className="tabular-nums text-gray-600 dark:text-gray-400">
        Page {info.page} of {info.pages}
      </span>
      <PagerLink href={href(info.page + 1)} disabled={info.page >= info.pages}>
        Next →
      </PagerLink>
    </nav>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="font-semibold text-gray-400 dark:text-gray-600">{children}</span>;
  }
  return (
    <Link href={href} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-400">
      {children}
    </Link>
  );
}

function EmptyPane() {
  return (
    <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
      {/* An empty screen is an invitation to act, not a shrug. */}
      <p className="max-w-sm text-sm text-gray-600 dark:text-gray-400 text-pretty">
        Pick someone on the left to read everything that has been sent to them — and to send
        them a statement from here.
      </p>
    </div>
  );
}

// ————————————————— The conversation —————————————————

function Conversation({
  conversation,
  sendPanel,
}: {
  conversation: NonNullable<Parameters<typeof MessageCentre>[0]["conversation"]>;
  sendPanel: MemberMessagingView | null;
}) {
  const { person, messages, info, filter, summary } = conversation;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-[#141414]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-base font-black text-gray-900 dark:text-white">{person.nameAmharic}</h2>
          <span className="text-sm text-gray-600 dark:text-gray-400">{person.nameEnglish}</span>
          <Link
            href={`/admin/people/${person.id}`}
            className="ml-auto text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-400"
          >
            Open their record →
          </Link>
        </div>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          {person.phone ?? "No phone number on file — nothing can be delivered"} ·{" "}
          {conversation.total} message{conversation.total === 1 ? "" : "s"} in all
        </p>
      </header>

      <ConversationFilters personId={person.id} filter={filter} />

      {/* A FILTERED CONVERSATION SAYS SO. Without this, "one message" from a
          narrowed view is indistinguishable from a member who has been
          contacted once — and that is a fact he would act on. */}
      {summary && (
        <p
          data-testid="conversation-summary"
          className="rounded-xl bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200"
        >
          {summary}
        </p>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-[#141414]">
        {messages.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
            {conversation.total === 0
              ? `Nothing has been sent to ${person.nameEnglish.split(" ")[0]} yet.`
              : "No messages match those filters. Clear them to see the whole conversation."}
          </p>
        ) : (
          <ol className="space-y-2" data-testid="conversation">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ol>
        )}

        {info.pages > 1 && (
          <ConversationPager personId={person.id} info={info} filter={filter} />
        )}
      </div>

      {sendPanel && <SendFromHere personName={person.nameEnglish.split(" ")[0]} view={sendPanel} />}
    </section>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const failed = message.status === "FAILED";
  return (
    <li
      data-message={message.id}
      data-status={message.status}
      className={
        "rounded-xl border px-3.5 py-2.5 " +
        (failed
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
          : "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/5")
      }
    >
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-bold text-gray-800 dark:text-gray-200">{message.typeLabel}</span>
        <Pill tone={message.trigger === "AUTOMATIC" ? "accent" : "neutral"}>
          {message.trigger === "AUTOMATIC" ? "Automatic" : "Sent by you"}
        </Pill>
        {failed ? <Pill tone="problem">Did not arrive</Pill> : <Pill tone="good">Sent</Pill>}
        <span className="ml-auto tabular-nums text-gray-600 dark:text-gray-400">
          {new Date(message.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100">{message.body}</p>
      {message.error && (
        <p className="mt-1 text-xs font-semibold text-red-800 dark:text-red-400">
          {message.error}
        </p>
      )}
    </li>
  );
}

function ConversationFilters({
  personId,
  filter,
}: {
  personId: string;
  filter: ConversationFilter;
}) {
  const router = useRouter();
  const go = (next: Partial<ConversationFilter>) => {
    const merged = { ...filter, ...next };
    const params = new URLSearchParams({ section: "people", person: personId });
    if (merged.templateKey !== "all") params.set("type", merged.templateKey);
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    router.push(`/admin/messages?${params}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-sm dark:border-gray-800 dark:bg-[#141414]">
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-gray-600 dark:text-gray-400">
          Type
        </span>
        <select
          value={filter.templateKey}
          onChange={(e) => go({ templateKey: e.target.value as ConversationFilter["templateKey"] })}
          aria-label="Filter by message type"
          data-testid="filter-type"
          className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#1a1a1a] dark:text-white"
        >
          <option value="all">Every type</option>
          <option value="PAYMENT_CONFIRMED">Payment confirmation</option>
          <option value="BEHIND_NOTICE">Behind notice</option>
          <option value="LATE_NOTICE">Late notice</option>
          <option value="WINNER_ANNOUNCEMENT">Winner announcement</option>
          <option value="CYCLE_CLOSING_STATEMENT">Cycle closing statement</option>
          <option value="LOCKOUT_NOTICE">Lockout notice</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-gray-600 dark:text-gray-400">
          From
        </span>
        <input
          type="date"
          value={filter.from ?? ""}
          onChange={(e) => go({ from: e.target.value || null })}
          aria-label="Only messages from this date"
          data-testid="filter-from"
          className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#1a1a1a] dark:text-white"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-gray-600 dark:text-gray-400">
          To
        </span>
        <input
          type="date"
          value={filter.to ?? ""}
          onChange={(e) => go({ to: e.target.value || null })}
          aria-label="Only messages up to this date"
          data-testid="filter-to"
          className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#1a1a1a] dark:text-white"
        />
      </label>
      {(filter.templateKey !== "all" || filter.from || filter.to) && (
        <Link
          href={`/admin/messages?section=people&person=${personId}`}
          className="mb-2 text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-400"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}

function ConversationPager({
  personId,
  info,
  filter,
}: {
  personId: string;
  info: { page: number; pages: number; total: number };
  filter: ConversationFilter;
}) {
  const href = (page: number) => {
    const params = new URLSearchParams({
      section: "people",
      person: personId,
      cpage: String(page),
    });
    if (filter.templateKey !== "all") params.set("type", filter.templateKey);
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    return `/admin/messages?${params}`;
  };
  return (
    <nav
      aria-label="Conversation pages"
      className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2 text-xs dark:border-gray-800"
    >
      {/* "Older" and "Newer", not "Previous" and "Next" — the conversation
          runs forwards, so the direction words have to mean time. */}
      <PagerLink href={href(info.page - 1)} disabled={info.page <= 1}>
        ← Older
      </PagerLink>
      <span className="tabular-nums text-gray-600 dark:text-gray-400">
        Page {info.page} of {info.pages} · {info.total} message{info.total === 1 ? "" : "s"}
      </span>
      <PagerLink href={href(info.page + 1)} disabled={info.page >= info.pages}>
        Newer →
      </PagerLink>
    </nav>
  );
}

// ————————————————— Sending from inside the conversation —————————————————

function SendFromHere({
  personName,
  view,
}: {
  personName: string;
  view: MemberMessagingView;
}) {
  const router = useRouter();
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const applicable = view.types.filter((t) => t.applicable);
  const blocked = view.types.filter((t) => !t.applicable);

  async function send(key: string, label: string) {
    if (!view.participationId) return;
    setSendingKey(key);
    setSave({ kind: "saving" });
    try {
      const outcome = await sendToMember({ participationId: view.participationId, key });
      if (!outcome.ok) {
        setSave({ kind: "err", message: `Not sent: ${outcome.error}` });
        return;
      }
      setSave(
        outcome.data.status === "SENT"
          ? { kind: "ok", message: `${label} sent to ${personName}.` }
          : {
              kind: "err",
              message: `${label} did not go: ${outcome.data.reason ?? outcome.data.status}`,
            },
      );
      // The conversation IS the confirmation — the message he just sent has to
      // appear in it, or the screen is telling him two different things.
      router.refresh();
    } catch {
      setSave({
        kind: "err",
        message: "Could not reach the server — nothing was sent. Check the conversation above.",
      });
    } finally {
      setSendingKey(null);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm dark:border-gray-800 dark:bg-[#141414]">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white">
        Send {personName} a statement
      </h3>

      {view.blockedReason ? (
        <p role="status" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {view.blockedReason}
        </p>
      ) : applicable.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Nothing applies to {personName} right now — every type below says why.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {applicable.map((t) => (
            <li
              key={t.key}
              data-send-type={t.key}
              className="rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{t.label}</span>
                {t.chasing && <Pill tone="attention">A chase</Pill>}
              </div>
              {/* THE REAL TEXT, WITH THEIR REAL FIGURES (2.20/2.21). He reads
                  what the member will read, before it goes. */}
              {t.preview && (
                <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-800 dark:bg-white/5 dark:text-gray-200">
                  {t.preview}
                </p>
              )}
              <SaveButton
                className="mt-2"
                state={sendingKey === t.key || save.kind !== "idle" ? save : { kind: "idle" }}
                onSave={() => void send(t.key, t.label)}
                onStateSettled={() => setSave({ kind: "idle" })}
                label={`Send the ${t.label.toLowerCase()}`}
                savingLabel="Sending…"
                disabled={sendingKey !== null && sendingKey !== t.key}
              />
            </li>
          ))}
        </ul>
      )}

      {blocked.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-gray-600 dark:text-gray-400">
            {blocked.length} type{blocked.length === 1 ? "" : "s"} that do not apply
          </summary>
          {/* A greyed option with no explanation is a bug report waiting to be
              filed, so every one carries its reason. */}
          <ul className="mt-1.5 space-y-1">
            {blocked.map((t) => (
              <li key={t.key} className="text-xs text-gray-600 dark:text-gray-400">
                <span className="font-semibold">{t.label}</span> — {t.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <SaveFeedback state={save} className="mt-2" />
    </div>
  );
}
