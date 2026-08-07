import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTING_DEFAULTS, WHATSAPP_DISABLED_REASON } from "./settings";

// The channel switch as a contract: its default, its wording, where it is
// enforced, and — the one that protects the money — that a dead channel can
// never fail a payment.

describe("the whatsappEnabled setting", () => {
  it("defaults to TRUE — the channel is meant to work", () => {
    expect(SETTING_DEFAULTS.whatsappEnabled).toBe(true);
  });

  it("carries the exact reason the organizer should see", () => {
    expect(WHATSAPP_DISABLED_REASON).toBe(
      "WhatsApp is disabled — Meta has disabled the Business Account. Turn back on once resolved.",
    );
  });
});

describe("every WhatsApp send is gated", () => {
  const transport = readFileSync("lib/whatsapp.ts", "utf8");

  /** The body of one exported function, up to the next top-level export. */
  function body(source: string, name: string): string {
    const start = source.indexOf(`export async function ${name}(`);
    expect(start, `${name} must exist`).toBeGreaterThan(-1);
    const rest = source.slice(start + 1);
    const next = rest.indexOf("\nexport ");
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("both send functions consult the switch before anything else", () => {
    for (const fn of ["sendWhatsAppMessage", "sendWhatsAppVerification"]) {
      const b = body(transport, fn);
      expect(b, `${fn} must check the channel`).toContain("channelRefusal()");
      // Before the network call — a disabled channel must cost nothing.
      expect(b.indexOf("channelRefusal()")).toBeLessThan(b.indexOf("fetch("));
    }
  });

  it("the transport is the ONLY place that calls Twilio, so the gate cannot be bypassed", () => {
    // If a future send is added elsewhere, this catches it: no other file may
    // POST to Twilio directly.
    for (const file of [
      "lib/messaging-engine.ts",
      "app/actions/messages.ts",
      "app/actions/auth.ts",
      "app/actions/payments.ts",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} must not call Twilio directly`).not.toContain("twilio.com");
    }
  });

  it("the engine skips (never logs a FAILED row) when the channel is off", () => {
    const engine = readFileSync("lib/messaging-engine.ts", "utf8");
    const deliver = engine.slice(engine.indexOf("async function deliver("));
    const gate = deliver.indexOf(`getSetting("whatsappEnabled")`);
    expect(gate).toBeGreaterThan(-1);
    // The switch is consulted before the log row is written.
    expect(gate).toBeLessThan(deliver.indexOf("messageLog.create"));
  });
});

describe("recording a payment can never fail because of messaging", () => {
  const payments = readFileSync("app/actions/payments.ts", "utf8");
  const record = payments.slice(payments.indexOf("export async function recordPayment("));

  it("the confirmation is sent AFTER the money transaction has committed", () => {
    // Inside the transaction, a messaging throw would roll the payment back.
    const txEnd = record.indexOf("revalidatePath");
    const send = record.indexOf("sendStatement(");
    expect(txEnd).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(txEnd);
  });

  it("the send is wrapped in try/catch and the catch does not rethrow", () => {
    const send = record.indexOf("sendStatement(");
    const before = record.slice(0, send);
    expect(before.lastIndexOf("try {")).toBeGreaterThan(before.lastIndexOf("} catch"));

    const after = record.slice(send);
    const catchBlock = after.slice(after.indexOf("} catch"), after.indexOf("return { ok: true"));
    expect(catchBlock).toContain("console.error");
    expect(catchBlock).not.toContain("throw");
  });

  it("the payment still returns ok, carrying the messaging outcome", () => {
    expect(record).toContain("return { ok: true as const, data: { ...data, confirmation } }");
  });
});
