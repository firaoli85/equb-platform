"use server";

import { requireAdmin } from "@/lib/auth";
import { errorMessage } from "@/lib/action-result";
import { LABELS_BY_KEY, type MessageKey } from "@/lib/messages";
import {
  conversationDateRange,
  conversationSummary,
  matchesSearch,
  parseConversationFilter,
  threadSubtitle,
  type ConversationFilter,
} from "@/lib/message-centre";
import { PAGE_SIZES, pageInfo, type PageInfo } from "@/lib/paging";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

// THE MESSAGE CENTRE — the per-member surface (2.20).
//
// Messages was a page you scrolled: one flat log, every send to everybody, in
// one reverse-chronological column. The question the organizer actually has is
// never "what was the 47th message sent" — it is "what have I said to Tsion,
// and what should I say now?", and the old screen answered neither without a
// detour through her profile.
//
// So: a list of people, and the conversation with the one selected. The batch
// composer keeps its own view — sending one type to everyone it applies to is
// a genuinely different job, and merging the two would make both worse.

export type MessageThread = {
  personId: string;
  nameAmharic: string;
  nameEnglish: string;
  phone: string | null;
  /** "3 messages · last 2 days ago", or the failure if the last one failed. */
  subtitle: string;
  total: number;
  lastAt: string | null;
  lastFailed: boolean;
  /** 2.20: nothing is ever sent to them, so the row says so. */
  noMessages: boolean;
};

/**
 * NAMED, not inferred. The page holds these in `let` bindings whose type
 * cannot be read off a call it has not made yet, and a conditional type over
 * the action's return collapses to `never` the moment the union has an error
 * arm — which it always does.
 */
export type ThreadListData = {
  threads: MessageThread[];
  info: PageInfo;
  search: string;
  totalPeople: number;
};

export type ConversationData = {
  person: {
    id: string;
    nameAmharic: string;
    nameEnglish: string;
    phone: string | null;
    noMessages: boolean;
  };
  messages: ConversationMessage[];
  info: PageInfo;
  filter: ConversationFilter;
  total: number;
  summary: string | null;
};

/**
 * Everyone who can be messaged, with what has already been said to them.
 *
 * THE WHOLE ROSTER, not only people with history. A list built from the
 * message log alone would hide exactly the members the organizer most needs to
 * find — the ones he has never contacted.
 *
 * Counting is done in ONE grouped query rather than per person: this list is
 * the first thing the screen draws, and a query per member would make it
 * slower with every person added.
 */
export async function listMessageThreads(
  input?: { search?: string; page?: number },
): Promise<{ ok: true; data: ThreadListData } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // 2.4: names, phone numbers and message text all at once — precisely what
    // presentation mode exists to keep off a shared screen.
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }

    const people = await prisma.person.findMany({
      select: {
        id: true,
        nameAmharic: true,
        nameEnglishFirst: true,
        nameEnglishLast: true,
        phone: true,
        noMessages: true,
      },
      orderBy: { nameEnglishFirst: "asc" },
    });

    // One pass over the log for the counts, one for the latest row each.
    const counts = await prisma.messageLog.groupBy({
      by: ["personId"],
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const countByPerson = new Map(
      counts.map((c) => [c.personId, { total: c._count._all, lastAt: c._max.createdAt }]),
    );

    // Whether the MOST RECENT message to each person failed. A failure that
    // scrolls past unnoticed is a member who thinks they were never told.
    const latest = await prisma.messageLog.findMany({
      where: { createdAt: { in: counts.map((c) => c._max.createdAt).filter((d) => d !== null) } },
      select: { personId: true, status: true, createdAt: true },
    });
    const latestByPerson = new Map<string, string>();
    for (const row of latest) {
      // A GROUP BROADCAST HAS NO PERSON (channel TELEGRAM, personId null) and
      // therefore no thread here — the centre is the per-member view, and a
      // message to everyone is not a conversation with anyone.
      if (row.personId === null) continue;
      const known = countByPerson.get(row.personId);
      if (known?.lastAt && row.createdAt.getTime() === known.lastAt.getTime()) {
        latestByPerson.set(row.personId, row.status);
      }
    }

    const now = new Date();
    const search = input?.search ?? "";
    const all: MessageThread[] = people
      .map((p) => {
        const nameEnglish = `${p.nameEnglishFirst} ${p.nameEnglishLast ?? ""}`.trim();
        const known = countByPerson.get(p.id);
        const lastFailed = latestByPerson.get(p.id) === "FAILED";
        return {
          personId: p.id,
          nameAmharic: p.nameAmharic,
          nameEnglish,
          phone: p.phone,
          total: known?.total ?? 0,
          lastAt: known?.lastAt?.toISOString() ?? null,
          lastFailed,
          noMessages: p.noMessages,
          subtitle: threadSubtitle({
            total: known?.total ?? 0,
            lastAt: known?.lastAt ?? null,
            lastFailed,
            now,
          }),
        };
      })
      .filter((t) =>
        matchesSearch({ nameAmharic: t.nameAmharic, nameEnglish: t.nameEnglish, phone: t.phone }, search),
      )
      // MOST RECENTLY MESSAGED FIRST, then everyone else alphabetically —
      // the order a messaging tool uses, because the conversation he was just
      // having is the one he is most likely to want back.
      .sort((a, b) => {
        if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
        if (a.lastAt) return -1;
        if (b.lastAt) return 1;
        return a.nameEnglish.localeCompare(b.nameEnglish);
      });

    const info = pageInfo(all.length, input?.page ?? 1, PAGE_SIZES.messageThreads);
    return {
      ok: true as const,
      data: {
        threads: all.slice(info.skip, info.skip + info.take),
        info,
        search,
        /** The unfiltered roster size, so a search can never read as "nobody". */
        totalPeople: people.length,
      },
    };
  } catch (e) {
    console.error("listMessageThreads failed:", e);
    return { ok: false as const, error: `Could not load the message list. ${errorMessage(e)}` };
  }
}

