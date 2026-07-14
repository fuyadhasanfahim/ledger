import "server-only";

import type Stripe from "stripe";
import {
  PaymentStatus,
  PaymentType,
  SubscriptionStatus,
  type RefundStatus,
} from "@/lib/domain";
import { connectDb } from "@/lib/db";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import {
  CustomerModel,
  PaymentModel,
  RefundModel,
  SubscriptionModel,
} from "@/models";
import { grantAccess, reconcileAccess, revokeAccess } from "@/server/access";

/**
 * Webhook handlers.
 *
 * Rules every handler obeys:
 *  - They are the ONLY writers of money-derived state (payments, subscriptions,
 *    access). Nothing the browser says can grant access.
 *  - They are individually idempotent (upserts, never blind inserts), on top of
 *    the event-level dedupe in process.ts. Stripe guarantees at-least-once
 *    delivery, so "handled twice" must be indistinguishable from "handled once".
 *  - They return a human-readable summary — that string is what the live feed
 *    renders.
 */

export type Handler = (event: Stripe.Event) => Promise<string>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Resolve our customer id from metadata, falling back to the Stripe customer. */
async function resolveCustomerId(
  metadata: Stripe.Metadata | null | undefined,
  stripeCustomer?: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<string | null> {
  await connectDb();

  const fromMetadata = metadata?.ledgerCustomerId;

  if (fromMetadata) {
    const exists = await CustomerModel.exists({ _id: fromMetadata }).catch(
      // A malformed id (not a valid ObjectId) throws rather than returning null.
      () => null,
    );
    if (exists) return fromMetadata;
  }

  const id =
    typeof stripeCustomer === "string" ? stripeCustomer : stripeCustomer?.id;

  if (!id) return null;

  const doc = await CustomerModel.findOne({ stripeCustomerId: id }).select("_id");
  return doc ? doc._id.toString() : null;
}

/** Stripe moved period bounds onto the subscription *item* in recent API versions. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data[0];

  const seconds =
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;

  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

async function upsertSubscription(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const customerId = await resolveCustomerId(sub.metadata, sub.customer);
  if (!customerId) return null;

  await SubscriptionModel.updateOne(
    { stripeSubId: sub.id },
    {
      $set: {
        customerId,
        plan: sub.metadata?.plan ?? "unknown",
        stripePriceId: sub.items.data[0]?.price?.id ?? null,
        status: sub.status as SubscriptionStatus,
        currentPeriodEnd: periodEnd(sub),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      },
    },
    { upsert: true },
  );

  return customerId;
}

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

const checkoutCompleted: Handler = async (event) => {
  const session = event.data.object as Stripe.Checkout.Session;

  const customerId = await resolveCustomerId(session.metadata, session.customer);
  if (!customerId) return `checkout ${session.id} — no matching customer, ignored`;

  // Retained for completeness: we now use our own checkout page, so this only
  // fires if a hosted Checkout session is created elsewhere. The authoritative
  // events remain payment_intent.succeeded / invoice.paid.
  const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
  return `checkout completed — ${session.mode} for ${amount} USD`;
};

/* ------------------------------------------------------------------ */
/* Payment intents                                                     */
/* ------------------------------------------------------------------ */

const paymentSucceeded: Handler = async (event) => {
  const intent = event.data.object as Stripe.PaymentIntent;

  const customerId = await resolveCustomerId(intent.metadata, intent.customer);
  if (!customerId) return `payment_intent ${intent.id} — no matching customer, ignored`;

  const kind = intent.metadata?.type;

  const type: PaymentType =
    kind === "marketplace"
      ? PaymentType.marketplace
      : kind === "subscription"
        ? PaymentType.subscription
        : PaymentType.one_time;

  const amount = intent.amount_received || intent.amount;

  await PaymentModel.updateOne(
    { stripePaymentIntentId: intent.id },
    {
      $set: {
        customerId,
        amount,
        currency: intent.currency,
        status: PaymentStatus.succeeded,
        type,
        description: intent.description ?? null,
        failureCode: null,
        failureMessage: null,
        platformFee: intent.metadata?.platformFee
          ? Number(intent.metadata.platformFee)
          : null,
        sellerPayout: intent.metadata?.sellerPayout
          ? Number(intent.metadata.sellerPayout)
          : null,
        connectAccountId: intent.metadata?.connectAccountId ?? null,
      },
    },
    { upsert: true },
  );

  // A marketplace purchase is a transaction, not an entitlement — no access.
  if (type === PaymentType.one_time) {
    await grantAccess(customerId, "one_time_payment");
  }

  return `payment succeeded — ${(amount / 100).toFixed(2)} USD (${type})`;
};

const paymentFailed: Handler = async (event) => {
  const intent = event.data.object as Stripe.PaymentIntent;

  const customerId = await resolveCustomerId(intent.metadata, intent.customer);
  if (!customerId) return `payment_intent ${intent.id} — no matching customer, ignored`;

  const error = intent.last_payment_error;
  const kind = intent.metadata?.type;

  await PaymentModel.updateOne(
    { stripePaymentIntentId: intent.id },
    {
      $set: {
        customerId,
        amount: intent.amount,
        currency: intent.currency,
        status: PaymentStatus.failed,
        type:
          kind === "marketplace"
            ? PaymentType.marketplace
            : PaymentType.one_time,
        failureCode: error?.code ?? error?.decline_code ?? null,
        failureMessage: error?.message ?? null,
      },
    },
    { upsert: true },
  );

  // A failed attempt must never leave access behind.
  await reconcileAccess(customerId);

  const reason = error?.decline_code ?? error?.code ?? "unknown";
  return `payment failed — ${reason}`;
};

/* ------------------------------------------------------------------ */
/* Invoices (subscription billing + dunning)                           */
/* ------------------------------------------------------------------ */

/** The subscription id hangs off the invoice's line items in current API versions. */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const direct = (
    invoice as unknown as { subscription?: string | { id: string } }
  ).subscription;

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

  // Re-fetch: the invoice alone doesn't carry the subscription's current status
  // or period, and we want the authoritative version.
  const sub = await stripe().subscriptions.retrieve(subId);
  const customerId = await upsertSubscription(sub);

  if (!customerId) return "invoice paid — no matching customer, ignored";

  // Record the money that actually moved.
  const intentId = (invoice as unknown as { payment_intent?: unknown })
    .payment_intent;

  if (typeof intentId === "string" && invoice.amount_paid > 0) {
    await PaymentModel.updateOne(
      { stripePaymentIntentId: intentId },
      {
        $set: {
          customerId,
          amount: invoice.amount_paid,
          currency: invoice.currency,
          status: PaymentStatus.succeeded,
          type: PaymentType.subscription,
          description: `Invoice ${invoice.number ?? invoice.id}`,
        },
      },
      { upsert: true },
    );
  }

  if (sub.status === "active" || sub.status === "trialing") {
    await grantAccess(customerId, "subscription_active");
  }

  const amount = (invoice.amount_paid / 100).toFixed(2);
  return `invoice paid — ${amount} USD, subscription ${sub.status}`;
};

