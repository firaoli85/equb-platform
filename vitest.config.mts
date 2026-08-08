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
});
