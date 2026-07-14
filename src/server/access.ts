import "server-only";

import { AccessReason, type Access } from "@/lib/domain";
import { connectDb } from "@/lib/db";
import { log } from "@/lib/logger";
import { AccessModel, PaymentModel, SubscriptionModel } from "@/models";
import { toAccess } from "@/models/map";

/**
 * Access is the derived state at the heart of this demo: never set by the
 * browser, only by webhook handlers reacting to what Stripe says actually
 * happened. Granted on settled money; revoked on refund, final dunning failure,
 * or cancellation.
 */

type GrantReason = Extract<
  AccessReason,
  "one_time_payment" | "subscription_active"
>;

type RevokeReason = Extract<
  AccessReason,
  "payment_failed" | "refunded" | "subscription_canceled" | "dunning_exhausted"
>;

export async function grantAccess(
  customerId: string,
  reason: GrantReason,
): Promise<void> {
  await connectDb();

  await AccessModel.updateOne(
    { customerId },
    {
      $set: {
        granted: true,
        reason,
        grantedAt: new Date(),
        revokedAt: null,
      },
    },
    { upsert: true },
  );

  log.info("access.granted", { customerId, reason });
}

export async function revokeAccess(
  customerId: string,
  reason: RevokeReason,
): Promise<void> {
  await connectDb();

  await AccessModel.updateOne(
    { customerId },
    { $set: { granted: false, reason, revokedAt: new Date() } },
    { upsert: true },
  );

  log.info("access.revoked", { customerId, reason });
}

export async function accessFor(customerId: string): Promise<Access> {
  await connectDb();
  const doc = await AccessModel.findOne({ customerId });
  return toAccess(doc);
}

/**
 * A customer keeps access if *any* source still justifies it.
 *
 * Called after a revocation trigger, so that refunding a one-time payment
 * doesn't strip access from someone who also holds a live subscription (and
 * vice versa). Without this, the two flows would quietly fight each other.
 */
export async function reconcileAccess(customerId: string): Promise<void> {
  await connectDb();

  const [activeSub, settledPayment] = await Promise.all([
    SubscriptionModel.findOne({
      customerId,
      status: { $in: ["active", "trialing"] },
    }),
    PaymentModel.findOne({
      customerId,
      type: "one_time",
      status: "succeeded",
    }),
  ]);

  if (activeSub) {
    await grantAccess(customerId, AccessReason.subscription_active);
    return;
  }

  if (settledPayment) {
    await grantAccess(customerId, AccessReason.one_time_payment);
    return;
  }

  // Nothing justifies access any more. Only downgrade if they currently hold it —
  // and leave the reason the caller already recorded (refund, dunning) intact.
  const current = await AccessModel.findOne({ customerId });

  if (current?.granted) {
    await revokeAccess(customerId, AccessReason.subscription_canceled);
  }
}
