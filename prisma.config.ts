import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI config (migrate / studio / seed).
 *
 * The CLI issues DDL, which must not go through a connection pooler, so it
 * prefers `DIRECT_URL` (Neon's unpooled endpoint) and falls back to
 * `DATABASE_URL`. The *runtime* client is separate: it connects via the
 * `PrismaPg` driver adapter using the pooled `DATABASE_URL` (see src/lib/db.ts).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
