import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Prisma 7 has no Rust query engine — it compiles queries and hands them to a
 * driver adapter. We use `PrismaPg` against Neon's *pooled* endpoint, which is
 * what serverless functions should talk to. (Migrations use the direct endpoint;
 * see prisma.config.ts.)
 *
 * Two deliberate details:
 *
 * 1. The client is built **lazily**, behind a Proxy. Constructing it reads
 *    `DATABASE_URL`, and `next build` imports every module — so an eager client
 *    would make the build fail on any machine without secrets. Nothing connects
 *    until a query is actually issued.
 * 2. It is memoised on `globalThis` so dev HMR doesn't open a fresh pool on
 *    every reload (the classic "too many connections" crash).
 */
function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function client(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;

  const created = createClient();
  globalForPrisma.prisma = created;
  return created;
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(client(), prop, receiver);
  },
});
