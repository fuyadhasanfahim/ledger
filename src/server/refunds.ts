import "server-only";

import type { Payment } from "@/lib/domain";
import { connectDb } from "@/lib/db";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { PaymentModel } from "@/models";
import { toPayment } from "@/models/map";

export class RefundError extends Error {}

/**
 * Issue a refund against a settled payment. `amount` is in minor units; omit it
 * for a full refund.
 *
 * Access revocation is deliberately NOT done here — it happens when
 * `charge.refunded` comes back through the webhook, so the demo exercises the
 * same path a real dispute would take.
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
      // A double-clicked refund button must not refund twice. Keying on payment
      // + amount collapses the retry onto the same Stripe refund.
      idempotencyKey: `refund:${payment.id}:${amount ?? "full"}`,
    },
  );

  log.info("refund.created", {
    paymentId: payment.id,
    stripeRefundId: refund.id,
    amount: refund.amount,
  });
}

export async function paymentById(id: string): Promise<Payment | null> {
  await connectDb();
  const doc = await PaymentModel.findById(id);
  return doc ? toPayment(doc) : null;
}
