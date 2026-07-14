import "server-only";

import type Stripe from "stripe";
import type { Customer, Subscription } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { getPlan, type PlanId } from "@/lib/catalog";

/** The customer's current, non-terminal subscription (at most one in this demo). */
export async function activeSubscription(
  customerId: string,
): Promise<Subscription | null> {
  return db.subscription.findFirst({
    where: {
      customerId,
      status: { in: ["active", "trialing", "past_due", "unpaid", "incomplete"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Switch plan with proration.
 *
 * The subtlety: you must replace the *existing* subscription item rather than
 * appending a new one, otherwise the customer ends up billed for both plans.
 * We pass `proration_behavior: "create_prorations"`, so upgrading mid-cycle
 * bills only the difference and downgrading issues a credit.
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

  const current = await stripe().subscriptions.retrieve(
    subscription.stripeSubId,
  );

  const itemId = current.items.data[0]?.id;
  if (!itemId) {
    throw new Error("Subscription has no billable item to swap.");
  }

  const updated = await stripe().subscriptions.update(
    subscription.stripeSubId,
    {
      items: [
        {
          // Replacing the id, not adding — otherwise they'd be billed twice.
          id: itemId,
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
    },
  );

  log.info("subscription.plan_changed", {
    customerId: customer.id,
    from: subscription.plan,
    to: plan.id,
    stripeSubId: subscription.stripeSubId,
  });

  // The webhook will confirm this, but write through so the UI is correct on
  // the very next render rather than after a round-trip.
  await db.subscription.update({
    where: { id: subscription.id },
    data: { plan: plan.id },
  });

  return updated;
}

/**
 * Reuse the product already attached to the subscription's price, so a plan
 * switch stays on the same product instead of littering the Stripe account with
 * a new one per change. `price.product` may be an id, an expanded object, or a
 * deleted stub — all three have to be handled.
 */
async function productFor(sub: Stripe.Subscription): Promise<string> {
  const product = sub.items.data[0]?.price?.product;

  if (typeof product === "string") return product;
  if (product && !product.deleted) return product.id;

  const created = await stripe().products.create({ name: "Ledger Access" });
  return created.id;
}

/**
 * Cancel. Two modes, because they behave very differently and a client should
 * be able to feel the difference:
 *
 * - `at_period_end`: keeps access until the paid-for period runs out.
 * - `immediate`: ends now. Access is revoked by the subscription.deleted webhook.
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
    stripeSubId: subscription.stripeSubId,
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

  log.info("subscription.resumed", {
    customerId: customer.id,
    stripeSubId: subscription.stripeSubId,
  });
}
