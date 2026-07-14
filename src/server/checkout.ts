import "server-only";

import type Stripe from "stripe";
import type { Customer } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
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
 * All Checkout Sessions are created here, never inline in a route.
 *
 * We use Stripe-hosted Checkout and redirect to `session.url`. That keeps the
 * card PAN entirely off our origin — we never see it, so the demo's PCI surface
 * is SAQ-A. It's also why there's no `@stripe/stripe-js` in the bundle.
 */

function returnUrls(path: string) {
  const base = env().APP_URL;
  return {
    success_url: `${base}${path}?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${path}?status=canceled`,
  };
}

/** Subscription checkout — `mode: subscription`. */
export async function createSubscriptionCheckout(
  customer: Customer,
  planId: PlanId,
): Promise<string> {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const stripeCustomerId = await ensureStripeCustomer(customer);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: plan.amount,
          recurring: { interval: plan.interval },
          product_data: {
            name: `Ledger ${plan.name}`,
            description: plan.blurb,
          },
        },
      },
    ],
    // Carried through to the webhook, which is the only thing we trust.
    subscription_data: {
      metadata: { ledgerCustomerId: customer.id, plan: plan.id },
    },
    metadata: { ledgerCustomerId: customer.id, plan: plan.id },
    ...returnUrls("/dashboard"),
  });

  log.info("checkout.created", {
    mode: "subscription",
    plan: plan.id,
    customerId: customer.id,
    sessionId: session.id,
  });

  if (!session.url) throw new Error("Stripe returned a session with no URL");
  return session.url;
}

/** One-time payment — `mode: payment`. */
export async function createOneTimeCheckout(
  customer: Customer,
): Promise<string> {
  const stripeCustomerId = await ensureStripeCustomer(customer);

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: ONE_TIME_PRODUCT.amount,
          product_data: {
            name: ONE_TIME_PRODUCT.name,
            description: ONE_TIME_PRODUCT.blurb,
          },
        },
      },
    ],
    payment_intent_data: {
      metadata: {
        ledgerCustomerId: customer.id,
        type: "one_time",
      },
    },
    metadata: { ledgerCustomerId: customer.id, type: "one_time" },
    ...returnUrls("/premium"),
  });

  log.info("checkout.created", {
    mode: "payment",
    customerId: customer.id,
    sessionId: session.id,
  });

  if (!session.url) throw new Error("Stripe returned a session with no URL");
  return session.url;
}

/**
 * Marketplace payment — one charge, split between the platform and a connected
 * seller via `application_fee_amount` + `transfer_data.destination`.
 *
 * This is a "destination charge": the charge is created on the platform, the
 * platform keeps `application_fee_amount`, and Stripe transfers the remainder
 * to the connected account.
 */
export async function createMarketplaceCheckout(
  customer: Customer,
  connectAccountId: string,
): Promise<string> {
  const stripeCustomerId = await ensureStripeCustomer(customer);
  const split = splitMarketplace(MARKETPLACE_LISTING.amount);

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: split.total,
          product_data: {
            name: MARKETPLACE_LISTING.name,
            description: MARKETPLACE_LISTING.blurb,
          },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: split.platformFee,
      transfer_data: { destination: connectAccountId },
      metadata: {
        ledgerCustomerId: customer.id,
        type: "marketplace",
        platformFee: String(split.platformFee),
        sellerPayout: String(split.sellerPayout),
        connectAccountId,
      },
    },
    metadata: {
      ledgerCustomerId: customer.id,
      type: "marketplace",
      connectAccountId,
    },
    ...returnUrls("/connect"),
  });

  log.info("checkout.created", {
    mode: "marketplace",
    customerId: customer.id,
    platformFee: split.platformFee,
    sellerPayout: split.sellerPayout,
  });

  if (!session.url) throw new Error("Stripe returned a session with no URL");
  return session.url;
}

/**
 * Read back a completed Checkout Session so the success page can show what
 * happened *immediately*, without waiting for the webhook to land.
 *
 * Important: this is for display only. Access is never granted from this —
 * a `?session_id=` in the URL is attacker-controlled, and only the signed
 * webhook is trusted to move money-derived state.
 */
export async function describeSession(
  sessionId: string,
  customer: Customer,
): Promise<Stripe.Checkout.Session | null> {
  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);

    // Don't leak another customer's session back to this visitor.
    if (session.metadata?.ledgerCustomerId !== customer.id) {
      log.warn("checkout.session_owner_mismatch", {
        sessionId,
        customerId: customer.id,
      });
      return null;
    }

    return session;
  } catch (error) {
    log.warn("checkout.session_lookup_failed", { sessionId, error });
    return null;
  }
}

/** Has the webhook for this session already landed and recorded a payment? */
export async function paymentForSession(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!intentId) return false;

  const payment = await db.payment.findUnique({
    where: { stripePaymentIntentId: intentId },
  });

  return payment?.status === "succeeded";
}
