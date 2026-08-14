import {
  getConversation,
  listMessageThreads,
  type ConversationData,
  type ThreadListData,
} from "@/app/actions/message-centre";
import { getMemberMessaging, type MemberMessagingView } from "@/app/actions/member-messaging";
import { getMessagingOverview } from "@/app/actions/messages";
import { MessageCentre } from "./message-centre";
import { Card, CardHeader, Pill, Table, Td, Th, trHoverCls } from "@/components/ui/primitives";
import { Pager } from "@/components/ui/pager";
import { SectionHeading, SectionNav } from "@/components/ui/section-nav";
import { parsePage } from "@/lib/paging";
import { ChannelStatus } from "./channel-status";
import { ComposeSend } from "./compose-send";
import { GroupAnnouncement } from "./group-announcement";
import { TemplatesEditor } from "./templates-editor";
import { telegramMissingConfig } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Messaging (2.20/2.21/2.28): one place to send the manual statements, edit
// the wording, and read the log of everything that ever left. The automatic
// payment confirmation has no button here on purpose — it fires from the
// record-payment action itself.
//
// PEOPLE IS THE DEFAULT VIEW. The batch composer was, and it is the weekly
// job rather than the daily one: most visits here are about ONE member — what
// has been said to them, and what to say next. That question had no home at
// all, so it was answered by scrolling a flat log of everybody.
const SECTIONS = ["people", "send", "wording", "log"] as const;
type Section = (typeof SECTIONS)[number];

