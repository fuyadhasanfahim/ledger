import "server-only";

import type { Customer } from "@/lib/domain";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import {
  MARKETPLACE_LISTING,
  ONE_TIME_PRODUCT,
  getPlan,
  splitMarketplace,
  type PlanId,
} from "@/lib/catalog";
import { ensureStripeCustomer } from "@/server/customers";

/**
 * Payment intents / subscriptions for our OWN checkout page.
 *
 * We no longer redirect to Stripe-hosted Checkout. Instead each of these
 * returns a **client secret**, which the themed Payment Element on /checkout
 * confirms in the browser.
 *
 * The PCI position is unchanged: the card is still entered into Stripe's own
 * cross-origin iframe (the Element), so the PAN never touches our origin or our
 * server. We style the iframe via the Appearance API — we don't read from it.
 */

export type Intent =
  | { kind: "payment"; clientSecret: string; amount: number }
  | {
      kind: "subscription";
      clientSecret: string;
      amount: number;
      subscriptionId: string;
    };

/* ------------------------------------------------------------------ */
/* One-time                                                            */
/* ------------------------------------------------------------------ */

export async function createOneTimeIntent(customer: Customer): Promise<Intent> {
  const stripeCustomerId = await ensureStripeCustomer(customer);

  const intent = await stripe().paymentIntents.create(
    {
      amount: ONE_TIME_PRODUCT.amount,
      currency: "usd",
      customer: stripeCustomerId,
      description: ONE_TIME_PRODUCT.name,
      automatic_payment_methods: { enabled: true },
      metadata: { ledgerCustomerId: customer.id, type: "one_time" },
    },
    // Reusing the key across retries means a double-click can't open two intents.
    { idempotencyKey: `one_time:${customer.id}:${Date.now()}` },
  );

  if (!intent.client_secret) {
    throw new Error("Stripe returned a PaymentIntent with no client_secret");
  }

  log.info("intent.created", {
    kind: "one_time",
    customerId: customer.id,
    intentId: intent.id,
  });

  return {
    kind: "payment",
    clientSecret: intent.client_secret,
    amount: ONE_TIME_PRODUCT.amount,
  };
}

/* ------------------------------------------------------------------ */
/* Marketplace (Connect destination charge)                            */
/* ------------------------------------------------------------------ */

export async function createMarketplaceIntent(
  customer: Customer,
  connectAccountId: string,
): Promise<Intent> {
  const stripeCustomerId = await ensureStripeCustomer(customer);
  const split = splitMarketplace(MARKETPLACE_LISTING.amount);

  const intent = await stripe().paymentIntents.create({
    amount: split.total,
    currency: "usd",
    customer: stripeCustomerId,
    description: MARKETPLACE_LISTING.name,
    automatic_payment_methods: { enabled: true },
    // The split: the platform keeps the fee, Stripe transfers the rest.
    application_fee_amount: split.platformFee,
    transfer_data: { destination: connectAccountId },
    metadata: {
      ledgerCustomerId: customer.id,
      type: "marketplace",
      platformFee: String(split.platformFee),
      sellerPayout: String(split.sellerPayout),
      connectAccountId,
    },
  });

  if (!intent.client_secret) {
    throw new Error("Stripe returned a PaymentIntent with no client_secret");
  }

  log.info("intent.created", {
    kind: "marketplace",
    customerId: customer.id,
    platformFee: split.platformFee,
    sellerPayout: split.sellerPayout,
  });

  return { kind: "payment", clientSecret: intent.client_secret, amount: split.total };
}

/* ------------------------------------------------------------------ */
/* Subscription                                                        */
/* ------------------------------------------------------------------ */

/**
 * Create an incomplete subscription and hand back the secret to confirm it.
 *
 * `payment_behavior: "default_incomplete"` is what makes a custom subscription
 * flow possible: Stripe creates the subscription in `incomplete` status and
 * waits for us to confirm the first invoice's payment client-side.
 *
 * Note where the secret lives: **`latest_invoice.confirmation_secret`**, not
 * `latest_invoice.payment_intent.client_secret`. The older field is gone in
 * current API versions, and expanding the wrong path silently yields undefined.
 */
export async function createSubscriptionIntent(
  customer: Customer,
  planId: PlanId,
): Promise<Intent> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const stripeCustomerId = await ensureStripeCustomer(customer);

  const subscription = await stripe().subscriptions.create({
    customer: stripeCustomerId,
    items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: plan.amount,
          recurring: { interval: plan.interval },
          // Subscription price_data takes a product *id* — unlike Checkout's
          // line_items, it won't create one inline from `product_data`.
          product: await ensureProduct(planId),
        },
      },
    ],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.confirmation_secret"],
    metadata: { ledgerCustomerId: customer.id, plan: plan.id },
  });

  const invoice = subscription.latest_invoice;

  const clientSecret =
    invoice && typeof invoice !== "string"
      ? invoice.confirmation_secret?.client_secret
      : undefined;

  if (!clientSecret) {
    throw new Error(
      "Subscription has no confirmation_secret — check the expand path.",
    );
  }

  log.info("intent.created", {
    kind: "subscription",
    plan: plan.id,
    customerId: customer.id,
    subscriptionId: subscription.id,
  });

  return {
    kind: "subscription",
    clientSecret,
    amount: plan.amount,
    subscriptionId: subscription.id,
  };
}

/**
 * The Stripe Product backing a plan, created on first use.
 *
 * Stripe lets us choose the product id, so we derive it from the plan and make
 * this idempotent by construction: `retrieve` first, `create` with that exact id
 * if it's missing. Without a stable id, every subscription would spawn a fresh
 * product and the Stripe dashboard would fill up with duplicates named the same
 * thing.
 */
async function ensureProduct(planId: PlanId): Promise<string> {
  const id = `ledger_${planId}`;
  const plan = getPlan(planId);

  try {
    const existing = await stripe().products.retrieve(id);
    if (!existing.deleted) return existing.id;
  } catch {
    // Not found — fall through and create it.
  }

  const created = await stripe().products.create({
    id,
    name: `Ledger ${plan?.name ?? planId}`,
    metadata: { plan: planId },
  });

  return created.id;
}
