import { getMessagingOverview } from "@/app/actions/messages";
import { Alert, Card, CardHeader, Pill, Table, Td, Th, trHoverCls } from "@/components/ui/primitives";
import { ComposeSend } from "./compose-send";
import { TemplatesEditor } from "./templates-editor";

export const dynamic = "force-dynamic";

// Messaging (2.20/2.21/2.28): one place to send the manual statements, edit
// the wording, and read the log of everything that ever left. The automatic
// payment confirmation has no button here on purpose — it fires from the
// record-payment action itself.
export default async function MessagesPage() {
  const result = await getMessagingOverview();

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
  const { whatsAppMissingConfig, templates, members, log } = result.data;

  return (
    <main className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Messages</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Statements, not notifications (2.21): every message carries the member&apos;s true
          derived position at the moment it is sent. Payment confirmations send automatically
          when a payment is recorded; everything below is manual — prepared, previewed, and
          sent by you.
        </p>
      </div>

      {whatsAppMissingConfig.length > 0 && (
        <Alert kind="err">
          WhatsApp sending is not configured on this machine — missing{" "}
          {whatsAppMissingConfig.join(", ")} in .env.local. Prepares and previews work;
          sends will fail honestly until the variables are set.
        </Alert>
      )}

      <Alert kind="info">
        Meta constraint (2.28): a freeform WhatsApp message is delivered only within 24 hours
        of the member&apos;s last reply to the Equb sender. Outside that window Meta requires a
        pre-approved template. Once a template is approved by Meta, record its approved
        name/SID on the template below so the type can be mapped to it.
      </Alert>

      <ComposeSend />

      <TemplatesEditor templates={templates} members={members} />

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
    </main>
  );
}
