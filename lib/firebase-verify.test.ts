import { afterEach, describe, expect, it, vi } from "vitest";
import { FIREBASE_ENV_VARS, firebaseConfigured, firebaseMissingConfig } from "./firebase-verify";

// 2.28 — a sign-in door is offered ONLY when it is actually configured. The
// login screen asks these helpers, so an unconfigured Firebase project hides
// the SMS option instead of letting a member hit a dead end.

const ALL: Record<string, string> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaTest",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "equb.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "equb",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:abc",
};

function setAll(values: Record<string, string | undefined>) {
  for (const name of FIREBASE_ENV_VARS) vi.stubEnv(name, values[name] ?? "");
}

describe("firebase configuration gate (2.28)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is configured only when EVERY variable is present", () => {
    setAll(ALL);
    expect(firebaseMissingConfig()).toEqual([]);
    expect(firebaseConfigured()).toBe(true);
  });

  it("names exactly what is missing, so the report can say it plainly", () => {
    setAll({ ...ALL, NEXT_PUBLIC_FIREBASE_API_KEY: undefined });
    expect(firebaseMissingConfig()).toEqual(["NEXT_PUBLIC_FIREBASE_API_KEY"]);
    expect(firebaseConfigured()).toBe(false);
  });

  it("a whitespace-only value counts as missing, not as configured", () => {
    setAll({ ...ALL, NEXT_PUBLIC_FIREBASE_PROJECT_ID: "   " });
    expect(firebaseMissingConfig()).toContain("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
    expect(firebaseConfigured()).toBe(false);
  });

  it("nothing configured → every variable reported, SMS hidden", () => {
    setAll({});
    expect(firebaseMissingConfig()).toEqual([...FIREBASE_ENV_VARS]);
    expect(firebaseConfigured()).toBe(false);
  });

  it("the required set is exactly the five public Firebase values", () => {
    expect([...FIREBASE_ENV_VARS]).toEqual([
      "NEXT_PUBLIC_FIREBASE_API_KEY",
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      "NEXT_PUBLIC_FIREBASE_APP_ID",
    ]);
  });
});

describe("verifyFirebaseIdToken — proof, never a bare phone number", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses when SMS is not configured on the server", async () => {
    setAll({});
    const { verifyFirebaseIdToken } = await import("./firebase-verify");
    const result = await verifyFirebaseIdToken("some-token");
    expect(result.ok).toBe(false);
  });

  it("refuses an empty token without calling Google", async () => {
    setAll(ALL);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { verifyFirebaseIdToken } = await import("./firebase-verify");
    const result = await verifyFirebaseIdToken("   ");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the phone Google actually verified", async () => {
    setAll(ALL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({ users: [{ localId: "uid-1", phoneNumber: "+12405550187" }] }),
      })),
    );
    const { verifyFirebaseIdToken } = await import("./firebase-verify");
    const result = await verifyFirebaseIdToken("good-token");
    expect(result).toEqual({ ok: true, phoneNumber: "+12405550187", uid: "uid-1" });
  });

  it("rejects a token Google refuses (expired, forged, wrong project)", async () => {
    setAll(ALL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message: "INVALID_ID_TOKEN" } }),
      })),
    );
    const { verifyFirebaseIdToken } = await import("./firebase-verify");
    const result = await verifyFirebaseIdToken("forged");
    expect(result.ok).toBe(false);
  });

  it("rejects a verified account that carries NO phone claim", async () => {
    // An account created some other way is not proof of this phone line.
    setAll(ALL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ users: [{ localId: "uid-2" }] }),
      })),
    );
    const { verifyFirebaseIdToken } = await import("./firebase-verify");
    const result = await verifyFirebaseIdToken("token-without-phone");
    expect(result.ok).toBe(false);
  });

  it("never throws when the network fails", async () => {
    setAll(ALL);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { verifyFirebaseIdToken } = await import("./firebase-verify");
    await expect(verifyFirebaseIdToken("t")).resolves.toMatchObject({ ok: false });
  });
});