export type ConversationMessage = {
  id: string;
  templateKey: string;
  typeLabel: string;
  body: string;
  trigger: string;
  status: string;
  error: string | null;
  createdAt: string;
  toPhone: string;
};

/**
 * Everything ever said to one person, OLDEST FIRST.
 *
 * Newest LAST, like every conversation anyone has ever read. The flat log is
 * newest-first because it is a log — you open it to see what just happened.
 * A conversation is the opposite: you open it to read the story, and the story
 * runs forwards.
 *
 * Paged, because this grows with every send and a member three cycles in has
 * hundreds. The LAST page is the default for the same reason the order is —
 * the most recent exchange is what he came to read.
 */
export async function getConversation(input: {
  personId: string;
  page?: number;
  type?: string;
  from?: string;
  to?: string;
}): Promise<{ ok: true; data: ConversationData } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }

    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: {
        id: true,
        nameAmharic: true,
        nameEnglishFirst: true,
        nameEnglishLast: true,
        phone: true,
        noMessages: true,
      },
    });
    if (!person) return { ok: false as const, error: "Person not found." };

    const filter: ConversationFilter = parseConversationFilter({
      type: input.type,
      from: input.from,
      to: input.to,
    });
    const range = conversationDateRange(filter);

    const where = {
      personId: person.id,
      ...(filter.templateKey === "all" ? {} : { templateKey: filter.templateKey }),
      ...(range.gte || range.lt ? { createdAt: range } : {}),
    };

    // TWO COUNTS, DELIBERATELY. `matching` is what the filter found; `total`
    // is everything ever sent to them. Showing only the first lets a filter
    // that matches nothing read as "this member has never been messaged".
    const [matching, total] = await Promise.all([
      prisma.messageLog.count({ where }),
      prisma.messageLog.count({ where: { personId: person.id } }),
    ]);

    const size = PAGE_SIZES.memberConversation;
    // The LAST page by default — the recent end of the conversation.
    const lastPage = Math.max(1, Math.ceil(matching / size));
    const info = pageInfo(matching, input.page ?? lastPage, size);

    const rows = await prisma.messageLog.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: info.skip,
      take: info.take,
    });

    const nameEnglish = `${person.nameEnglishFirst} ${person.nameEnglishLast ?? ""}`.trim();
    return {
      ok: true as const,
      data: {
        person: {
          id: person.id,
          nameAmharic: person.nameAmharic,
          nameEnglish,
          phone: person.phone,
          noMessages: person.noMessages,
        },
        messages: rows.map(
          (r): ConversationMessage => ({
            id: r.id,
            templateKey: r.templateKey,
            typeLabel: LABELS_BY_KEY[r.templateKey as MessageKey] ?? r.templateKey,
            body: r.body,
            trigger: r.trigger,
            status: r.status,
            error: r.error,
            createdAt: r.createdAt.toISOString(),
            toPhone: r.toPhone,
          }),
        ),
        info,
        filter,
        total,
        // Null when nothing is narrowed — a conversation showing everything
        // says nothing at all about filters.
        summary: conversationSummary({
          name: person.nameEnglishFirst,
          filter,
          shown: rows.length,
          total,
          label: (key) => LABELS_BY_KEY[key] ?? key,
        }),
      },
    };
  } catch (e) {
    console.error("getConversation failed:", e);
    return { ok: false as const, error: `Could not load the conversation. ${errorMessage(e)}` };
  }
}
