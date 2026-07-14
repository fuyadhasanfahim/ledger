import type Stripe from "stripe";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { processEvent } from "@/server/webhooks/process";

/**
 * POST /api/webhooks/stripe
 *
 * The only endpoint that is allowed to move money-derived state.
 *
 * Security posture:
 *  - The body is read as **raw text**, never parsed first. `constructEvent`
 *    recomputes the HMAC over the exact bytes Stripe signed; parsing and
 *    re-serialising would change them and every signature would fail.
 *  - An unsigned or badly-signed request is rejected with 400 before any
 *    business logic runs. Without this the endpoint would be an open,
 *    unauthenticated "grant me access" API.
 *  - The route is force-dynamic: it must never be cached or statically
 *    evaluated.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    log.warn("webhook.missing_signature");
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  // Raw bytes, exactly as sent. Do not JSON.parse before verifying.
  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe().webhooks.constructEvent(
      payload,
      signature,
      env().STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    // Covers a wrong secret, a tampered body, and a replayed old timestamp
    // (Stripe's constructEvent enforces a default 5-minute tolerance).
    log.warn("webhook.invalid_signature", { error });
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const result = await processEvent(event);

    if (result.outcome === "failed") {
      // Non-2xx tells Stripe to redeliver with backoff. The event is recorded
      // as `failed`, and process.ts lets the redelivery re-run it.
      return Response.json(
        { received: true, outcome: "failed", error: result.error },
        { status: 500 },
      );
    }

    return Response.json({ received: true, ...result }, { status: 200 });
  } catch (error) {
    log.error("webhook.unhandled_exception", {
      eventId: event.id,
      type: event.type,
      error,
    });

    return Response.json(
      { received: true, outcome: "error" },
      { status: 500 },
    );
  }
}
