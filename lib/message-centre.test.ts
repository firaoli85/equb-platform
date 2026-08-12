import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conversationDateRange,
  conversationSummary,
  filterIsActive,
  matchesSearch,
  NO_FILTER,
  parseConversationFilter,
  threadSubtitle,
} from "./message-centre";

// THE MESSAGE CENTRE (2.20).
//
// Messages was a page you scrolled: one flat log of every send to everybody.
// "What have I said to Tsion?" meant reading past twenty-six other people, and
// "what should I send her now?" meant leaving for her profile entirely.
//
// These pin the parts that can be wrong without a database: what a filter
// means, what the screen says about a filter, and the two places this screen
// could quietly mislead — a search that reads as "nobody", and a failed
// message that reads as a sent one.

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the filter a URL is asking for", () => {
  it("opens showing everything", () => {
    expect(parseConversationFilter({})).toEqual(NO_FILTER);
    expect(filterIsActive(NO_FILTER)).toBe(false);
  });

  it("takes a known message type", () => {
    expect(parseConversationFilter({ type: "LATE_NOTICE" }).templateKey).toBe("LATE_NOTICE");
  });

  // EVERY UNREADABLE VALUE FALLS BACK TO "EVERYTHING", never to nothing. A
  // conversation that renders blank because a value was mistyped is
  // indistinguishable from a member who has never been messaged.
  it("ignores a type it does not know", () => {
    for (const junk of ["", "NONSENSE", "late_notice", "0"]) {
      expect(parseConversationFilter({ type: junk }).templateKey, junk).toBe("all");
    }
  });

  it("takes ISO dates and refuses anything else", () => {
    expect(parseConversationFilter({ from: "2026-08-01" }).from).toBe("2026-08-01");
    for (const junk of ["2026-8-1", "01/08/2026", "2026-02-30", "yesterday", ""]) {
      expect(parseConversationFilter({ from: junk }).from, junk).toBeNull();
    }
  });

  // A range typed backwards is a slip, not a request for nothing.
  it("swaps a backwards range instead of showing an empty conversation", () => {
    const f = parseConversationFilter({ from: "2026-08-20", to: "2026-08-01" });
    expect(f.from).toBe("2026-08-01");
    expect(f.to).toBe("2026-08-20");
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseConversationFilter({ type: ["BEHIND_NOTICE", "LATE_NOTICE"] }).templateKey).toBe(
      "BEHIND_NOTICE",
    );
  });
});

