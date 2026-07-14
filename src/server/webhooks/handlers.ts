import "server-only";

import type Stripe from "stripe";
import {
  PaymentStatus,
  PaymentType,
  RefundStatus,
  SubscriptionStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { grantAccess, reconcileAccess, revokeAccess } from "@/server/access";

/**
 * Webhook handlers.
 *
 * Rules every handler obeys:
 *  - They are the ONLY writers of money-derived state (payments, subscriptions,
 *    access). Nothing the browser says can grant access.
 *  - They are individually idempotent (upserts, not inserts), on top of the
 *    event-level dedupe in process.ts. Stripe guarantees at-least-once delivery,
 *    so "handled twice" must be indistinguishable from "handled once".
 *  - They return a human-readable summary, which is what the live event feed
 *    renders.
 */

export type Handler = (event: Stripe.Event) => Promise<string>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Resolve our customer id from an object's metadata, falling back to the Stripe customer. */
async function resolveCustomerId(
  metadata: Stripe.Metadata | null | undefined,
  stripeCustomerId?: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<string | null> {
  const fromMetadata = metadata?.ledgerCustomerId;
  if (fromMetadata) {
    const exists = await db.customer.findUnique({
      where: { id: fromMetadata },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  const id =
    typeof stripeCustomerId === "string"
      ? stripeCustomerId
      : stripeCustomerId?.id;

  if (!id) return null;

  const byStripe = await db.customer.findUnique({
    where: { stripeCustomerId: id },
    select: { id: true },
  });

  return byStripe?.id ?? null;
}

function mapSubStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  // Stripe's status strings and our enum are deliberately 1:1.
  return status as SubscriptionStatus;
}

/** Stripe moved period bounds onto the subscription *item* in recent API versions. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data[0];
  const seconds =
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;

  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

async function upsertSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const customerId = await resolveCustomerId(sub.metadata, sub.customer);
  if (!customerId) return null;

  const status = mapSubStatus(sub.status);
  const plan = sub.metadata?.plan ?? "unknown";

  await db.subscription.upsert({
    where: { stripeSubId: sub.id },
    create: {
      stripeSubId: sub.id,
      customerId,
      plan,
      stripePriceId: sub.items.data[0]?.price?.id ?? null,
      status,
      currentPeriodEnd: periodEnd(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
    update: {
      status,
      plan,
      stripePriceId: sub.items.data[0]?.price?.id ?? null,
      currentPeriodEnd: periodEnd(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
  });

  return customerId;
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

const checkoutCompleted: Handler = async (event) => {
  const session = event.data.object as Stripe.Checkout.Session;

  const customerId = await resolveCustomerId(session.metadata, session.customer);
  if (!customerId) return `checkout ${session.id} — no matching customer, ignored`;

  // A subscription checkout is settled by invoice.paid, not here: the session
  // completing only means the customer finished the form.
  if (session.mode === "subscription") {
    return `checkout completed — subscription started for customer ${customerId}`;
  }

  // For one-time / marketplace, the payment_intent.succeeded event carries the
  // authoritative amount, so we only record intent here.
  const amount = session.amount_total ?? 0;

  return `checkout completed — ${session.mode} for ${(amount / 100).toFixed(2)} USD`;
};

/* ------------------------------------------------------------------ */
/* Payment intents                                                     */
/* ------------------------------------------------------------------ */

const paymentSucceeded: Handler = async (event) => {
  const intent = event.data.object as Stripe.PaymentIntent;

  const customerId = await resolveCustomerId(intent.metadata, intent.customer);
  if (!customerId) {
    return `payment_intent ${intent.id} — no matching customer, ignored`;
  }

  const kind = intent.metadata?.type;
  const type: PaymentType =
    kind === "marketplace" ? PaymentType.marketplace : PaymentType.one_time;

  const platformFee = intent.metadata?.platformFee
    ? Number(intent.metadata.platformFee)
    : null;
  const sellerPayout = intent.metadata?.sellerPayout
    ? Number(intent.metadata.sellerPayout)
    : null;

  await db.payment.upsert({
    where: { stripePaymentIntentId: intent.id },
    create: {
      stripePaymentIntentId: intent.id,
      customerId,
      amount: intent.amount_received || intent.amount,
      currency: intent.currency,
      status: PaymentStatus.succeeded,
      type,
      description: intent.description ?? null,
      platformFee,
      sellerPayout,
      connectAccountId: intent.metadata?.connectAccountId ?? null,
    },
    update: {
      status: PaymentStatus.succeeded,
      amount: intent.amount_received || intent.amount,
      failureCode: null,
      failureMessage: null,
    },
  });

  // A marketplace purchase is a transaction, not an entitlement — no access.
  if (type === PaymentType.one_time) {
    await grantAccess(customerId, "one_time_payment");
  }

  const amount = ((intent.amount_received || intent.amount) / 100).toFixed(2);
  return `payment succeeded — ${amount} USD (${type})`;
};

const paymentFailed: Handler = async (event) => {
  const intent = event.data.object as Stripe.PaymentIntent;

  const customerId = await resolveCustomerId(intent.metadata, intent.customer);
  if (!customerId) {
    return `payment_intent ${intent.id} — no matching customer, ignored`;
  }

  const error = intent.last_payment_error;
  const kind = intent.metadata?.type;

  await db.payment.upsert({
    where: { stripePaymentIntentId: intent.id },
    create: {
      stripePaymentIntentId: intent.id,
      customerId,
      amount: intent.amount,
      currency: intent.currency,
      status: PaymentStatus.failed,
      type:
        kind === "marketplace" ? PaymentType.marketplace : PaymentType.one_time,
      failureCode: error?.code ?? error?.decline_code ?? null,
      failureMessage: error?.message ?? null,
    },
    update: {
      status: PaymentStatus.failed,
      failureCode: error?.code ?? error?.decline_code ?? null,
      failureMessage: error?.message ?? null,
    },
  });

  // A failed one-time attempt must never leave access behind.
  await reconcileAccess(customerId);

  const reason = error?.decline_code ?? error?.code ?? "unknown";
  return `payment failed — ${reason}`;
};

/* ------------------------------------------------------------------ */
/* Invoices (subscription billing + dunning)                           */
/* ------------------------------------------------------------------ */

/** The subscription id hangs off the invoice's line items in current API versions. */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as unknown as { subscription?: string | { id: string } })
    .subscription;

  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") return direct.id;

  for (const line of invoice.lines?.data ?? []) {
    const parent = (
      line as unknown as {
        parent?: { subscription_item_details?: { subscription?: string } };
      }
    ).parent;

    const id = parent?.subscription_item_details?.subscription;
    if (typeof id === "string") return id;
  }

  return null;
}

const invoicePaid: Handler = async (event) => {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = subscriptionIdFromInvoice(invoice);

  if (!subId) return `invoice ${invoice.id} — not subscription-related, ignored`;

  // Re-fetch the subscription: the invoice alone doesn't carry the current
  // status/period, and we want the authoritative version.
  const sub = await stripe().subscriptions.retrieve(subId);
  const customerId = await upsertSubscription(sub);

  if (!customerId) return `invoice paid — no matching customer, ignored`;

  // Record the money that actually moved.
  const intentId =
    typeof (invoice as unknown as { payment_intent?: string }).payment_intent ===
    "string"
      ? (invoice as unknown as { payment_intent: string }).payment_intent
      : null;

  if (intentId && invoice.amount_paid > 0) {
    await db.payment.upsert({
      where: { stripePaymentIntentId: intentId },
      create: {
        stripePaymentIntentId: intentId,
        customerId,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: PaymentStatus.succeeded,
        type: PaymentType.subscription,
        description: `Invoice ${invoice.number ?? invoice.id}`,
      },
      update: { status: PaymentStatus.succeeded },
    });
  }

  if (sub.status === "active" || sub.status === "trialing") {
    await grantAccess(customerId, "subscription_active");
  }

  const amount = (invoice.amount_paid / 100).toFixed(2);
  return `invoice paid — ${amount} USD, subscription ${sub.status}`;
};

/**
 * Dunning. Stripe retries a failed subscription payment on a schedule; the
 * subscription sits in `past_due` while it does. Access survives the retries —
 * we only revoke when Stripe gives up (`unpaid`/`canceled`), which is what
 * `next_payment_attempt === null` tells us.
 */
const invoicePaymentFailed: Handler = async (event) => {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = subscriptionIdFromInvoice(invoice);

  if (!subId) return `invoice ${invoice.id} — not subscription-related, ignored`;

  const sub = await stripe().subscriptions.retrieve(subId);
  const customerId = await upsertSubscription(sub);

  if (!customerId) return `invoice payment failed — no matching customer, ignored`;

  const willRetry = invoice.next_payment_attempt !== null;

  if (willRetry) {
    // Keep access during the retry window; the UI nags them to fix the card.
    const retryAt = new Date(invoice.next_payment_attempt! * 1000);

    log.warn("dunning.retry_scheduled", {
      customerId,
      subscriptionId: sub.id,
      retryAt,
    });

    return `invoice payment failed — retrying ${retryAt.toISOString()}, access retained`;
  }

  // Stripe has exhausted its retries. This is the terminal failure.
  await revokeAccess(customerId, "dunning_exhausted");

  log.warn("dunning.exhausted", { customerId, subscriptionId: sub.id });

  return `invoice payment failed — retries exhausted, access revoked`;
};

/* ------------------------------------------------------------------ */
/* Subscription lifecycle                                              */
/* ------------------------------------------------------------------ */

const subscriptionUpserted: Handler = async (event) => {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = await upsertSubscription(sub);

  if (!customerId) return `subscription ${sub.id} — no matching customer, ignored`;

  if (sub.status === "active" || sub.status === "trialing") {
    await grantAccess(customerId, "subscription_active");
  } else if (sub.status === "canceled" || sub.status === "unpaid") {
    await reconcileAccess(customerId);
  }

  const scheduled = sub.cancel_at_period_end ? ", cancels at period end" : "";
  return `subscription ${event.type.split(".").pop()} — ${sub.status}${scheduled}`;
};

const subscriptionDeleted: Handler = async (event) => {
  const sub = event.data.object as Stripe.Subscription;

  const customerId = await resolveCustomerId(sub.metadata, sub.customer);
  if (!customerId) return `subscription ${sub.id} — no matching customer, ignored`;

  await db.subscription.updateMany({
    where: { stripeSubId: sub.id },
    data: {
      status: SubscriptionStatus.canceled,
      canceledAt: new Date(),
    },
  });

  // They may still hold a lifetime one-time payment — don't strip that.
  await reconcileAccess(customerId);

  return `subscription canceled — access reconciled`;
};

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

const chargeRefunded: Handler = async (event) => {
  const charge = event.data.object as Stripe.Charge;

  const intentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!intentId) return `charge ${charge.id} — no payment intent, ignored`;

  const payment = await db.payment.findUnique({
    where: { stripePaymentIntentId: intentId },
  });

  if (!payment) return `charge refunded — payment ${intentId} unknown, ignored`;

  const fullyRefunded = charge.amount_refunded >= payment.amount;

  await db.payment.update({
    where: { id: payment.id },
    data: {
      amountRefunded: charge.amount_refunded,
      status: fullyRefunded
        ? PaymentStatus.refunded
        : PaymentStatus.partially_refunded,
    },
  });

  // Mirror each Stripe refund object into our ledger.
  const refunds = charge.refunds?.data ?? [];
  for (const refund of refunds) {
    await db.refund.upsert({
      where: { stripeRefundId: refund.id },
      create: {
        stripeRefundId: refund.id,
        paymentId: payment.id,
        amount: refund.amount,
        status: (refund.status ?? "pending") as RefundStatus,
        reason: refund.reason ?? null,
      },
      update: {
        status: (refund.status ?? "pending") as RefundStatus,
      },
    });
  }

  // A full refund on the entitlement-granting payment takes access away.
  if (fullyRefunded && payment.type === PaymentType.one_time) {
    await revokeAccess(payment.customerId, "refunded");
    await reconcileAccess(payment.customerId);
  }

  const amount = (charge.amount_refunded / 100).toFixed(2);
  return `charge refunded — ${amount} USD ${fullyRefunded ? "(full)" : "(partial)"}`;
};

/* ------------------------------------------------------------------ */
/* Connect                                                             */
/* ------------------------------------------------------------------ */

const applicationFeeCreated: Handler = async (event) => {
  const fee = event.data.object as Stripe.ApplicationFee;
  const amount = (fee.amount / 100).toFixed(2);

  return `application fee collected — ${amount} USD to the platform`;
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const HANDLERS: Record<string, Handler> = {
  "checkout.session.completed": checkoutCompleted,

  "payment_intent.succeeded": paymentSucceeded,
  "payment_intent.payment_failed": paymentFailed,

  "invoice.paid": invoicePaid,
  "invoice.payment_failed": invoicePaymentFailed,

  "customer.subscription.created": subscriptionUpserted,
  "customer.subscription.updated": subscriptionUpserted,
  "customer.subscription.deleted": subscriptionDeleted,

  "charge.refunded": chargeRefunded,

  "application_fee.created": applicationFeeCreated,
};

/** Event types we knowingly ignore, so the log can say "ignored" not "unhandled". */
export function isHandled(type: string): boolean {
  return type in HANDLERS;
}
