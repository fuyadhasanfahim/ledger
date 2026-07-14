import "dotenv/config";
import mongoose from "mongoose";

/**
 * Build the indexes.
 *
 * This is not optional housekeeping — it is what makes the webhook layer safe.
 * The idempotency guard relies on a **unique index** on
 * `WebhookEvent.stripeEventId`: without it, a duplicate insert simply succeeds,
 * the duplicate-key error never fires, and a replayed Stripe event gets
 * processed twice. Everything would look fine right up until it double-granted
 * access.
 *
 * Mongoose builds indexes automatically in development, but that is disabled in
 * production (you do not want an index build triggered by a cold request), so
 * this has to be run once against any new database.
 *
 *   npm run db:indexes
 */
async function main() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not set. Copy .env.example to .env first.");
  }

  await mongoose.connect(uri);

  // Import after connecting so the models register on this connection.
  const models = await import("../src/models/index.ts");

  const all = [
    models.CustomerModel,
    models.SubscriptionModel,
    models.PaymentModel,
    models.RefundModel,
    models.WebhookEventModel,
    models.AccessModel,
  ];

  for (const m of all) {
    await m.syncIndexes();
    const indexes = await m.collection.indexes();
    const names = indexes.map((i) => i.name).join(", ");
    console.log(`✓ ${m.modelName.padEnd(14)} ${names}`);
  }

  // Prove the one that actually matters.
  const webhookIndexes = await models.WebhookEventModel.collection.indexes();

  const unique = webhookIndexes.find(
    (i) => i.unique && i.key && "stripeEventId" in i.key,
  );

  if (!unique) {
    throw new Error(
      "FATAL: stripeEventId has no unique index. Webhook idempotency is NOT enforced.",
    );
  }

  console.log("\n✓ Idempotency guard is in place (unique index on stripeEventId).");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Index sync failed:", error);
  process.exit(1);
});
