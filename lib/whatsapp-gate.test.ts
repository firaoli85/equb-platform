import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SETTING_DEFAULTS,
  WHATSAPP_DISABLED_REASON,
  WHATSAPP_STATEMENTS_BLOCKED_REASON,
} from "./settings";

// The channel switch as a contract: its default, its wording, where it is
// enforced, and — the one that protects the money — that a dead channel can
// never fail a payment.

describe("the whatsappEnabled setting", () => {
  it("defaults to TRUE — the channel is meant to work", () => {
    expect(SETTING_DEFAULTS.whatsappEnabled).toBe(true);
  });

  it("carries the exact reason the organizer should see", () => {
    expect(WHATSAPP_DISABLED_REASON).toBe(
      "WhatsApp is switched off — no login codes will send until it is turned back on.",
    );
  });

  // The switch no longer claims Meta disabled the account. That WAS true —
  // 15 consecutive 63112 failures, 2026-08-06 to 2026-08-07 — and then it
  // cleared: the sender reads ONLINE / HIGH, and a login code delivered and
  // was verified on 2026-08-08. A reason string that outlives its cause is a
  // lie the organizer has no way to check.
  it("no longer blames Meta for a switch the organizer controls", () => {
    expect(WHATSAPP_DISABLED_REASON).not.toContain("Meta");
    expect(WHATSAPP_DISABLED_REASON).not.toContain("Business Account");
  });

  it("states the STATEMENT block separately, in the agreed words", () => {
    expect(WHATSAPP_STATEMENTS_BLOCKED_REASON).toBe(
      "Statements need Meta-approved templates. Login codes work today; statements do not.",
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

  it("login codes consult the switch before anything else", () => {
    const b = body(transport, "sendWhatsAppVerification");
    expect(b, "the login path must check the channel").toContain("channelRefusal()");
    // Before the network call — a disabled channel must cost nothing.
    expect(b.indexOf("channelRefusal()")).toBeLessThan(b.indexOf("fetch("));
  });

  // STATEMENTS ARE NOT GATED BY THE SWITCH, and must not become so. Meta
  // accepts a freeform body only inside a 24-hour service window this account
  // has open for nobody, so there is no setting that makes the send work — and
  // a switch would let an organizer turn it on and get silent non-delivery.
  // Turning WhatsApp ON restores LOGIN CODES only.
  it("statements refuse unconditionally — no switch, no network, no Twilio", () => {
    const b = body(transport, "sendWhatsAppMessage");
    expect(b).toContain("WHATSAPP_STATEMENTS_BLOCKED_REASON");
    expect(b, "a statement must never reach the network").not.toContain("fetch(");
    expect(b, "a statement must not depend on the switch").not.toContain("channelRefusal()");
    expect(b, "and must not depend on any other setting").not.toContain("getSetting(");
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

  it("the engine stops statements BEFORE the switch — turning WhatsApp on must not start them", () => {
    const engine = readFileSync("lib/messaging-engine.ts", "utf8");
    const deliver = engine.slice(engine.indexOf("async function deliver("));
    const blocked = deliver.indexOf("STATEMENTS_DELIVERABLE");
    const gate = deliver.indexOf(`getSetting("whatsappEnabled")`);
    expect(blocked).toBeGreaterThan(-1);
    expect(blocked, "the template block must be checked first").toBeLessThan(gate);
    expect(blocked).toBeLessThan(deliver.indexOf("messageLog.create"));
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
