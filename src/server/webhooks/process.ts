import "server-only";

import type Stripe from "stripe";
import { WebhookStatus } from "@/lib/domain";
import { connectDb } from "@/lib/db";
import { log } from "@/lib/logger";
import { WebhookEventModel, isDuplicateKey } from "@/models";
import { HANDLERS } from "@/server/webhooks/handlers";

/**
 * Idempotent event processing.
 *
 * Stripe delivers at-least-once: network hiccups, our own 5xx responses, and
 * manual replays from the dashboard all mean the same event id can arrive more
 * than once. Processing one twice would double-grant access or double-count a
 * payment.
 *
 * The guard is a database constraint, not an `if`:
 *
 *   1. INSERT the event id first. `stripeEventId` carries a **unique index**, so
 *      a concurrent replay loses the race *inside MongoDB* and raises a
 *      duplicate-key error (11000). A find-then-insert in application code would
 *      leave a window where two simultaneous deliveries both pass the check and
 *      both run.
 *   2. Only then run the handler.
 *   3. Record the outcome on the same document.
 *
 * (This is the Mongo equivalent of the Postgres UNIQUE constraint this used to
 * rely on. The mechanism differs — error code 11000 instead of P2002 — but the
 * guarantee is identical, and it is still the *database* settling the race.)
 *
 * One wrinkle: a handler that *failed* must stay retryable. If every claimed id
 * counted as "already done", a transient failure (Stripe blip, DB timeout) would
 * be permanently swallowed and Stripe's redelivery would no-op. So a duplicate
 * whose recorded status is `failed` may run again; one that succeeded may not.
 */

export type ProcessResult =
  | { outcome: "processed"; summary: string }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; summary: string }
  | { outcome: "failed"; error: string };

export async function processEvent(event: Stripe.Event): Promise<ProcessResult> {
  await connectDb();

  if ((await claim(event)) === "duplicate") {
    log.info("webhook.duplicate", { eventId: event.id, type: event.type });
    return { outcome: "duplicate" };
  }

  const handler = HANDLERS[event.type];

  // An event type we don't handle. Recorded anyway, so the log shows it arrived.
  if (!handler) {
    const summary = "unhandled event type — recorded, no action taken";

    await WebhookEventModel.updateOne(
      { stripeEventId: event.id },
      { $set: { status: WebhookStatus.ignored, summary, error: null } },
    );

    log.info("webhook.ignored", { eventId: event.id, type: event.type });
    return { outcome: "ignored", summary };
  }

  try {
    const summary = await handler(event);

    await WebhookEventModel.updateOne(
      { stripeEventId: event.id },
      { $set: { status: WebhookStatus.processed, summary, error: null } },
    );

    log.info("webhook.processed", {
      eventId: event.id,
      type: event.type,
      summary,
    });

    return { outcome: "processed", summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Left as `failed`, which makes it eligible for reprocessing when Stripe
    // redelivers (see claim()).
    await WebhookEventModel.updateOne(
      { stripeEventId: event.id },
      {
        $set: {
          status: WebhookStatus.failed,
          summary: `handler threw — ${message}`,
          error: message,
        },
      },
    );

    log.error("webhook.failed", { eventId: event.id, type: event.type, error });

    return { outcome: "failed", error: message };
  }
}

/**
 * Take exclusive ownership of an event id.
 *
 * "claimed" → this call should process the event.
 * "duplicate" → it was already handled successfully (or is in flight right now).
 */
async function claim(event: Stripe.Event): Promise<"claimed" | "duplicate"> {
  try {
    await WebhookEventModel.create({
      stripeEventId: event.id,
      type: event.type,
      status: WebhookStatus.processed, // provisional — corrected on completion
      summary: "processing…",
    });

    return "claimed";
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;

    // Someone got here first. Re-claim only if their attempt failed.
    const result = await WebhookEventModel.updateOne(
      { stripeEventId: event.id, status: WebhookStatus.failed },
      { $set: { status: WebhookStatus.processed, summary: "retrying…" } },
    );

    return result.modifiedCount === 1 ? "claimed" : "duplicate";
  }
}