/**
 * Dunning.
 *
 * Stripe retries a failed subscription payment on a schedule, and the
 * subscription sits in `past_due` while it does. Access survives the retries —
 * we only revoke when Stripe gives up, which is exactly what
 * `next_payment_attempt === null` tells us. Revoking on the first failure would
 * lock out every customer whose card had a temporary hiccup.
 */
const invoicePaymentFailed: Handler = async (event) => {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = subscriptionIdFromInvoice(invoice);

  if (!subId) return `invoice ${invoice.id} — not subscription-related, ignored`;

  const sub = await stripe().subscriptions.retrieve(subId);
  const customerId = await upsertSubscription(sub);

  if (!customerId) return "invoice payment failed — no matching customer, ignored";

  const nextAttempt = invoice.next_payment_attempt;

  if (nextAttempt !== null && nextAttempt !== undefined) {
    const retryAt = new Date(nextAttempt * 1000);

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

  return "invoice payment failed — retries exhausted, access revoked";
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

  await SubscriptionModel.updateOne(
    { stripeSubId: sub.id },
    {
      $set: {
        status: SubscriptionStatus.canceled,
        canceledAt: new Date(),
      },
    },
  );

  // They may still hold a lifetime one-time payment — don't strip that.
  await reconcileAccess(customerId);

  return "subscription canceled — access reconciled";
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

  await connectDb();

  const payment = await PaymentModel.findOne({
    stripePaymentIntentId: intentId,
  });

  if (!payment) return `charge refunded — payment ${intentId} unknown, ignored`;

  const fullyRefunded = charge.amount_refunded >= payment.amount;

  await PaymentModel.updateOne(
    { _id: payment._id },
    {
      $set: {
        amountRefunded: charge.amount_refunded,
        status: fullyRefunded
          ? PaymentStatus.refunded
          : PaymentStatus.partially_refunded,
      },
    },
  );

  // Mirror each Stripe refund object into our own ledger.
  for (const refund of charge.refunds?.data ?? []) {
    await RefundModel.updateOne(
      { stripeRefundId: refund.id },
      {
        $set: {
          paymentId: payment._id,
          amount: refund.amount,
          status: (refund.status ?? "pending") as RefundStatus,
          reason: refund.reason ?? null,
        },
      },
      { upsert: true },
    );
  }

  const customerId = payment.customerId.toString();

  // A full refund on the entitlement-granting payment takes access away — but
  // reconcile afterwards, in case a live subscription still justifies it.
  if (fullyRefunded && payment.type === PaymentType.one_time) {
    await revokeAccess(customerId, "refunded");
    await reconcileAccess(customerId);
  }

  const amount = (charge.amount_refunded / 100).toFixed(2);
  return `charge refunded — ${amount} USD ${fullyRefunded ? "(full)" : "(partial)"}`;
};

/* ------------------------------------------------------------------ */
/* Connect                                                             */
/* ------------------------------------------------------------------ */

const applicationFeeCreated: Handler = async (event) => {
  const fee = event.data.object as Stripe.ApplicationFee;
  return `application fee collected — ${(fee.amount / 100).toFixed(2)} USD to the platform`;
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
