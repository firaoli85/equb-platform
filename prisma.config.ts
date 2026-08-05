import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Next.js keeps secrets in .env.local; the Prisma CLI does not load it on its own.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Migrations/introspection run over the session pooler (DIRECT_URL).
    // The app runtime uses the transaction pooler (DATABASE_URL).
    url: env("DIRECT_URL"),
  },
});
