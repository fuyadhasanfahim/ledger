import "server-only";

import Stripe from "stripe";
import { env } from "@/lib/env";

/**
 * Server-side Stripe SDK. Lazily constructed for the same reason as the Prisma
 * client: reading the secret key at import time would break `next build` on a
 * machine without secrets.
 *
 * The secret key is never imported into a Client Component — this module is
 * marked `server-only`, so any accidental client import is a build error rather
 * than a leaked key.
 */
let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;

  cached = new Stripe(env().STRIPE_SECRET_KEY, {
    // Pin the API version. Never let Stripe silently upgrade under us.
    apiVersion: "2026-06-24.dahlia",
    appInfo: {
      name: "Ledger",
      url: "https://github.com/",
    },
    typescript: true,
    maxNetworkRetries: 2,
  });

  return cached;
}

/**
 * Stripe's own idempotency layer. Every mutating Stripe call we make passes one
 * of these, so a double-clicked button or a retried request creates one object,
 * not two. (This is distinct from *webhook* idempotency, which is enforced by
 * the WebhookEvent.stripeEventId unique constraint.)
 */
export function idempotencyKey(...parts: string[]): string {
  return parts.join(":");
}