const firstOf = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string | string[];
    page?: string | string[];
    /** The message centre: who is selected, the search, the conversation. */
    person?: string | string[];
    q?: string | string[];
    cpage?: string | string[];
    type?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const value = firstOf(query.section);
  const section: Section = (SECTIONS as readonly string[]).includes(value ?? "")
    ? (value as Section)
    : "people";

  const result = await getMessagingOverview({ logPage: parsePage(query.page) });

  if (!result.ok) {
    return (
      <main>
        <h1 className="mb-6 text-xl font-semibold">Messages</h1>
        <p role="alert" className="text-sm text-red-800 dark:text-red-400">
          {result.error}
        </p>
      </main>
    );
  }
  const {
    whatsAppMissingConfig,
    whatsappEnabled,
    whatsappDisabledReason,
    templates,
    members,
    log,
    logPage,
  } = result.data;

  // THE MESSAGE CENTRE'S DATA, loaded only for the view that shows it —
  // three extra queries on a screen that is not looking at them is three
  // queries the organizer waits for.
  let threads: ThreadListData | null = null;
  let threadError: string | null = null;
  let conversation: ConversationData | null = null;
  let sendPanel: MemberMessagingView | null = null;
  const selectedPerson = firstOf(query.person) ?? null;

  if (section === "people") {
    const threadResult = await listMessageThreads({
      search: firstOf(query.q) ?? "",
      page: parsePage(query.page),
    });
    if (threadResult.ok) threads = threadResult.data;
    else threadError = threadResult.error;

    if (selectedPerson) {
      const conv = await getConversation({
        personId: selectedPerson,
        page: firstOf(query.cpage) ? parsePage(query.cpage) : undefined,
        type: firstOf(query.type),
        from: firstOf(query.from),
        to: firstOf(query.to),
      });
      if (conv.ok) conversation = conv.data;

      // What can be sent to them RIGHT NOW — the same derivation the profile
      // uses, so the two screens can never disagree about who can be messaged.
      const messaging = await getMemberMessaging({ personId: selectedPerson });
      if (messaging.ok) sendPanel = messaging.data;
    }
  }

  return (
    <main className="space-y-5">
      <header className="animate-fade-in-up">
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Messages
        </h1>
        <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400 text-pretty">
          Statements, not notifications (2.21): every message carries the member&apos;s true
          derived position at the moment it is sent. Payment confirmations send themselves when
          a payment is recorded; everything here is prepared, previewed and sent by you.
        </p>
      </header>

      {/* One panel, not four stacked alerts — see channel-status.tsx. */}
      <ChannelStatus
        whatsappEnabled={whatsappEnabled}
        disabledReason={whatsappDisabledReason}
        missingConfig={whatsAppMissingConfig}
      />

      {/* THREE JOBS, ONE AT A TIME.
          Sending a statement, editing the wording it uses, and reading what
          has already gone are three different visits. Stacked, the composer
          sat above four template editors — roughly fifteen form controls —
          above a six-column log, and finding any one of them meant scrolling
          past the other two. */}
      <SectionNav
        label="Messaging"
        active={section}
        sections={[
          { key: "people", label: "People", count: threads?.info.total },
          { key: "send", label: "Send to many" },
          { key: "wording", label: "Wording", count: templates.length },
          { key: "log", label: "Log", count: logPage.total },
        ]}
        hrefFor={(key) => `/admin/messages?section=${key}`}
        className="animate-fade-in-up-1"
      />

      {section === "people" && (
        <div className="space-y-4 animate-fade-in-up-2">
          <SectionHeading title="People">
            Everything that has been sent to each member, in the order it was said — and what can
            be sent to them now, filled from their state at this moment (2.21).
          </SectionHeading>
          {threads === null ? (
            <p role="alert" className="text-sm text-red-800 dark:text-red-400">
              {threadError}
            </p>
          ) : (
            <MessageCentre
              threads={threads.threads}
              info={threads.info}
              search={threads.search}
              totalPeople={threads.totalPeople}
              selected={selectedPerson}
              conversation={conversation}
              sendPanel={sendPanel}
            />
          )}
        </div>
      )}

      {section === "send" && (
        <div className="space-y-4 animate-fade-in-up-2">
          <SectionHeading title="Send a statement">
            The system prepares it and shows exactly who receives what, filled from each
            member&apos;s derived state. Nothing leaves until you press send (2.20).
          </SectionHeading>
          <ComposeSend />
          {/* THE OTHER CHANNEL, THE OTHER SHAPE (D-10): one message to the
              whole Telegram group, nothing per member. It lives beside the
              batch because both answer "tell people something" — the batch
              tells each member their own position, this tells everyone the
              same sentence. */}
          <GroupAnnouncement missingConfig={telegramMissingConfig()} />
        </div>
      )}

      {section === "wording" && (
        <div className="space-y-4 animate-fade-in-up-2">
          <SectionHeading title="Wording">
            Your words, the platform&apos;s numbers. Placeholders are filled from each
            member&apos;s state at send time, so a figure is never typed by hand (2.21).
          </SectionHeading>
          <TemplatesEditor templates={templates} members={members} />
        </div>
      )}

      {section === "log" && (
        <div className="space-y-4 animate-fade-in-up-2">
          <SectionHeading title="What has been sent">
            Every send, automatic or manual — the exact text, where it went, and what Twilio
            said back. Append-only: nothing here can be edited or removed.
          </SectionHeading>
          <Card>
            <CardHeader
              title="Message log"
              sub="Every send, automatic or manual — the exact text, where it went, and what Twilio said. Latest 100."
            />
            {log.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-gray-600 dark:text-gray-400">
                Nothing has been sent yet.
              </p>
            ) : (
              <div className="px-5 pb-5">
                <Table>
                  <thead>
                    <tr>
                      <Th>When</Th>
                      <Th>Member</Th>
                      <Th>Type</Th>
                      <Th>Trigger</Th>
                      <Th>Status</Th>
                      <Th>Message</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((entry) => (
                      <tr key={entry.id} className={trHoverCls}>
                        <Td className="whitespace-nowrap" numeric>
                          {entry.createdAt.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span className="font-medium">{entry.personAmharic}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {entry.person} · {entry.toPhone}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap">{entry.templateKey}</Td>
                        <Td>
                          <Pill tone={entry.trigger === "AUTOMATIC" ? "accent" : "neutral"}>
                            {entry.trigger === "AUTOMATIC" ? "Automatic" : "Manual"}
                          </Pill>
                        </Td>
                        <Td>
                          {entry.status === "SENT" ? (
                            <Pill tone="good">Sent</Pill>
                          ) : (
                            <Pill tone="problem">Failed</Pill>
                          )}
                        </Td>
                        <Td className="max-w-md">
                          <span className="block whitespace-pre-wrap text-xs">{entry.body}</span>
                          {entry.error && (
                            <span className="mt-1 block text-xs text-red-700 dark:text-red-400">
                              {entry.error}
                            </span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
          <Pager
            info={logPage}
            noun={{ one: "message", many: "messages" }}
            label="Message log pages"
            hrefFor={(n) => `/admin/messages?section=log&page=${n}`}
          />
        </div>
      )}
    </main>
  );
}
