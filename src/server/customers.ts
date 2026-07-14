import "server-only";

import type { Customer } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { getSessionId } from "@/lib/session";

/**
 * Resolve the Customer row for the current session, creating it on first use.
 *
 * The session id comes from a signed httpOnly cookie (minted by the proxy), so
 * a visitor cannot address another visitor's customer by editing a cookie.
 */
export async function currentCustomer(): Promise<Customer | null> {
  const sessionId = await getSessionId();
  if (!sessionId) return null;

  // upsert, not find-then-create: two concurrent requests on a fresh session
  // would otherwise race and one would blow up on the unique constraint.
  return db.customer.upsert({
    where: { sessionId },
    create: { sessionId, access: { create: {} } },
    update: {},
  });
}

/** Same, but throws — for routes that cannot proceed without a session. */
export async function requireCustomer(): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) {
    throw new Error("No session. Enable cookies and reload.");
  }
  return customer;
}

/**
 * Ensure the customer exists in Stripe, and cache the id locally.
 *
 * Stripe's own idempotency key is derived from our customer id, so a retried
 * request reuses the same Stripe customer rather than creating a duplicate.
 */
export async function ensureStripeCustomer(customer: Customer): Promise<string> {
  if (customer.stripeCustomerId) return customer.stripeCustomerId;

  const created = await stripe().customers.create(
    {
      email: customer.email ?? undefined,
      metadata: {
        ledgerCustomerId: customer.id,
        sessionId: customer.sessionId,
      },
    },
    { idempotencyKey: `customer:${customer.id}` },
  );

  await db.customer.update({
    where: { id: customer.id },
    data: { stripeCustomerId: created.id },
  });

  return created.id;
}

/** Look a customer up from a Stripe customer id (used by webhook handlers). */
export async function customerByStripeId(
  stripeCustomerId: string,
): Promise<Customer | null> {
  return db.customer.findUnique({ where: { stripeCustomerId } });
}
