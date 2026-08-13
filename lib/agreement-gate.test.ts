import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AGREEMENT_V1_BODY } from "./agreement";

// GUARD — THE SIGNING GATE, AND THE SEVEN WAYS IT ROTS.
//
// lib/agreement.test.ts already proves the DOCUMENT: whose figures it carries,
// what the hash covers, and that `agreementOutstanding` answers the ruling.
// None of that is the gate. The gate is a handful of structural facts spread
// across a layout, a page, a proxy, an action and a migration, and every one of
// them is the kind that survives a refactor by accident and dies by accident:
//
//   the layout wraps every /me route          — a route group moves one out
//   a FAILED check redirects too              — "simplifying" one `||` away
//   the signature action returns its errors    — copied from `recordSignIn`
//   nothing claims a MAC address               — a column somebody adds back
//   the hash covers what was displayed         — text re-typed into the JSX
//   the server re-checks the hash              — a `!==` deleted as redundant
//   versions and signatures accumulate         — a `create` turned `upsert`
//
// None is unit-testable. There is no request scope in a test, no database, and
// no way to exercise "a member typed /me/history into the bar". They are
// properties of the SOURCE, so they are scanned — the same shape as
// lib/refusal-placement.test.ts and lib/query-bounds.test.ts.
//
// EVERY ASSERTION BELOW NAMES THE DEFECT IT WOULD CATCH. A guard whose failure
// message does not tell you what was broken is a guard that gets deleted.

const ROOT = join(import.meta.dirname, "..");
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");
const read = (p: string) => readFileSync(join(ROOT, ...p.split("/")), "utf8");

// The migration is FOUND, never hardcoded. A renamed folder would otherwise
// make every assertion about the trigger and the nullable column silently
// vanish — the scan would read a file that is not there, and `readFileSync`
// throwing is the good case. This is the floor for that whole section.
const MIGRATION_DIR = (() => {
  const found = readdirSync(join(ROOT, "prisma", "migrations")).filter((d) =>
    d.endsWith("_member_agreement"),
  );
  expect(found, "exactly one member-agreement migration must exist").toHaveLength(1);
  return found[0];
})();

const LAYOUT = read("app/me/layout.tsx");
const SIGNER = read("app/agreement/agreement-signer.tsx");
const SIGN_PAGE = read("app/agreement/page.tsx");
const ACTIONS = read("app/actions/agreement.ts");
const AGREEMENT_LIB = read("lib/agreement.ts");
const PROXY_ENTRY = read("proxy.ts");
const PROXY = read("lib/supabase/proxy.ts");
const SCHEMA = read("prisma/schema.prisma");
const MIGRATION = read(`prisma/migrations/${MIGRATION_DIR}/migration.sql`);
const SESSION_RECORD = read("lib/session-record.ts");

// ————————————————————————————————————————————————————————————————————————
// SOURCE TOOLS. Shared with lib/save-feedback.test.ts in shape and in reason.
// ————————————————————————————————————————————————————————————————————————

/**
 * The same source with comments removed.
 *
 * REQUIRED, not tidiness — and the MAC-address scan is the reason. Four files
 * document the absence of that column BY NAMING IT: schema.prisma says "There
 * is no MAC address column", the migration says "there is deliberately NO mac
 * address column", lib/agreement.ts and agreement-signer.tsx both say a web
 * page cannot read one. A raw text scan reports all four as violations of the
 * rule they are explaining, and the only way to make it pass is to delete the
 * explanations. Stripping keeps the guard about the CODE.
 *
 * String-aware, and comment-start-wins: `"https://x"` is not a comment, and an
 * apostrophe inside `// don't` is never examined because the `//` is reached
 * first, left to right.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The same, for SQL: a `--` run to end of line, a block comment, `'…'` strings. */
function stripSqlComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (src[i] === "'") {
      out += src[i];
      i++;
      while (i < src.length) {
        out += src[i];
        if (src[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

/** The text of a block, given the index just past its opening brace. */
function braceBody(src: string, start: number): string {
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return src.slice(start, i - 1);
}

/** One exported action's span in the file, up to the next top-level export. */
function actionRange(name: string): { start: number; end: number } {
  const start = ACTIONS.indexOf(`export async function ${name}(`);
  expect(start, `${name} must exist in app/actions/agreement.ts`).toBeGreaterThan(-1);
  const next = ACTIONS.indexOf("\nexport ", start + 1);
  return { start, end: next === -1 ? ACTIONS.length : next };
}

/** …and its text. */
function actionBody(name: string): string {
  const { start, end } = actionRange(name);
  return ACTIONS.slice(start, end);
}

// ————————————————————————————————————————————————————————————————————————
// 1. THE GATE CANNOT BE WALKED AROUND.
// ————————————————————————————————————————————————————————————————————————

/**
 * Every routable file in app/, with the URL it actually answers on.
 *
 * ROUTE GROUPS AND PARALLEL SLOTS ARE ERASED FROM THE PATH, which is the entire
 * point of computing this rather than globbing `app/me/**`. `app/(portal)/me/
 * history/page.tsx` serves /me/history and is NOT inside app/me/layout.tsx — a
 * single pair of parentheses moves a page out from behind the gate while every
 * URL in the app stays identical and every test that globs app/me still passes.
 */
function routeFiles(): { file: string; url: string }[] {
  const out: { file: string; url: string }[] = [];
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        const hidden = /^\(.*\)$/.test(entry) || entry.startsWith("@");
        walk(full, hidden ? url : `${url}/${entry}`);
        continue;
      }
      if (/^(page|route|default)\.(t|j)sx?$/.test(entry)) {
        out.push({ file: rel(full), url: url === "" ? "/" : url });
      }
    }
  };
  walk(join(ROOT, "app"), "");
  return out;
}

const ROUTES = routeFiles();

describe("GUARD — the signing gate cannot be walked around", () => {
  // A BROKEN WALK MUST NOT PASS. Every `toEqual([])` below is satisfied by an
  // empty scan, so this is what turns "nothing was found" into "nothing was
  // found because something was looked at".
  it("the route walk sees the whole app", () => {
    expect(ROUTES.length).toBeGreaterThan(30);
    // Through a route group with parentheses AND a dynamic segment — the two
    // path shapes a naive glob drops on Windows.
    expect(ROUTES.map((r) => r.url)).toContain("/admin/people/[id]");
    expect(ROUTES.map((r) => r.url)).toContain("/me/history");
  });

  // THE GATE ITSELF. Without this call the layout is chrome and nothing else.
  it("the member layout asks whether a signature is owed, and awaits it", () => {
    expect(LAYOUT, "the layout does not import the gate").toContain(
      'from "@/app/actions/agreement"',
    );
    expect(LAYOUT, "the layout does not call the gate").toMatch(/await\s+getMyAgreement\(\)/);
    expect(LAYOUT, "the gate does not send anyone anywhere").toMatch(
      /redirect\(\s*["']\/agreement["']\s*\)/,
    );
  });

  // A CLIENT LAYOUT CANNOT AWAIT A SERVER ACTION BEFORE PAINTING. Marking this
  // file "use client" would move the check into the browser, after the portal
  // has already rendered — which is not a gate, it is a suggestion.
  it("the member layout is a server component", () => {
    expect(LAYOUT).not.toMatch(/^\s*["']use client["']/m);
  });

  // THE REDIRECT RUNS BEFORE ANYTHING IS RENDERED. Next's `redirect()` works by
  // THROWING, so a `try` anywhere around it swallows NEXT_REDIRECT and the
  // portal renders for a member who owes a signature — a bypass that leaves no
  // error and no log line. There is no legitimate reason for this file to catch.
  it("nothing in the layout can swallow the redirect", () => {
    expect(stripComments(LAYOUT), "a try/catch here eats NEXT_REDIRECT").not.toMatch(
      /\btry\s*\{/,
    );
    const gate = LAYOUT.indexOf("getMyAgreement()");
    const shell = LAYOUT.indexOf("<MemberShell>");
    expect(gate, "the gate runs after the shell is returned").toBeLessThan(shell);
  });

  // A CACHED LAYOUT IS NO LAYOUT. `force-static` or a `revalidate` would let
  // one member's rendered shell answer another member's request without the
  // gate running at all.
  it("the member layout is never statically cached", () => {
    expect(LAYOUT).not.toMatch(/force-static/);
    expect(LAYOUT).not.toMatch(/export\s+const\s+revalidate/);
    // THE TWO ABOVE PASS ON A LAYOUT WITH THE GATE DELETED. They assert the
    // absence of strings this file has never contained, which is no assertion
    // at all — a guard has to fail on the defect it is named for.
    //
    // What actually makes the layout uncacheable is that it AWAITS a
    // per-member read on every render, so that is the property pinned.
    expect(LAYOUT, "the layout is no longer async — nothing can be awaited in it").toMatch(
      /export default async function/,
    );
    expect(LAYOUT, "the layout no longer awaits the gate").toMatch(/await getMyAgreement\(\)/);
  });

  // EVERY /me URL IS BEHIND THAT ONE FILE. Two ways out, both scanned:
  //
  //   a route group above `me` (see routeFiles) puts a page at /me/x that no
  //   layout under app/me wraps;
  //
  //   a ROUTE HANDLER under /me runs NO layout at all, ever — `app/me/data/
  //   route.ts` would answer with a member's figures and never touch the gate.
  //   This is the cheaper bypass of the two and the easier one to add without
  //   noticing, because it looks like an ordinary API file.
  it("every /me route is a page under app/me, wrapped by the gate", () => {
    const under = ROUTES.filter((r) => r.url === "/me" || r.url.startsWith("/me/"));
    expect(under.length, "the /me routes vanished from the scan").toBeGreaterThanOrEqual(7);
    const escaped = under.filter(
      (r) => !r.file.startsWith("app/me/") || !r.file.endsWith("/page.tsx"),
    );
    expect(
      escaped.map((r) => `${r.file} → ${r.url}`),
      "answers on a /me URL without passing app/me/layout.tsx:\n  " +
        escaped.map((r) => `${r.file} → ${r.url}`).join("\n  "),
    ).toEqual([]);
    // NON-VACUITY, AND IT USED TO BE VACUOUS ITSELF. This read
    // `r.file === "app/me/layout.tsx" || r.url === "/me"` — but `routeFiles()`
    // only collects page/route/default, so a layout is never in ROUTES and the
    // first half could not be true under any circumstances. It quietly
    // degraded to "some page answers on /me", which is exactly NOT the thing
    // it was captioned as guarding. Both halves are now asserted separately,
    // each against the thing that can actually hold it.
    expect(ROUTES.some((r) => r.url === "/me")).toBe(true);
    expect(existsSync(join(ROOT, "app/me/layout.tsx")), "the gate layout is gone").toBe(true);
  });

  // THE SIGNING SCREEN IS OUTSIDE /me, AND HAS TO BE. Move it under the layout
  // and the gate redirects it to itself: an infinite loop that presents as
  // "the portal will not load" with no error anywhere.
  it("the signing screen is not itself gated", () => {
    const signing = ROUTES.filter((r) => r.url === "/agreement" || r.url.startsWith("/agreement/"));
    expect(signing.map((r) => r.file)).toEqual(["app/agreement/page.tsx"]);
    expect(signing[0].url, "/agreement moved under /me — it now redirects to itself").toBe(
      "/agreement",
    );
  });

  // AND IT IS NOT AN OPEN DOOR EITHER. The layout is the SIGNING gate; the
  // proxy is the SIGNED-IN gate, and /agreement sits outside the layout so it
  // needs naming in the proxy explicitly. Without the second clause here,
  // /agreement is the one member screen reachable while signed out.
  it("the proxy requires a session for /agreement as well as /me", () => {
    // `[\s\S]` rather than the `s` flag: this project's TS target predates
    // dotAll, and `tsc` refuses the flag outright.
    const guard = /if\s*\(\(([\s\S]+?)\)\s*&&\s*!claims\)/.exec(stripComments(PROXY));
    expect(guard, "the member sign-in check is gone from the proxy").not.toBeNull();
    expect(guard![1]).toContain('"/me"');
    expect(guard![1], "/agreement is reachable signed out").toContain('"/agreement"');
  });

  // …and the proxy actually RUNS on those paths. A matcher narrowed to
  // /admin/:path* would leave both checks above in place and never execute one.
  it("the proxy matcher covers both member paths", () => {
    const literal = /matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*"((?:[^"\\]|\\.)*)"/.exec(PROXY_ENTRY);
    expect(literal, "no matcher literal found in proxy.ts").not.toBeNull();
    const matcher = new RegExp(`^${JSON.parse(`"${literal![1]}"`)}$`);
    expect(matcher.test("/me")).toBe(true);
    expect(matcher.test("/me/collections")).toBe(true);
    expect(matcher.test("/agreement")).toBe(true);
    // Non-vacuity for the matcher itself: it must still exclude SOMETHING, or
    // a regex of `.*` would pass the three lines above while meaning nothing.
    expect(matcher.test("/favicon.ico")).toBe(false);
  });

  // THE LAST BYPASS, AND THE SUBTLEST. After signing, the screen must leave by
  // a FULL DOCUMENT LOAD. `router.push("/me")` is a soft navigation that the
  // client router may answer from its cache — the layout is a server component,
  // so a cached shell means the gate never runs on the way in. It would look
  // like it worked, every time, until the one time the cache was warm.
  it("the signer leaves by a full load, never a client transition", () => {
    const code = stripComments(SIGNER);
    expect(code).toMatch(/window\.location\.assign\(\s*["']\/me["']\s*\)/);
    expect(code, "a soft navigation can be served from the router cache").not.toMatch(
      /router\.(push|replace|refresh)\(/,
    );
  });

  // And it must not leave at all on a refusal.
  it("the signer only navigates after the server said yes", () => {
    const code = stripComments(SIGNER);
    const refused = code.indexOf("!result.ok");
    const leave = code.indexOf("window.location.assign");
    expect(refused, "the signer never checks whether the signature was taken").toBeGreaterThan(-1);
    expect(refused, "it navigates before reading the result").toBeLessThan(leave);
  });
});

// ————————————————————————————————————————————————————————————————————————
// 2. AN ERROR MUST NOT OPEN THE PORTAL.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — a failed check keeps the portal shut", () => {
  /** Every `if (…) redirect("/agreement")` condition in the layout, joined. */
  const conditions = [
    ...LAYOUT.matchAll(/if\s*\(([^)]+)\)\s*redirect\(\s*["']\/agreement["']\s*\)/g),
  ].map((m) => m[1]);

  it("the layout redirects on a failed check as well as an owed one", () => {
    expect(conditions.length, "nothing redirects to /agreement at all").toBeGreaterThan(0);
    const all = conditions.join(" || ");
    // THE DEFECT THIS EXISTS FOR. `!owed.ok || owed.data !== null` reads like
    // belt and braces, and the obvious tidy-up is `owed.ok && owed.data !==
    // null` — "only redirect when we actually know something is owed". That
    // sentence is the bug: on a database blip `getMyAgreement` returns
    // `{ ok: false }`, the condition is false, and the portal renders for a
    // member who owes a signature. The same hole opens if the result is read
    // through a `data ?? null` default. Both lose the `!ok` disjunct, so the
    // disjunct is what is pinned: a FAILED check must be one of the stated
    // reasons this redirects.
    expect(all, "a failed check no longer sends anyone to /agreement").toMatch(/!\s*\w+\.ok\b/);
    expect(all, "the owed case is gone").toMatch(/\.data\s*!==\s*null/);
    expect(all, "the two reasons must be OR'd — an AND opens the portal on error").toContain("||");
  });

  // THE SAME RULE ON THE OTHER SIDE OF THE DOOR. /agreement sends a member to
  // /me when nothing is owed. That shortcut must be reachable only from a
  // SUCCESSFUL check — `result.data === null` alone is true for a failure shape
  // too, and would bounce a member whose check just failed straight into the
  // portal the layout is trying to keep shut.
  it("the signing screen only forwards to /me on a successful check", () => {
    const forward = /if\s*\(([^)]+)\)\s*redirect\(\s*["']\/me["']\s*\)/.exec(SIGN_PAGE);
    expect(forward, "the signing screen never forwards a member with nothing to sign").not.toBeNull();
    expect(forward![1], "a failed check forwards into the portal").toMatch(/\w+\.ok\s*&&/);
    expect(forward![1]).toMatch(/\.data\s*===\s*null/);
  });

  // A failure renders the reason and STOPS. If this page ever grew a "continue
  // anyway" link, the layout's care would be worth nothing.
  it("a failure renders the reason and offers no way onward", () => {
    expect(SIGN_PAGE).toMatch(/\{result\.error\}/);
    // BOTH FILES. This scanned only page.tsx — but the screen the member
    // actually reads and presses a button on is agreement-signer.tsx, and a
    // link out of THAT is the way past the gate. Half the surface was pinned.
    for (const [name, src] of [
      ["app/agreement/page.tsx", SIGN_PAGE],
      ["app/agreement/agreement-signer.tsx", SIGNER],
    ] as const) {
      expect(stripComments(src), `a link off ${name} is a way past the gate`).not.toMatch(
        /<Link\b|<a\s+href/,
      );
    }
  });

  // The signing screen must be rendered per request. A statically rendered
  // agreement is one member's own figures served to whoever asks next.
  it("the signing screen is rendered per request", () => {
    expect(SIGN_PAGE).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  });
});

// ————————————————————————————————————————————————————————————————————————
// 3. THE SIGNATURE RECORD MUST NOT SWALLOW ITS ERRORS.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — a signature that fails to record says so", () => {
  /** Every `catch (…) { … }` body in the agreement actions. */
  const catches = [...ACTIONS.matchAll(/catch\s*(?:\([^)]*\)\s*)?\{/g)].map((m) => ({
    index: m.index,
    body: braceBody(ACTIONS, m.index + m[0].length),
  }));

  it("finds a real set of catch blocks", () => {
    expect(catches.length, "the catches vanished — this scan measures nothing").toBeGreaterThanOrEqual(5);
  });

  // THE MODEL THIS MUST NOT COPY, asserted so the contrast is real rather than
  // remembered. lib/session-record.ts swallows EVERYTHING on purpose: a
  // recording feature that can lock 26 people out of their own portal is worse
  // than no recording, so `recordSignIn` returns `failed` and the login stands.
  it("recordSignIn still swallows, deliberately — the contrast is the point", () => {
    const start = SESSION_RECORD.indexOf("export async function recordSignIn(");
    expect(start).toBeGreaterThan(-1);
    const body = SESSION_RECORD.slice(start, SESSION_RECORD.indexOf("\nexport ", start));
    const swallow = /catch\s*\([^)]*\)\s*\{/.exec(body)!;
    expect(braceBody(body, swallow.index + swallow[0].length)).toMatch(/return\s+failed;/);
  });

  // AND THE ONE THAT MUST NOT. A signature that fails to write and reports
  // success opens the portal with nothing behind it: the member is through the
  // gate, `agreementRequiredAt` still stands, and there is no row saying what
  // they agreed to. Planting the defect looks exactly like the file above —
  // `catch { return { ok: true } }`, or a bare `catch {}` that falls through to
  // the success return below it.
  it("signMyAgreement returns its failure instead of hiding it", () => {
    const span = actionRange("signMyAgreement");
    const failure = catches.find((c) => c.index >= span.start && c.index < span.end);
    expect(failure, "signMyAgreement no longer catches at all").toBeDefined();
    expect(failure!.body, "the catch reports success").not.toMatch(/ok:\s*true/);
    expect(failure!.body, "the catch swallows — the caller cannot tell").toMatch(/ok:\s*false/);
    // The wording matters as much as the shape. "Could not load" invites a
    // retry; the member has to know NOTHING WAS SIGNED.
    expect(failure!.body, "the refusal does not say the signature was lost").toMatch(
      /NOT recorded/,
    );
  });

  it("no agreement action swallows a failure into a success", () => {
    const offenders = catches
      .filter((c) => !/ok:\s*false/.test(c.body))
      .map((c) => `app/actions/agreement.ts:${ACTIONS.slice(0, c.index).split("\n").length}`);
    expect(
      offenders,
      "a catch that does not refuse — the caller reads it as success:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  // SUCCESS IS REPORTED ONCE, AND ONLY AFTER THE ROW EXISTS. `ok: true` before
  // the awaited write — or a floating promise instead of an await — is the same
  // defect wearing a different shape: the portal opens, the row never lands.
  it("success is reported only after the write has completed", () => {
    const body = stripComments(actionBody("signMyAgreement"));
    const successes = [...body.matchAll(/ok:\s*true/g)];
    expect(successes, "more than one success path — each needs its own proof").toHaveLength(1);
    const write = body.indexOf("await prisma.$transaction");
    expect(write, "the signature is no longer written inside an awaited transaction").toBeGreaterThan(-1);
    expect(successes[0].index, "success is returned before the row is written").toBeGreaterThan(write);
  });

  // The audit entry rides in the SAME transaction as the row. Outside it, a
  // failing log leaves a signature with no trail, and a failing signature
  // leaves a trail for a signature that does not exist.
  it("the signature and its audit entry stand or fall together", () => {
    const body = actionBody("signMyAgreement");
    const tx = /await prisma\.\$transaction\(async \(tx\) => \{/.exec(body);
    expect(tx, "the transaction is gone").not.toBeNull();
    const inside = braceBody(body, tx!.index + tx![0].length);
    expect(inside).toMatch(/tx\.agreementSignature\.create\(/);
    expect(inside, "the audit entry is written outside the transaction").toMatch(/logAudit\(tx,/);
  });
});

// ————————————————————————————————————————————————————————————————————————
// 4. NO MAC ADDRESS, ANYWHERE.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — nothing claims a MAC address", () => {
  // A web page cannot read a MAC address on any browser, on any platform. A
  // column that can never be filled honestly, or a notice that says it is being
  // recorded, is a claim the record cannot support — and it is the kind of
  // claim that reads as reassuring and gets added back by someone who has not
  // checked. Planting the defect: a `macAddress String?` line in the model, or
  // "…your MAC address…" in SIGNATURE_NOTICE.
  // Each surface carries an ANCHOR: a token that is unquestionably code, not
  // comment. A stripper that swallowed a file — or half of one, which is how a
  // string-unaware stripper fails — would leave every scan below passing on an
  // empty string, and the length check alone would not notice half a file.
  const SURFACES: { name: string; code: string; anchor: string }[] = [
    { name: "lib/agreement.ts", code: stripComments(AGREEMENT_LIB), anchor: "SIGNATURE_NOTICE" },
    { name: "app/actions/agreement.ts", code: stripComments(ACTIONS), anchor: "signMyAgreement" },
    {
      name: "app/agreement/agreement-signer.tsx",
      code: stripComments(SIGNER),
      anchor: "agreement.clauses",
    },
    { name: "app/agreement/page.tsx", code: stripComments(SIGN_PAGE), anchor: "AgreementSigner" },
    { name: "app/me/layout.tsx", code: stripComments(LAYOUT), anchor: "getMyAgreement" },
    { name: "prisma/schema.prisma", code: stripComments(SCHEMA), anchor: "model AgreementSignature" },
    {
      name: `prisma/migrations/${MIGRATION_DIR}/migration.sql`,
      code: stripSqlComments(MIGRATION),
      anchor: "agreement_signatures",
    },
  ];

  const CLAIM = /mac[\s_-]*addr/i;

  it("scans a real set of surfaces", () => {
    expect(SURFACES).toHaveLength(7);
    for (const s of SURFACES) {
      expect(s.code.length, `${s.name} came back empty`).toBeGreaterThan(200);
      expect(s.code, `${s.name}: the stripper ate real code`).toContain(s.anchor);
    }
  });

  it("no schema, action, screen or migration mentions one", () => {
    const offenders = SURFACES.filter((s) => CLAIM.test(s.code)).map((s) => s.name);
    expect(
      offenders,
      "claims a MAC address — a web page cannot read one:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  // The notice is the sentence a member actually reads, so it gets its own
  // assertion rather than being covered incidentally by the file scan.
  it("the notice names only what a request can honestly give", () => {
    const notice = /SIGNATURE_NOTICE\s*=\s*([\s\S]*?);\n/.exec(AGREEMENT_LIB);
    expect(notice, "SIGNATURE_NOTICE is gone").not.toBeNull();
    expect(CLAIM.test(notice![1])).toBe(false);
    expect(notice![1]).toMatch(/IP address/);
    expect(notice![1]).toMatch(/device and browser/);
  });

  // NO LONGER PINNED: that the COMMENTS still say why the column is absent.
  //
  // That assertion required schema.prisma and agreement-signer.tsx to CONTAIN
  // the string "mac addr" — pinning explanatory prose rather than behaviour,
  // inverting this file's own rule, and failing the suite whenever somebody
  // reworded a comment while the code was untouched. A comment is not a
  // guarantee, and a guard that protects one is protecting the wrong thing.
  //
  // The honest version of the same concern runs the other way: not "is the
  // explanation still there" but "is anything PROMISED that cannot be stored".
  it("the notice promises only what the record can hold", () => {
    const notice = /SIGNATURE_NOTICE\s*=\s*([\s\S]*?);\n/.exec(AGREEMENT_LIB)![1];
    const signature = SCHEMA.slice(
      SCHEMA.indexOf("model AgreementSignature"),
      SCHEMA.indexOf("model AgreementSignature") + 3000,
    );
    for (const [promise, column] of [
      ["date and time", "signedAt"],
      ["IP address", "ip"],
      ["device and browser", "browser"],
    ] as const) {
      expect(notice, `the notice no longer mentions ${promise}`).toContain(promise);
      expect(signature, `"${promise}" is promised with no ${column} column`).toContain(column);
    }
  });
});

// ————————————————————————————————————————————————————————————————————————
// 5. THE HASH IS TAKEN OVER WHAT IS DISPLAYED.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — the hash covers exactly what was on the screen", () => {
  const signerCode = stripComments(SIGNER);

  // ONE STRING, TWO USES. `documentText` is rendered into clauses AND hashed.
  // Split those — hash `renderAgreement(...)` in one place and build the
  // clauses from a second call — and the two can drift by a space, which is
  // enough to make the stored hash prove a document nobody was shown.
  it("the clauses and the hash come from the same rendered string", () => {
    const body = stripComments(actionBody("getMyAgreement"));
    const renders = [...body.matchAll(/renderAgreement\(/g)];
    expect(renders, "the document is rendered more than once — the two can drift").toHaveLength(1);
    expect(body).toMatch(/const documentText = renderAgreement\(/);
    expect(body, "the clauses are built from something other than the hashed text").toMatch(
      /agreementClauses\(documentText\)/,
    );
    expect(body, "the hash is taken over something other than the displayed text").toMatch(
      /agreementHash\(documentText\)/,
    );
  });

  // THE SCREEN RENDERS THOSE CLAUSES AND NOTHING IT MADE ITSELF.
  it("the signing screen renders the clauses it was given", () => {
    expect(signerCode).toMatch(/agreement\.clauses\.map\(/);
    expect(signerCode).toMatch(/\{clause\.heading\}/);
    expect(signerCode).toMatch(/\{clause\.body\}/);
  });

  it("the screen never re-assembles a document of its own", () => {
    for (const forbidden of [
      "renderAgreement",
      "agreementClauses",
      "agreementHash",
      "AGREEMENT_V1_BODY",
      "createHash",
    ]) {
      expect(signerCode, `the screen builds its own text with ${forbidden}`).not.toContain(
        forbidden,
      );
    }
    // The one thing it may take from the library is the notice.
    const imports = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/agreement["']/.exec(signerCode);
    expect(imports, "the notice import is gone").not.toBeNull();
    expect(imports![1].split(",").map((s) => s.trim()).filter(Boolean)).toEqual([
      "SIGNATURE_NOTICE",
    ]);
  });

  // THE DEFECT IN ITS MOST LIKELY FORM: somebody wants the wording to look
  // right, so a clause gets typed into the JSX. The screen then shows text that
  // the hash does not cover, and the member signs a document with a paragraph
  // in it that no signature proves.
  it("no clause text is hardcoded into the screen or the page", () => {
    const headings = AGREEMENT_V1_BODY.split("\n")
      .filter((line) => /^\d+\.\s/.test(line))
      .map((line) => line.replace(/^\d+\.\s*/, "").trim());
    expect(headings.length, "the default body has no numbered clauses any more").toBeGreaterThan(8);
    const offenders = headings.filter((h) => SIGNER.includes(h) || SIGN_PAGE.includes(h));
    expect(
      offenders,
      "clause text typed into the screen — the hash does not cover it:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);

    // THE SEED IS NOT THE LIVE DOCUMENT. The scan above reads
    // AGREEMENT_V1_BODY; the member signs `AgreementVersion.body`. They are
    // the same text only until the organizer edits the wording, after which
    // this would be checking a document nobody sees.
    //
    // So the property is pinned the other way round too, and this half holds
    // for ANY wording: the screen renders what the action handed it and never
    // composes a clause of its own.
    expect(SIGNER, "the screen no longer renders the clauses it was given").toMatch(
      /\{clause\.heading\}[\s\S]{0,400}\{clause\.body\}/,
    );
    expect(SIGNER, "the screen builds its own clause list").not.toMatch(/\bclauses\s*=\s*\[/);
  });

  // The hash the member's browser sends back is the one that arrived WITH those
  // clauses. Recomputing it in the browser would make the server's comparison
  // compare the server to itself.
  it("the signature echoes the hash it was given, not one it computed", () => {
    expect(signerCode).toMatch(/documentHash:\s*agreement\.documentHash/);
  });
});

// ————————————————————————————————————————————————————————————————————————
// 6. THE SERVER RE-CHECKS THE HASH.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — the server re-checks the document before recording it", () => {
  const body = stripComments(actionBody("signMyAgreement"));

  // THE WINDOW THIS CLOSES: the screen loads, the organizer changes the
  // member's weekly amount, the member presses Sign an hour later. Without the
  // comparison the signature is recorded against the CURRENT terms while the
  // member read the old ones — and the stored text would prove they agreed to
  // figures they never saw. Deleting the `!==` is a two-character edit that no
  // type checker and no unit test notices.
  it("it re-renders from live terms and compares", () => {
    expect(body, "the server no longer re-renders the document").toMatch(
      /const documentText = renderAgreement\(/,
    );
    expect(body, "the server no longer computes its own hash").toMatch(
      /const documentHash = agreementHash\(documentText\)/,
    );
    expect(body, "the comparison against what the member read is gone").toMatch(
      /documentHash\s*!==\s*input\.documentHash/,
    );
  });

  it("a mismatch refuses rather than reconciling", () => {
    const check = /if\s*\(\s*documentHash\s*!==\s*input\.documentHash\s*\)\s*\{/.exec(body);
    expect(check, "the mismatch is no longer guarded").not.toBeNull();
    const branch = braceBody(body, check!.index + check![0].length);
    expect(branch, "a mismatch is swallowed instead of refused").toMatch(/ok:\s*false/);
    expect(branch, "a mismatch must not write anything").not.toMatch(/create\(/);
  });

  it("the comparison happens before the row is written", () => {
    const check = body.indexOf("input.documentHash");
    const write = body.indexOf("agreementSignature.create");
    expect(write).toBeGreaterThan(-1);
    expect(check, "the signature is recorded before the document is verified").toBeLessThan(write);
  });

  // WHAT GETS STORED IS THE SERVER'S OWN VALUE. Storing `input.documentHash`
  // would record whatever the browser claimed — a hash that proves the client's
  // assertion rather than the document, and one a hostile client could pick.
  it("the stored hash and text are the server's, never the client's", () => {
    const create = /tx\.agreementSignature\.create\(\{\s*data:\s*\{/.exec(body);
    expect(create, "the create call moved — re-check what it stores").not.toBeNull();
    const data = braceBody(body, create!.index + create![0].length);
    expect(data, "the client's hash is stored as evidence").not.toMatch(/input\.documentHash/);
    expect(data, "the hash is not recorded at all").toMatch(/\bdocumentHash\b\s*[,:]/);
    expect(data, "the text that was signed is not kept").toMatch(/\bdocumentText\b\s*[,:]/);
  });

  // The other half of "that agreement is not yours": a participation id comes
  // straight off the client, so ownership is re-checked server-side. Without
  // it, any signed-in member could sign anybody's agreement.
  it("the participation is proved to belong to the signer", () => {
    expect(body).toMatch(/participation\.personId\s*!==\s*person\.id/);
    expect(body, "a member could sign an agreement nobody was asked for").toMatch(
      /participation\.agreementRequiredAt\s*===\s*null/,
    );
  });
});

// ————————————————————————————————————————————————————————————————————————
// 7. VERSIONS AND SIGNATURES ACCUMULATE. NOTHING IS EVER REWRITTEN.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — the record is append-only, in the code and in the database", () => {
  it("publishing the wording CREATES a version and never updates one", () => {
    const body = stripComments(actionBody("publishAgreementVersion"));
    expect(body).toMatch(/tx\.agreementVersion\.create\(/);
    // THE DEFECT: `upsert` or `update` on the current row. It looks tidier — one
    // row, always current — and it silently detaches every signature already
    // taken from the wording it was taken against, because a signature points at
    // a version id whose body has since been rewritten.
    expect(body, "an edit rewrites a row past signatures point at").not.toMatch(
      /agreementVersion\.(update|updateMany|upsert|delete|deleteMany)\b/,
    );
    expect(body, "a new version must carry the next number").toMatch(
      /version:\s*current\.version\s*\+\s*1/,
    );
  });

  it("nothing anywhere in the platform edits a version or a signature", () => {
    const scan = (dir: string): string[] => {
      const out: string[] = [];
      const walk = (d: string) => {
        for (const entry of readdirSync(d)) {
          if (entry === "generated" || entry === "node_modules" || entry === ".next") continue;
          const p = join(d, entry);
          if (statSync(p).isDirectory()) walk(p);
          else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(p);
        }
      };
      walk(join(ROOT, dir));
      return out;
    };
    const files = ["app", "lib", "scripts", "components"].flatMap(scan);
    expect(files.length, "the source walk found nothing").toBeGreaterThan(100);
    const mutation = /\b(agreementVersion|agreementSignature)\.(update|updateMany|upsert|delete|deleteMany)\b/;
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      const m = mutation.exec(src);
      if (m) offenders.push(`${rel(f)} → ${m[0]}`);
    }
    expect(
      offenders,
      "evidence that can be edited after the fact is not evidence:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  // THE DATABASE SAYS IT TOO, because the code above is only the code we have
  // today. A trigger refuses a hand-typed UPDATE in a psql session at midnight,
  // which is exactly the circumstance a signature has to survive.
  it("the migration refuses an update or a delete on a signature", () => {
    const sql = stripSqlComments(MIGRATION);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+agreement_signatures_no_update/i);
    expect(sql, "the trigger no longer covers both").toMatch(
      /BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+"agreement_signatures"/i,
    );
    expect(sql, "the trigger fires but permits the write").toMatch(/RAISE\s+EXCEPTION/i);
    expect(sql, "FOR EACH STATEMENT would miss a row-level write").toMatch(/FOR\s+EACH\s+ROW/i);
  });

  it("a version cannot be deleted out from under a signature", () => {
    const sql = stripSqlComments(MIGRATION);
    // CASCADE here would delete the proof of what somebody signed along with
    // the wording. RESTRICT makes the database refuse.
    expect(sql).toMatch(
      /agreement_signatures_agreementVersionId_fkey[\s\S]{0,200}ON DELETE RESTRICT/i,
    );
    expect(sql).toMatch(/CREATE UNIQUE INDEX "agreement_versions_version_key"/);
  });

  // THE COLUMN THAT DECIDES WHO IS GATED, and the single most dangerous line in
  // the migration. `NOT NULL DEFAULT CURRENT_TIMESTAMP` would be a natural
  // thing to write and would lock all 27 existing members out of their portals
  // the moment it ran — every one of them owing a signature for a welcome
  // nobody ever sent. Null means "never asked", and it has to be the default
  // state of every existing row.
  it("agreementRequiredAt is nullable, with no default", () => {
    const sql = stripSqlComments(MIGRATION);
    const add = /ALTER TABLE "participations" ADD COLUMN "agreementRequiredAt"([^;]*);/.exec(sql);
    expect(add, "the column is no longer added by this migration").not.toBeNull();
    expect(add![1], "existing members would be gated on deploy").not.toMatch(/NOT NULL/i);
    expect(add![1], "a default would gate everyone who already exists").not.toMatch(/DEFAULT/i);
    expect(add![1]).toMatch(/TIMESTAMP/i);
    // …and the model agrees. A non-optional field here would make Prisma demand
    // a value on every participation write.
    expect(SCHEMA, "the model made the requirement mandatory").toMatch(
      /agreementRequiredAt\s+DateTime\?/,
    );
  });
});

// ————————————————————————————————————————————————————————————————————————
// 8. ENGLISH ONLY (organizer ruling).
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — the agreement is English only", () => {
  // The platform holds Amharic names elsewhere — `Person.nameAmharic` is a real
  // column and the login greeting is bilingual. The AGREEMENT is not: the
  // organizer ruled that this document, its screen and its migration are
  // English, and a half-translated legal document is worse than an untranslated
  // one. Planting the defect: a translated clause in AGREEMENT_V1_BODY, or an
  // Amharic label beside the tickbox.
  const ETHIOPIC = /[ሀ-፿]/;

  const SCOPE: { name: string; text: string }[] = [
    { name: "lib/agreement.ts", text: AGREEMENT_LIB },
    { name: "app/agreement/page.tsx", text: SIGN_PAGE },
    { name: "app/agreement/agreement-signer.tsx", text: SIGNER },
    { name: "app/actions/agreement.ts", text: ACTIONS },
    { name: `prisma/migrations/${MIGRATION_DIR}/migration.sql`, text: MIGRATION },
  ];

  it("scans a real amount of text", () => {
    expect(SCOPE).toHaveLength(5);
    const total = SCOPE.reduce((n, s) => n + s.text.length, 0);
    expect(total, "the files came back empty — this scan proves nothing").toBeGreaterThan(20_000);
  });

  it("no Ethiopic character appears in the agreement, its screen or its migration", () => {
    const offenders = SCOPE.filter((s) => ETHIOPIC.test(s.text)).map((s) => s.name);
    expect(offenders, "Amharic in the agreement surface:\n  " + offenders.join("\n  ")).toEqual([]);
  });

  it("the default wording itself is English", () => {
    expect(ETHIOPIC.test(AGREEMENT_V1_BODY)).toBe(false);
  });
});

// ————————————————————————————————————————————————————————————————————————
// NON-VACUITY. Every scan above is `toEqual([])` or `not.toMatch`, and a
// pattern that matches NOTHING satisfies those exactly as well as a codebase
// that is correct. So each load-bearing pattern is fired here at the defect it
// forbids AND at the shape that is in the tree, where both are on one page.
// ————————————————————————————————————————————————————————————————————————

describe("the scan is not vacuous", () => {
  it("the route walk erases route groups, which is how a page escapes", () => {
    // The bypass, spelled out: identical URL, different layout.
    const escaped = { file: "app/(portal)/me/history/page.tsx", url: "/me/history" };
    expect(escaped.url.startsWith("/me/")).toBe(true);
    expect(escaped.file.startsWith("app/me/")).toBe(false);
    // A route handler under /me: right folder, no layout, ever.
    const handler = { file: "app/me/data/route.ts", url: "/me/data" };
    expect(handler.file.startsWith("app/me/")).toBe(true);
    expect(handler.file.endsWith("/page.tsx")).toBe(false);
    // And a real page passes both.
    const ok = ROUTES.find((r) => r.url === "/me/history")!;
    expect(ok.file.startsWith("app/me/") && ok.file.endsWith("/page.tsx")).toBe(true);
  });

  it("the redirect condition distinguishes the fix from the simplification", () => {
    const has = (src: string) => {
      const conds = [
        ...src.matchAll(/if\s*\(([^)]+)\)\s*redirect\(\s*["']\/agreement["']\s*\)/g),
      ].map((m) => m[1]);
      const all = conds.join(" || ");
      return /!\s*\w+\.ok\b/.test(all) && /\.data\s*!==\s*null/.test(all) && all.includes("||");
    };
    expect(has(`if (!owed.ok || owed.data !== null) redirect("/agreement");`)).toBe(true);
    // THE DEFECT: the failure disjunct dropped, so a database blip renders the
    // portal for someone who owes a signature.
    expect(has(`if (owed.ok && owed.data !== null) redirect("/agreement");`)).toBe(false);
    expect(has(`if (owed.data !== null) redirect("/agreement");`)).toBe(false);
  });

  it("the catch scan tells a refusal from a swallow", () => {
    const swallowed = `catch (e) {\n  console.error(e);\n  return { ok: true as const };\n}`;
    const refused = `catch (e) {\n  return { ok: false as const, error: "Your signature was NOT recorded." };\n}`;
    const body = (s: string) => {
      const m = /catch\s*(?:\([^)]*\)\s*)?\{/.exec(s)!;
      return braceBody(s, m.index + m[0].length);
    };
    expect(/ok:\s*false/.test(body(swallowed))).toBe(false);
    expect(/ok:\s*true/.test(body(swallowed))).toBe(true);
    expect(/ok:\s*false/.test(body(refused))).toBe(true);
    expect(/NOT recorded/.test(body(refused))).toBe(true);
    // And the empty catch, which is the same defect with less typing.
    expect(/ok:\s*false/.test(body(`catch {}`))).toBe(false);
  });

  it("the MAC pattern fires on every spelling and survives the stripper", () => {
    const CLAIM = /mac[\s_-]*addr/i;
    expect(CLAIM.test("macAddress String?")).toBe(true);
    expect(CLAIM.test('"mac_address" TEXT')).toBe(true);
    expect(CLAIM.test("we record your MAC address")).toBe(true);
    // …and does not fire on the platform's real vocabulary.
    expect(CLAIM.test('os === "macOS"')).toBe(false);
    // THE TRAP THE STRIPPER EXISTS FOR: four files deny the claim in prose. The
    // denial must disappear and the code must not.
    const denial = `// There is no MAC address column here.\nconst macCount = 0;`;
    expect(CLAIM.test(denial)).toBe(true);
    expect(CLAIM.test(stripComments(denial))).toBe(false);
    const sqlDenial = `-- deliberately NO mac address column\nALTER TABLE "x" ADD COLUMN "ip" TEXT;`;
    expect(CLAIM.test(sqlDenial)).toBe(true);
    expect(CLAIM.test(stripSqlComments(sqlDenial))).toBe(false);
    // A real column must still be caught after stripping.
    expect(CLAIM.test(stripSqlComments(`-- notes\n"macAddress" TEXT,`))).toBe(true);
    // …and neither stripper may eat a URL or a string, which is how a stripper
    // hides real code from every pattern that follows it.
    expect(stripComments(`const u = "https://api.twilio.com/x"; // gone`)).toContain(
      "https://api.twilio.com/x",
    );
    expect(stripSqlComments(`RAISE EXCEPTION 'a -- b'; -- gone`)).toContain("'a -- b'");
  });

  it("the one-string rule catches a re-assembled document", () => {
    const drifted = `const clauses = agreementClauses(renderAgreement(version.body, terms));\n  const hash = agreementHash(renderAgreement(version.body, terms));`;
    expect([...drifted.matchAll(/renderAgreement\(/g)]).toHaveLength(2);
    const single = `const documentText = renderAgreement(version.body, terms);\n  clauses: agreementClauses(documentText),\n  documentHash: agreementHash(documentText),`;
    expect([...single.matchAll(/renderAgreement\(/g)]).toHaveLength(1);
    expect(/agreementClauses\(documentText\)/.test(single)).toBe(true);
    expect(/agreementHash\(documentText\)/.test(single)).toBe(true);
    expect(/agreementClauses\(documentText\)/.test(drifted)).toBe(false);
  });

  it("the hash comparison pattern fires only on a real comparison", () => {
    expect(
      /documentHash\s*!==\s*input\.documentHash/.test(
        `if (documentHash !== input.documentHash) {\n  return { ok: false as const, error: "…" };\n}`,
      ),
    ).toBe(true);
    // THE DEFECT: the check deleted, the client's word taken for it.
    expect(
      /documentHash\s*!==\s*input\.documentHash/.test(
        `const documentHash = agreementHash(documentText);\n  await tx.agreementSignature.create({ data: { documentHash } });`,
      ),
    ).toBe(false);
  });

  it("the append-only pattern fires on the rewrite and not on the append", () => {
    const mutation =
      /\b(agreementVersion|agreementSignature)\.(update|updateMany|upsert|delete|deleteMany)\b/;
    expect(mutation.test(`await tx.agreementVersion.upsert({ where: { version: 1 } })`)).toBe(true);
    expect(mutation.test(`await prisma.agreementSignature.deleteMany({ where: { personId } })`)).toBe(
      true,
    );
    expect(mutation.test(`await tx.agreementVersion.create({ data: { version: n + 1 } })`)).toBe(
      false,
    );
    expect(mutation.test(`await prisma.agreementVersion.findFirst({})`)).toBe(false);
  });

  it("the column check fires on the shape that would gate everyone", () => {
    const safe = /ALTER TABLE "participations" ADD COLUMN "agreementRequiredAt"([^;]*);/;
    const planted = `ALTER TABLE "participations" ADD COLUMN "agreementRequiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`;
    expect(/NOT NULL/i.test(safe.exec(planted)![1])).toBe(true);
    const shipped = `ALTER TABLE "participations" ADD COLUMN "agreementRequiredAt" TIMESTAMP(3);`;
    expect(/NOT NULL/i.test(safe.exec(shipped)![1])).toBe(false);
    expect(/DEFAULT/i.test(safe.exec(shipped)![1])).toBe(false);
  });

  it("the Ethiopic range matches Amharic and nothing else here", () => {
    const ETHIOPIC = /[ሀ-፿]/;
    expect(ETHIOPIC.test("አማርኛ")).toBe(true);
    expect(ETHIOPIC.test("What I pay, and until when — $500")).toBe(false);
    // The em dash, the pound sign and the curly quote all live outside the
    // range, which is why this can scan files full of typographic punctuation.
    expect(ETHIOPIC.test("— ’ £")).toBe(false);
  });
});
