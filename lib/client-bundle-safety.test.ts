import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A SOURCE-SCANNING GUARD, not a unit test.
//
// A "use client" file that imports a server-only module drags Prisma into the
// browser graph, and Prisma imports `pg`, which imports node:dns. Turbopack
// cannot resolve `dns` for the browser, so the result is not a warning or a
// slow page — it is a 500 on every route that renders the component.
//
// Found the hard way: app/admin/(protected)/settings/settings-form.tsx
// imported one string constant from lib/settings.ts and took the entire
// platform settings page down with "Module not found: Can't resolve 'dns'".
// Nothing in a type-check or a unit test catches that; only loading the page
// does, which is exactly the kind of failure that reaches the organizer
// first. Hence this.
//
// The fix pattern, when this test fails: move the constant a client needs
// into a module with no database import (lib/setting-defaults.ts,
// lib/session-cookie.ts) and import from there.

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["app", "components"];

/** Modules that reach the database — never importable from a client file. */
const SERVER_ONLY = [
  "@/lib/prisma",
  "@/lib/settings",
  "@/lib/auth",
  "@/lib/session-record",
  "@/lib/session-gate",
  "@/lib/supabase/server",
  "@/lib/supabase/admin",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));

describe("no client component drags the database into the browser bundle", () => {
  it("scans a realistic number of files (the walker itself works)", () => {
    // Without this, a broken path would make every assertion below pass by
    // scanning nothing at all.
    expect(files.length).toBeGreaterThan(40);
  });

  it("every \"use client\" file avoids server-only modules", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Only the directive at the very top makes a client component.
      if (!/^\s*(["'])use client\1/.test(source)) continue;

      for (const server of SERVER_ONLY) {
        // `from "@/lib/settings"` — the exact specifier, so "@/lib/settings"
        // does not also flag a hypothetical "@/lib/settings-view".
        const pattern = new RegExp(`from\\s+["']${server.replace(/[/@]/g, "\\$&")}["']`);
        if (pattern.test(source)) {
          offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")} imports ${server}`);
        }
      }
    }

    expect(
      offenders,
      "A client component may not import a module that reaches the database — " +
        "it pulls pg/node:dns into the browser bundle and the page 500s. " +
        "Move what it needs into lib/setting-defaults.ts or a similar " +
        "database-free module.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the client-safe modules really are client-safe", () => {
    // The escape hatches only work if they stay free of the database
    // themselves — otherwise the fix above just moves the problem.
    for (const safe of ["setting-defaults.ts", "session-cookie.ts", "session-policy.ts", "device.ts"]) {
      const source = readFileSync(join(ROOT, "lib", safe), "utf8");
      // Match IMPORTS, not prose — these files explain in comments exactly
      // why they avoid next/headers, and a substring check flags the
      // explanation as the offence.
      expect(source, `${safe} must not import Prisma`).not.toMatch(
        /(?:from|import\()\s*["'][^"']*prisma/i,
      );
      expect(source, `${safe} must not import next/headers`).not.toMatch(
        /(?:from|import\()\s*["']next\/headers["']/,
      );
      expect(source, `${safe} must not be server-only`).not.toMatch(
        /^\s*import\s+["']server-only["']/m,
      );
    }
  });
});