describe("what a date filter means to the query", () => {
  it("is open-ended when neither end is set", () => {
    expect(conversationDateRange(NO_FILTER)).toEqual({});
  });

  // "to 12 August" means everything said ON the 12th. Treating it as midnight
  // that morning silently drops a whole day — usually today's.
  it("includes the whole of the 'to' day", () => {
    const range = conversationDateRange({ templateKey: "all", from: null, to: "2026-08-12" });
    expect(range.lt?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("starts at midnight on the 'from' day", () => {
    const range = conversationDateRange({ templateKey: "all", from: "2026-08-01", to: null });
    expect(range.gte?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("the screen says what it is showing", () => {
  const label = (key: string) => (key === "LATE_NOTICE" ? "Late notice" : key);

  // Silent when nothing is narrowed: a conversation showing everything has
  // nothing to say about filters.
  it("says nothing when nothing is filtered", () => {
    expect(
      conversationSummary({ name: "Tsion", filter: NO_FILTER, shown: 9, total: 9, label }),
    ).toBeNull();
  });

  // A FILTERED VIEW MUST NEVER READ AS THE WHOLE ONE — the same rule
  // truncationNotice exists for.
  it("states the counts and the filter when one is on", () => {
    const summary = conversationSummary({
      name: "Tsion",
      filter: { templateKey: "LATE_NOTICE", from: "2026-08-01", to: "2026-08-12" },
      shown: 2,
      total: 9,
      label,
    })!;
    expect(summary).toContain("Showing 2 of 9 messages to Tsion");
    expect(summary).toContain("late notice only");
    expect(summary).toContain("2026-08-01 to 2026-08-12");
  });

  it("reads correctly with only one end of the range", () => {
    expect(
      conversationSummary({
        name: "Tsion",
        filter: { templateKey: "all", from: "2026-08-01", to: null },
        shown: 3,
        total: 9,
        label,
      }),
    ).toContain("from 2026-08-01");
    expect(
      conversationSummary({
        name: "Tsion",
        filter: { templateKey: "all", from: null, to: "2026-08-12" },
        shown: 3,
        total: 9,
        label,
      }),
    ).toContain("up to 2026-08-12");
  });
});

describe("what a person's row says", () => {
  const now = new Date("2026-08-12T10:00:00Z");
  const at = (iso: string) => new Date(iso);

  // The rows he most needs to find are the people he has never contacted.
  it("says so when nothing has been sent", () => {
    expect(threadSubtitle({ total: 0, lastAt: null, lastFailed: false, now })).toBe(
      "Nothing sent yet",
    );
  });

  it("counts the messages and dates the last one", () => {
    expect(
      threadSubtitle({ total: 3, lastAt: at("2026-08-12T09:00:00Z"), lastFailed: false, now }),
    ).toBe("3 messages · last today");
    expect(
      threadSubtitle({ total: 1, lastAt: at("2026-08-11T09:00:00Z"), lastFailed: false, now }),
    ).toBe("1 message · last yesterday");
    expect(
      threadSubtitle({ total: 5, lastAt: at("2026-08-09T09:00:00Z"), lastFailed: false, now }),
    ).toBe("5 messages · last 3 days ago");
    expect(
      threadSubtitle({ total: 8, lastAt: at("2026-08-01T09:00:00Z"), lastFailed: false, now }),
    ).toBe("8 messages · last 1 week ago");
  });

  // "Sent 2 days ago" over a message that never arrived is the single most
  // expensive thing this list could say.
  it("leads with the failure when the last message did not arrive", () => {
    const line = threadSubtitle({
      total: 4,
      lastAt: at("2026-08-10T09:00:00Z"),
      lastFailed: true,
      now,
    });
    expect(line).toContain("FAILED");
    expect(line).toContain("2 days ago");
  });
});

describe("finding someone", () => {
  const tsion = { nameAmharic: "ጽዮን", nameEnglish: "Tsion Bekele", phone: "+15551234567" };

  it("matches either name, in any case", () => {
    expect(matchesSearch(tsion, "tsion")).toBe(true);
    expect(matchesSearch(tsion, "BEKELE")).toBe(true);
    expect(matchesSearch(tsion, "ጽዮን")).toBe(true);
  });

  // He searches by whatever is in front of him — including a number from his
  // call log, which will not carry the same punctuation.
  it("matches a phone number however it is punctuated", () => {
    expect(matchesSearch(tsion, "555 123 4567")).toBe(true);
    expect(matchesSearch(tsion, "(555) 123-4567")).toBe(true);
    expect(matchesSearch(tsion, "1234567")).toBe(true);
  });

  it("matches everyone on an empty search", () => {
    expect(matchesSearch(tsion, "")).toBe(true);
    expect(matchesSearch(tsion, "   ")).toBe(true);
  });

  it("does not match someone else", () => {
    expect(matchesSearch(tsion, "getahun")).toBe(false);
    expect(matchesSearch({ ...tsion, phone: null }, "5551234567")).toBe(false);
  });
});

// The shape the request asked for, pinned where a scan can see it.
describe("the centre is built the way a messaging tool is", () => {
  const centre = read("app/admin/(protected)/messages/message-centre.tsx");
  const action = read("app/actions/message-centre.ts");
  const page = read("app/admin/(protected)/messages/page.tsx");

  it("is a list beside a conversation, not a page you scroll", () => {
    expect(centre).toMatch(/lg:grid-cols-\[minmax\(0,22rem\)_minmax\(0,1fr\)\]/);
    expect(centre).toContain("ThreadList");
    expect(centre).toContain("Conversation");
  });

  // Newest LAST — a conversation runs forwards, unlike the log it replaced.
  it("orders the conversation oldest first and opens at the recent end", () => {
    expect(action).toMatch(/orderBy: \{ createdAt: "asc" \}/);
    expect(action).toMatch(/const lastPage = Math\.max\(1, Math\.ceil\(matching \/ size\)\)/);
  });

  it("shows every person, not only those with history", () => {
    expect(action).toMatch(/prisma\.person\.findMany/);
    expect(action).toMatch(/totalPeople: people\.length/);
  });

  it("searches, filters by type and by date, and pages both lists", () => {
    expect(centre).toMatch(/data-testid="thread-search"/);
    expect(centre).toMatch(/data-testid="filter-type"/);
    expect(centre).toMatch(/data-testid="filter-from"/);
    expect(centre).toMatch(/data-testid="filter-to"/);
    expect(centre).toContain("ThreadPager");
    expect(centre).toContain("ConversationPager");
    expect(action).toMatch(/PAGE_SIZES\.messageThreads/);
    expect(action).toMatch(/PAGE_SIZES\.memberConversation/);
  });

  it("sends from inside the conversation, through the shared gated path", () => {
    expect(centre).toContain("sendToMember");
    expect(centre).toContain("SendFromHere");
    // The applicable types come from the SAME derivation the profile uses.
    expect(page).toContain("getMemberMessaging");
  });

  // The batch composer keeps its own view — a different job.
  it("keeps the batch composer as a separate section", () => {
    expect(page).toMatch(/key: "send", label: "Send to many"/);
    expect(page).toContain("<ComposeSend />");
  });

  it("both capped lists announce their bounds", () => {
    const paging = read("lib/paging.ts");
    expect(paging).toMatch(/messageThreads:/);
    expect(paging).toMatch(/memberConversation:/);
  });
});
