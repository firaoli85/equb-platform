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
      "WhatsApp is switched off — no codes or statements will send until it is turned back on.",
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

  // THE BLOCKED-REASON STRING IS GONE, AND MUST STAY GONE (§5.15, earned
  // twice). "Statements need Meta-approved templates, and none are
  // registered" was true until 7 August 2026 and false after it, and the
  // constant kept saying it while eleven statements delivered. A type with no
  // approved template refuses ITSELF from the registry now — there is no
  // stored sentence left to outlive its cause, and re-adding one fails here.
  it("the statements-blocked reason string is deleted, not parked", () => {
    for (const file of ["lib/setting-defaults.ts", "lib/messaging-engine.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} re-declares the retired flag or reason`).not.toMatch(
        /export const (WHATSAPP_STATEMENTS_BLOCKED_REASON|STATEMENTS_DELIVERABLE)/,
      );
    }
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

  // STATEMENTS NOW SEND. This guard used to assert sendWhatsAppMessage
  // contained no fetch( at all, which this build makes false BY DESIGN. The
  // guard was not deleted and the code was not bent to satisfy it — it is
  // re-pointed at the invariant that actually protects members: a statement
  // may reach Twilio, but ONLY behind the switch and ONLY as an approved
  // template.
  it("a statement consults the switch BEFORE the network", () => {
    const b = body(transport, "sendWhatsAppMessage");
    expect(b, "the statement path must check the channel").toContain("channelRefusal()");
    expect(b.indexOf("channelRefusal()")).toBeLessThan(b.indexOf("fetch("));
  });

  it("a send is never attempted without a ContentSid", () => {
    const b = body(transport, "sendWhatsAppMessage");
    // The refusal is checked before the network call…
    expect(b).toContain("contentSid.trim()");
    expect(b.indexOf("contentSid.trim()")).toBeLessThan(b.indexOf("fetch("));
    // …and ContentSid is actually on the request.
    expect(b).toContain("ContentSid:");
    expect(b).toContain("ContentVariables:");
  });

  it("a statement is never sent as freeform Body, and never via a service SID", () => {
    const b = body(transport, "sendWhatsAppMessage");
    // A Body makes it freeform, which Meta refuses outside a 24-hour window
    // this account has open for nobody.
    expect(b, "a Body would make this a freeform send").not.toMatch(/\bBody:\s/);
    expect(b).not.toContain("MessagingServiceSid");
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

  // WHAT REPLACED THE GLOBAL BLOCK: the registry, per key. A type with no
  // ContentSid — LOCKOUT_NOTICE forever, WHATSAPP_WELCOME until Meta approves
  // it — refuses ITSELF inside deliver(), before anything renders toward
  // Twilio. Without this check a keyless send would carry Twilio's approval
  // SAMPLES and deliver invented figures to real members, which is the exact
  // failure the deleted flag existed to prevent — now enforced structurally
  // instead of by a constant somebody must remember to flip.
  it("a type with no approved template refuses itself, before anything is sent", () => {
    const engine = readFileSync("lib/messaging-engine.ts", "utf8");
    const deliver = engine.slice(engine.indexOf("async function deliver("));
    const registryGate = deliver.indexOf("isApprovedTemplateKey(");
    expect(registryGate).toBeGreaterThan(-1);
    // Checked before the Twilio call leaves and before the log row claims
    // anything happened.
    expect(registryGate).toBeLessThan(deliver.indexOf("sendWhatsAppMessage("));
    expect(registryGate).toBeLessThan(deliver.indexOf("messageLog.create"));
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
