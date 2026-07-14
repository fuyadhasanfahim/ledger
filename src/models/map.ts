import "server-only";

import type {
  AccessDoc,
  CustomerDoc,
  PaymentDoc,
  RefundDoc,
  SubscriptionDoc,
} from "@/models";
import type {
  Access,
  Customer,
  Payment,
  Refund,
  Subscription,
} from "@/lib/domain";

/**
 * Document → DTO.
 *
 * A Mongoose document cannot cross the server/client boundary: `_id` is an
 * ObjectId, and the document carries prototype methods. React would throw
 * ("only plain objects can be passed to Client Components"). Every service
 * returns a DTO from here rather than a raw document, so that boundary is
 * crossed in exactly one place instead of being rediscovered per page.
 */

export function toCustomer(doc: CustomerDoc): Customer {
  return {
    id: doc._id.toString(),
    sessionId: doc.sessionId,
    stripeCustomerId: doc.stripeCustomerId ?? null,
    email: doc.email ?? null,
    connectAccountId: doc.connectAccountId ?? null,
    connectOnboarded: doc.connectOnboarded,
    createdAt: doc.createdAt,
  };
}

export function toSubscription(doc: SubscriptionDoc): Subscription {
  return {
    id: doc._id.toString(),
    stripeSubId: doc.stripeSubId,
    customerId: doc.customerId.toString(),
    plan: doc.plan,
    stripePriceId: doc.stripePriceId ?? null,
    status: doc.status,
    currentPeriodEnd: doc.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: doc.cancelAtPeriodEnd,
    canceledAt: doc.canceledAt ?? null,
    createdAt: doc.createdAt,
  };
}

export function toPayment(doc: PaymentDoc): Payment {
  return {
    id: doc._id.toString(),
    stripePaymentIntentId: doc.stripePaymentIntentId,
    customerId: doc.customerId.toString(),
    amount: doc.amount,
    currency: doc.currency,
    status: doc.status,
    type: doc.type,
    description: doc.description ?? null,
    failureCode: doc.failureCode ?? null,
    failureMessage: doc.failureMessage ?? null,
    platformFee: doc.platformFee ?? null,
    sellerPayout: doc.sellerPayout ?? null,
    connectAccountId: doc.connectAccountId ?? null,
    amountRefunded: doc.amountRefunded,
    createdAt: doc.createdAt,
  };
}

export function toRefund(doc: RefundDoc): Refund {
  return {
    id: doc._id.toString(),
    stripeRefundId: doc.stripeRefundId,
    paymentId: doc.paymentId.toString(),
    amount: doc.amount,
    status: doc.status,
    reason: doc.reason ?? null,
    createdAt: doc.createdAt,
  };
}

export function toAccess(doc: AccessDoc | null): Access {
  return {
    granted: doc?.granted ?? false,
    reason: doc?.reason ?? "never_granted",
    grantedAt: doc?.grantedAt ?? null,
    revokedAt: doc?.revokedAt ?? null,
  };
}
