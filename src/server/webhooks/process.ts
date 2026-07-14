import "server-only";

import type Stripe from "stripe";
import { WebhookStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
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
 *   1. INSERT the event id first. `WebhookEvent.stripeEventId` is UNIQUE, so a
 *      concurrent replay loses the race *at the database* and throws P2002.
 *      A check-then-insert would leave a window where two simultaneous
 *      deliveries both pass the check and both run.
 *   2. Only then run the handler.
 *   3. Record the outcome on the same row.
 *
 * The one wrinkle: a handler that *failed* must stay retryable. If we treated
 * every claimed id as "already done", a transient failure (Stripe API blip, DB
 * timeout) would be permanently swallowed and Stripe's redelivery would no-op.
 * So a duplicate whose recorded status is `failed` is allowed to run again;
 * a duplicate that succeeded is not.
 */

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

export type ProcessResult =
  | { outcome: "processed"; summary: string }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; summary: string }
  | { outcome: "failed"; error: string };

export async function processEvent(event: Stripe.Event): Promise<ProcessResult> {
  const claimed = await claim(event);

  if (claimed === "duplicate") {
    log.info("webhook.duplicate", { eventId: event.id, type: event.type });
    return { outcome: "duplicate" };
  }

  const handler = HANDLERS[event.type];

  // An event type we don't handle. Recorded, so the log can show it arrived.
  if (!handler) {
    const summary = "unhandled event type — recorded, no action taken";

    await db.webhookEvent.update({
      where: { stripeEventId: event.id },
      data: { status: WebhookStatus.ignored, summary, error: null },
    });

    log.info("webhook.ignored", { eventId: event.id, type: event.type });
    return { outcome: "ignored", summary };
  }

  try {
    const summary = await handler(event);

    await db.webhookEvent.update({
      where: { stripeEventId: event.id },
      data: { status: WebhookStatus.processed, summary, error: null },
    });

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
    await db.webhookEvent.update({
      where: { stripeEventId: event.id },
      data: {
        status: WebhookStatus.failed,
        summary: `handler threw — ${message}`,
        error: message,
      },
    });

    log.error("webhook.failed", { eventId: event.id, type: event.type, error });

    return { outcome: "failed", error: message };
  }
}

/**
 * Take exclusive ownership of an event id.
 *
 * Returns "claimed" if this call should process the event, or "duplicate" if it
 * was already handled successfully (or is being handled right now).
 */
async function claim(event: Stripe.Event): Promise<"claimed" | "duplicate"> {
  try {
    await db.webhookEvent.create({
      data: {
        stripeEventId: event.id,
        type: event.type,
        status: WebhookStatus.processed, // provisional — corrected on completion
        summary: "processing…",
      },
    });

    return "claimed";
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Someone got here first. Re-claim only if their attempt failed.
    const { count } = await db.webhookEvent.updateMany({
      where: { stripeEventId: event.id, status: WebhookStatus.failed },
      data: { status: WebhookStatus.processed, summary: "retrying…" },
    });

    return count === 1 ? "claimed" : "duplicate";
  }
}
