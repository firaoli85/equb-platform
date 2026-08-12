import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditEntityHref, auditEntityHint } from "./audit-links";
import { SETTING_DEFAULTS, settingChangeSummary, type SettingKey } from "./setting-defaults";

// TWO OBLIGATIONS THE AUDIT SCREEN OWED (2.23 and ADMIN_IA §8).
//
//   1. Settings changes were written with NO audit entry at all — the one
//      entity 2.23 names that had none. "Who turned PIN sign-in off, and
//      when?" had no answer, about the settings that decide who can get in.
//   2. The audit log rendered its entity as inert text, so an entry could not
//      lead to the record it changed.

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("an audit entry leads to the record it changed (§8)", () => {
  it("a person and a participation open their own screens", () => {
    expect(auditEntityHref({ entity: "Person", entityId: "p1", action: "update" })).toBe(
      "/admin/people/p1",
    );
    expect(auditEntityHref({ entity: "Participation", entityId: "x9", action: "update" })).toBe(
      "/admin/participations/x9",
    );
  });

  // THE MOST VALUABLE ENTRIES IN THIS LOG ARE ABOUT RECORDS THAT ARE GONE.
  // A link to a deleted person is a 404 dressed up as an answer.
  it("never links a deletion", () => {
    expect(auditEntityHref({ entity: "Person", entityId: "p1", action: "delete" })).toBeNull();
    expect(auditEntityHref({ entity: "Payout", entityId: "y2", action: "delete" })).toBeNull();
  });

  it("sends every draw object to the screen it was changed on", () => {
    for (const entity of ["Wheel", "Slot", "LuckyNumber", "WinnerPlan"]) {
      expect(auditEntityHref({ entity, entityId: "id", action: "update" })).toBe(
        "/admin/wheel/setup",
      );
    }
  });

  // NO LINK IS BETTER THAN A GUESS. A Week row's id is not its NUMBER, so
  // `/admin/payments?week=<uuid>` would resolve to nothing at all.
  it("leaves as text the entities with no screen of their own", () => {
    for (const entity of ["Week", "Payment", "PaymentEvent", "LedgerEntry", "Nonsense"]) {
      expect(
        auditEntityHref({ entity, entityId: "id", action: "update" }),
        `${entity} must not be guessed at`,
      ).toBeNull();
    }
  });

  it("refuses to link an entry with no id", () => {
    expect(auditEntityHref({ entity: "Person", entityId: "", action: "update" })).toBeNull();
  });

  // EVERY setting key must land on the page that holds its control — a new
  // setting with no page mapping would silently fall through to the index.
  it("every setting key opens the page its control lives on", () => {
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      const href = auditEntityHref({ entity: "Setting", entityId: key, action: "update" });
      expect(href, `${key} has no settings page`).toMatch(/^\/admin\/settings/);
    }
    expect(auditEntityHref({ entity: "Setting", entityId: "pinMaxAttempts", action: "update" })).toBe(
      "/admin/settings/access",
    );
    expect(auditEntityHref({ entity: "Setting", entityId: "closingWaitDays", action: "update" })).toBe(
      "/admin/settings/cycle",
    );
    // An unknown key — a row left behind by a renamed setting — still reaches
    // Settings rather than nothing.
    expect(auditEntityHref({ entity: "Setting", entityId: "gone", action: "update" })).toBe(
      "/admin/settings",
    );
  });

  it("every linked entity says where it goes", () => {
    for (const entity of ["Person", "Participation", "Setting", "Payout", "Cycle"]) {
      expect(auditEntityHint(entity).length, `${entity} has no hint`).toBeGreaterThan(0);
    }
  });

  it("the screen actually renders the link", () => {
    const src = read("app/admin/(protected)/audit/page.tsx");
    expect(src).toContain("auditEntityHref");
    expect(src).toContain("auditEntityHint");
    expect(src).toMatch(/<Link/);
  });
});

describe("a settings change is recorded, from what to what (2.23)", () => {
  // THE AUDIT LIVES IN setSetting, NOT IN THE NINE ACTIONS. Fixing the actions
  // would have left the tenth to whoever adds it next; there is now no way to
  // write a setting without recording it.
  it("setSetting writes the audit itself, in the same transaction", () => {
    const src = read("lib/settings.ts");
    expect(src).toContain("logAudit");
    expect(src, "the audit must share the write's transaction").toMatch(
      /prisma\.\$transaction[\s\S]{0,1200}logAudit/,
    );
    expect(src).toMatch(/entity: "Setting"/);
  });

  it("no settings action writes a Setting row behind setSetting's back", () => {
    const src = read("app/actions/settings.ts");
    expect(src, "a direct setting write would skip the audit").not.toMatch(/prisma\.setting\./);
  });

  // A summary reading `adminSessionIdleMinutes: 30 → 5` is a variable name,
  // not a record — the organizer has never seen that word written down.
  it("names the setting as the screen names it, and reads booleans as words", () => {
    expect(settingChangeSummary("pinLoginEnabled", true, false)).toBe("PIN sign-in: on → off");
    expect(settingChangeSummary("pinMaxAttempts", 5, 3)).toBe("Attempts before locking: 5 → 3");
    expect(settingChangeSummary("closingWaitDays", 7, 0)).toBe(
      "Wait before a cycle can be closed (days): 7 → 0",
    );
  });

  it("every setting has a human name — a new one cannot ship unnamed", () => {
    for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      const summary = settingChangeSummary(key, 1, 2);
      expect(summary.startsWith("undefined"), `${key} has no label`).toBe(false);
      expect(summary).toContain("1 → 2");
    }
  });

  // Two switches share one Save button, so pressing it writes both. Logging
  // the untouched one fills the trail with entries that record nothing.
  it("skips the write that changed nothing", () => {
    expect(read("lib/settings.ts")).toMatch(/JSON\.stringify\(before\) === encoded/);
  });
});
