import "server-only";

import type Stripe from "stripe";
import type { Customer, Subscription } from "@/lib/domain";
import { connectDb } from "@/lib/db";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { getPlan, type PlanId } from "@/lib/catalog";
import { SubscriptionModel } from "@/models";
import { toSubscription } from "@/models/map";

/** The customer's current, non-terminal subscription (at most one in this demo). */
export async function activeSubscription(
  customerId: string,
): Promise<Subscription | null> {
  await connectDb();

  const doc = await SubscriptionModel.findOne({
    customerId,
    status: { $in: ["active", "trialing", "past_due", "unpaid", "incomplete"] },
  }).sort({ createdAt: -1 });

  return doc ? toSubscription(doc) : null;
}

/**
 * Switch plan with proration.
 *
 * The subtlety: you must **replace** the existing subscription item, not append
 * a new one — appending bills the customer for both plans. Passing the existing
 * item's `id` is what makes it a swap.
 *
 * `proration_behavior: "create_prorations"` means an upgrade mid-cycle bills
 * only the difference, and a downgrade issues a credit.
 */
export async function changePlan(
  customer: Customer,
  subscription: Subscription,
  nextPlanId: PlanId,
): Promise<Stripe.Subscription> {
  const plan = getPlan(nextPlanId);
  if (!plan) throw new Error(`Unknown plan: ${nextPlanId}`);

  if (subscription.plan === nextPlanId) {
    throw new Error(`Already on the ${plan.name} plan.`);
  }

  const current = await stripe().subscriptions.retrieve(subscription.stripeSubId);

  const itemId = current.items.data[0]?.id;
  if (!itemId) throw new Error("Subscription has no billable item to swap.");

  const updated = await stripe().subscriptions.update(subscription.stripeSubId, {
    items: [
      {
        id: itemId, // replace, don't add
        price_data: {
          currency: "usd",
          unit_amount: plan.amount,
          recurring: { interval: plan.interval },
          product: await productFor(current),
        },
      },
    ],
    proration_behavior: "create_prorations",
    metadata: { ledgerCustomerId: customer.id, plan: plan.id },
  });

  log.info("subscription.plan_changed", {
    customerId: customer.id,
    from: subscription.plan,
    to: plan.id,
  });

  // The webhook confirms this, but write through so the UI is right on the very
  // next render instead of after a round-trip.
  await connectDb();
  await SubscriptionModel.updateOne(
    { _id: subscription.id },
    { $set: { plan: plan.id } },
  );

  return updated;
}

/**
 * Reuse the product already attached to the subscription's price, so switching
 * plans doesn't litter the Stripe account with a new product each time.
 * `price.product` may be an id, an expanded object, or a deleted stub.
 */
async function productFor(sub: Stripe.Subscription): Promise<string> {
  const product = sub.items.data[0]?.price?.product;

  if (typeof product === "string") return product;
  if (product && !product.deleted) return product.id;

  const created = await stripe().products.create({ name: "Ledger Access" });
  return created.id;
}

/**
 * Cancel. Two modes, because they behave very differently and the difference is
 * worth feeling:
 *
 * - `at_period_end`: keeps access until the paid-for period runs out.
 * - `immediate`: ends now; the subscription.deleted webhook revokes access.
 */
export async function cancelSubscription(
  customer: Customer,
  subscription: Subscription,
  mode: "immediate" | "at_period_end",
): Promise<void> {
  if (mode === "immediate") {
    await stripe().subscriptions.cancel(subscription.stripeSubId);
  } else {
    await stripe().subscriptions.update(subscription.stripeSubId, {
      cancel_at_period_end: true,
    });
  }

  log.info("subscription.cancel_requested", {
    customerId: customer.id,
    mode,
  });
}

/** Undo a scheduled cancellation. */
export async function resumeSubscription(
  customer: Customer,
  subscription: Subscription,
): Promise<void> {
  await stripe().subscriptions.update(subscription.stripeSubId, {
    cancel_at_period_end: false,
  });

  log.info("subscription.resumed", { customerId: customer.id });
}
