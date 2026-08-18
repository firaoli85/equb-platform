import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest ran on defaults until the charts arrived, and a component test needs
// one thing the defaults do not give: the `@/` alias, so the test imports
// exactly what the app imports rather than a parallel relative path that can
// drift.
//
// JSX is deliberately NOT configured. Vitest's oxc transform handles it, and
// an `esbuild: { jsx }` block here is silently ignored in favour of oxc — a
// setting that looks load-bearing and is not is worse than no setting.
//
// `.mts` because this file is ESM and package.json has no `"type": "module"`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // THE GUARDS WALK THE WHOLE REPOSITORY, AND 5 SECONDS IS NOT ENOUGH.
    //
    // A dozen of the tests in lib/ are source scans: they read every file
    // under app/ and lib/ looking for a shape that must not exist — an
    // unbounded query, an audit row being updated, a cycle mutated without the
    // freeze check. That is real synchronous work, it runs in every worker at
    // once, and on the default 5s timeout the suite sat right at the edge of
    // it.
    //
    // The symptom was that adding TWO test files made five OTHER files fail,
    // and a different five on the next run. Nothing was hanging and nothing
    // was wrong: whichever scans happened to run concurrently lost the race.
    // Chasing that as a bug in the new tests would have been chasing the
    // wrong thing, and deleting them to get green would have been worse.
    //
    // 30s is still a real ceiling — a genuinely hung test fails, just not a
    // busy one. It is the timeout matching what these tests actually do.
    testTimeout: 30_000,
  },
});
