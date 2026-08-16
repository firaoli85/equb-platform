import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { paymentOutcomeLine } from "./payment-outcome-line";

/** CRLF-normalised — this repo checks out CRLF and stores LF. */
const read = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

// A RECORD THAT CANNOT BE REACHED IS INDISTINGUISHABLE FROM A LOST ONE.
//
// On 16 August 2026 a part-payment-completed message was reported as "no
// message was sent". It had been queued correctly, twice, with the right body
// and the right reason. Everything worked except the part where the organizer
// could find out: the queue renders on /admin/messages, payments are recorded
// on /admin/payments, and nothing connected the two.
//
// Two surfaces close it — a count in the rail so waiting work announces itself
// from anywhere, and the outcome on the panel that produced it. Both read
// records that already existed; neither sends anything.

describe("THE SENTENCE — what happened to their message", () => {
  it("a delivered message says delivered", () => {
    expect(paymentOutcomeLine({ status: "SENT", body: "x" })).toEqual({
      kind: "plain",
      text: "Their message was delivered.",
    });
  });

  it("ACCEPTED does NOT claim delivery", () => {
    // THE DISTINCTION THAT COST REAL TRUST. 75 log rows sat at ACCEPTED while
    // Twilio showed most delivered and one dropped by Meta. Reporting "Sent"
    // for a handover would put that same conflation in front of the organizer
    // at the moment he decides whether the member has been told.
    const line = paymentOutcomeLine({ status: "ACCEPTED", body: "x" });
    expect(line?.text).toContain("Delivery is not confirmed yet");
    expect(line?.text).not.toContain("delivered.");
    expect(line?.kind).toBe("plain");
  });

  it("a queued message earns the link, and says who is waiting on whom", () => {
    const line = paymentOutcomeLine({ status: "QUEUED", body: "x" });
    expect(line).toEqual({
      kind: "queued",
      text: "Their message is waiting for you to send it.",
    });
  });

  it("a failure carries the provider's own reason", () => {
    const line = paymentOutcomeLine({ status: "FAILED", body: "x", error: "63049 undelivered" });
    expect(line?.kind).toBe("bad");
    expect(line?.text).toContain("63049 undelivered");
  });

  it("a skip is neither success nor failure, and the reason is the content", () => {
    // "marked no messages", "no phone number on file" and "nothing to confirm"
    // are different facts and he acts on each differently.
    const line = paymentOutcomeLine({ status: "SKIPPED", reason: "No phone number on file." });
    expect(line?.kind).toBe("plain");
    expect(line?.text).toBe("No message was sent: No phone number on file.");
  });

  it("null — the messaging path threw — is still said out loud", () => {
    // recordPayment survives a messaging throw so the money is never lost. That
    // is exactly when nothing is known about the message, and silence here
    // would be the failure this whole surface exists to end.
    const line = paymentOutcomeLine(null);
    expect(line?.kind).toBe("bad");
    expect(line?.text).toContain("could not be prepared");
    expect(line?.text).toContain("payment is recorded");
  });

  it("every outcome produces a line — there is no case that renders nothing", () => {
    const outcomes = [
      { status: "SENT", body: "" },
      { status: "ACCEPTED", body: "" },
      { status: "QUEUED", body: "" },
      { status: "FAILED", body: "", error: "e" },
      { status: "SKIPPED", reason: "r" },
      null,
    ] as const;
    for (const o of outcomes) {
      const line = paymentOutcomeLine(o);
      expect(line, JSON.stringify(o)).not.toBeNull();
      expect(line!.text.length).toBeGreaterThan(10);
    }
  });
});

describe("THE PANEL SHOWS IT, where the payment was recorded", () => {
  const entry = read("components/admin/payment-entry.tsx");

  it("the outcome recordPayment already returned is finally rendered", () => {
    // It was returned and discarded from the day the routing landed.
    expect(entry).toContain("paymentOutcomeLine(result.data.confirmation)");
    expect(entry).toContain('data-testid="message-outcome"');
  });

  it("a queued outcome links to where he acts on it", () => {
    const block = entry.slice(entry.indexOf('data-testid="message-outcome"'));
    expect(block).toContain('href="/admin/messages"');
    expect(block).toContain("Review it on Messages");
  });

  it("nothing renders before a payment is recorded", () => {
    // The line is one more thing on a dense screen; it earns its space only
    // once there is an outcome to report.
    expect(entry).toContain("const [messageOutcome, setMessageOutcome] = useState<OutcomeLine | null>(null)");
    expect(entry).toContain("{messageOutcome && (");
  });
});

describe("THE RAIL CARRIES THE COUNT, from anywhere in the admin", () => {
  const sidebar = read("components/admin/admin-sidebar.tsx");
  const layout = read("app/admin/(protected)/layout.tsx");

  it("the badge sits on the Messages row and nowhere else", () => {
    expect(sidebar).toContain('link.href === "/admin/messages" && queuedCount > 0');
    expect(sidebar).toContain('data-testid="queued-badge"');
  });

  it("zero renders NOTHING — a permanent 0 is furniture", () => {
    expect(sidebar).toContain("queuedCount > 0 &&");
    // Defaulted, so a caller that forgets it gets no badge rather than NaN.
    expect(sidebar).toContain("queuedCount = 0,");
  });

  it("a bare number is not left for a screen reader to interpret", () => {
    expect(sidebar).toContain("waiting to be sent");
    expect(sidebar).toContain("sr-only");
  });

  it("the layout supplies it and cannot take the admin down doing so", () => {
    // It runs on EVERY admin page. A count that cannot be read must not blank
    // the whole shell — the queue is the thing being made visible, not a new
    // way to lose the screen.
    expect(layout).toContain("countQueuedMessages()");
    expect(layout).toContain("<AdminSidebar queuedCount={queuedCount} />");
    const guarded = layout.slice(layout.indexOf("let queuedCount = 0;"), layout.indexOf("return ("));
    expect(guarded).toContain("try {");
    expect(guarded).toContain("catch");
    expect(guarded).toContain("console.error");
  });

  it("the count is a COUNT — the rail is on screen during a screen share", () => {
    const engine = read("lib/messaging-engine.ts");
    const fn = engine.slice(
      engine.indexOf("export async function countQueuedMessages()"),
      engine.indexOf("/** Everything waiting, oldest first"),
    );
    expect(fn).toContain("prisma.queuedMessage.count()");
    // 2.4: a number is the most the rail may ever say. No bodies, no names.
    expect(fn).not.toContain("findMany");
    expect(fn).not.toContain("include");
  });
});
