import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

/**
 * Seed.
 *
 * Deliberately thin. Ledger creates its Stripe prices inline at checkout via
 * `price_data`, so there is no product catalog to mirror into Postgres — the
 * plans live in src/lib/catalog.ts as the single source of truth, and seeding a
 * second copy here would just be a way to let the two drift apart.
 *
 * What this *does* do is prove the connection and give the event log something
 * to show before the first real webhook lands.
 */
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const existing = await prisma.webhookEvent.count();

  if (existing > 0) {
    console.log(`✓ Database already has ${existing} event(s). Nothing to seed.`);
    return;
  }

  await prisma.webhookEvent.create({
    data: {
      stripeEventId: "evt_seed_placeholder",
      type: "ledger.seeded",
      status: "ignored",
      summary:
        "Database seeded. Real Stripe events will appear above this line.",
    },
  });

  console.log("✓ Seeded the event log with a placeholder entry.");
  console.log("  Run a checkout — real events will stack on top of it.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
