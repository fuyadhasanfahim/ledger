import "server-only";

import { AccessReason } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";

/**
 * Access is the *derived* state at the heart of this demo: it is never set by
 * the browser, only by webhook handlers reacting to what Stripe tells us
 * actually happened. Grant on settled money, revoke on refund / final dunning
 * failure / cancellation.
 */
export async function grantAccess(
  customerId: string,
  reason: Extract<
    AccessReason,
    "one_time_payment" | "subscription_active"
  >,
): Promise<void> {
  await db.access.upsert({
    where: { customerId },
    create: {
      customerId,
      granted: true,
      reason,
      grantedAt: new Date(),
    },
    update: {
      granted: true,
      reason,
      grantedAt: new Date(),
      revokedAt: null,
    },
  });

  log.info("access.granted", { customerId, reason });
}

export async function revokeAccess(
  customerId: string,
  reason: Extract<
    AccessReason,
    | "payment_failed"
    | "refunded"
    | "subscription_canceled"
    | "dunning_exhausted"
  >,
): Promise<void> {
  await db.access.upsert({
    where: { customerId },
    create: {
      customerId,
      granted: false,
      reason,
      revokedAt: new Date(),
    },
    update: {
      granted: false,
      reason,
      revokedAt: new Date(),
    },
  });

  log.info("access.revoked", { customerId, reason });
}

export interface AccessState {
  granted: boolean;
  reason: AccessReason;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

export async function accessFor(customerId: string): Promise<AccessState> {
  const row = await db.access.findUnique({ where: { customerId } });

  return {
    granted: row?.granted ?? false,
    reason: row?.reason ?? AccessReason.never_granted,
    grantedAt: row?.grantedAt ?? null,
    revokedAt: row?.revokedAt ?? null,
  };
}

/**
 * A customer keeps access if *any* source still justifies it. Called after a
 * revocation trigger so that, say, refunding a one-time payment doesn't strip
 * access from someone who also holds an active subscription.
 */
export async function reconcileAccess(customerId: string): Promise<void> {
  const [activeSub, settledPayment] = await Promise.all([
    db.subscription.findFirst({
      where: { customerId, status: { in: ["active", "trialing"] } },
    }),
    db.payment.findFirst({
      where: {
        customerId,
        type: "one_time",
        status: "succeeded",
      },
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

  // Nothing justifies access any more. Preserve the *reason* already recorded
  // by the caller (refund, dunning, cancellation) rather than overwriting it.
  const current = await db.access.findUnique({ where: { customerId } });
  if (current?.granted) {
    await revokeAccess(customerId, AccessReason.subscription_canceled);
  }
}
