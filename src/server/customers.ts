import "server-only";

import type { Customer } from "@/lib/domain";
import { connectDb } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { getSessionId } from "@/lib/session";
import { AccessModel, CustomerModel, isDuplicateKey } from "@/models";
import { toCustomer } from "@/models/map";

/**
 * Resolve the Customer for the current session, creating it on first use.
 *
 * The session id comes from a signed httpOnly cookie (minted by the proxy), so
 * a visitor cannot address someone else's customer by editing a cookie.
 */
export async function currentCustomer(): Promise<Customer | null> {
  const sessionId = await getSessionId();
  if (!sessionId) return null;

  await connectDb();

  // findOneAndUpdate with upsert, not find-then-create: two concurrent requests
  // on a fresh session would otherwise race, and one would lose on the unique
  // index. `sessionId` is unique, so the database settles the race for us.
  const doc = await CustomerModel.findOneAndUpdate(
    { sessionId },
    { $setOnInsert: { sessionId } },
    // `returnDocument: "after"` — we need the document *post*-upsert, otherwise a
    // brand-new session gets back null and every first request fails. (This
    // replaces `new: true`, which Mongoose 9 deprecated.)
    { upsert: true, returnDocument: "after" },
  );

  // Access starts as an explicit "never granted" row rather than an absent one,
  // so the premium page can state *why* someone is locked out.
  try {
    await AccessModel.updateOne(
      { customerId: doc._id },
      { $setOnInsert: { customerId: doc._id } },
      { upsert: true },
    );
  } catch (error) {
    // Concurrent upserts on the unique customerId index can collide; the row
    // exists either way, which is all we wanted.
    if (!isDuplicateKey(error)) throw error;
  }

  return toCustomer(doc);
}

/** Same, but throws — for paths that cannot proceed without a session. */
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
 * The Stripe idempotency key is derived from our own customer id, so a retried
 * request reuses the same Stripe customer instead of creating a duplicate.
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

  await connectDb();
  await CustomerModel.updateOne(
    { _id: customer.id },
    { $set: { stripeCustomerId: created.id } },
  );

  return created.id;
}

/** Look a customer up by our own id. */
export async function customerById(id: string): Promise<Customer | null> {
  await connectDb();
  const doc = await CustomerModel.findById(id);
  return doc ? toCustomer(doc) : null;
}

/** Look a customer up from a Stripe customer id (used by webhook handlers). */
export async function customerByStripeId(
  stripeCustomerId: string,
): Promise<Customer | null> {
  await connectDb();
  const doc = await CustomerModel.findOne({ stripeCustomerId });
  return doc ? toCustomer(doc) : null;
}
