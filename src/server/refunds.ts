import "server-only";

import type { Payment } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

export class RefundError extends Error {}

/**
 * Issue a refund against a settled payment.
 *
 * `amount` is in minor units; omit it for a full refund. The resulting access
 * revocation is *not* done here — it happens when `charge.refunded` comes back
 * through the webhook, so the demo proves the same path a real dispute takes.
 */
export async function refundPayment(
  payment: Payment,
  amount?: number,
): Promise<void> {
  if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
    throw new RefundError(
      `Cannot refund a payment with status "${payment.status}".`,
    );
  }

  const refundable = payment.amount - payment.amountRefunded;

  if (refundable <= 0) {
    throw new RefundError("This payment is already fully refunded.");
  }

  if (amount !== undefined && amount > refundable) {
    throw new RefundError(
      `Refund exceeds the refundable balance of ${refundable} cents.`,
    );
  }

  const refund = await stripe().refunds.create(
    {
      payment_intent: payment.stripePaymentIntentId,
      ...(amount !== undefined ? { amount } : {}),
      metadata: { ledgerPaymentId: payment.id },
    },
    {
      // A double-clicked refund button must not refund twice. Keying on the
      // payment + amount means the retry collapses onto the same Stripe refund.
      idempotencyKey: `refund:${payment.id}:${amount ?? "full"}`,
    },
  );

  log.info("refund.created", {
    paymentId: payment.id,
    stripeRefundId: refund.id,
    amount: refund.amount,
  });
}

/** Payments an admin can act on. */
export async function refundablePayments() {
  return db.payment.findMany({
    where: { status: { in: ["succeeded", "partially_refunded"] } },
    orderBy: { createdAt: "desc" },
    include: { refunds: true, customer: true },
    take: 50,
  });
}
