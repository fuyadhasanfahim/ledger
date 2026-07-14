import type { Metadata } from "next";
import Link from "next/link";

import { connectDb } from "@/lib/db";
import { money, timestamp } from "@/lib/format";
import { currentCustomer } from "@/server/customers";
import { accessFor } from "@/server/access";
import { PaymentModel } from "@/models";
import { toPayment } from "@/models/map";
import { SuccessPanel } from "@/components/checkout/success-panel";
import { Empty, Eyebrow, Receipt, ReceiptRow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Payment complete",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The moment after payment.
 *
 * Deliberately careful: the browser arriving here proves nothing. Stripe's
 * redirect carries `?payment_intent=`, which anyone can type. So this page shows
 * the *settled* record from our database if the webhook has landed, and a
 * "settling…" state if it hasn't — it never grants anything on its own.
 */
export default async function SuccessPage() {
  const customer = await currentCustomer();

  if (!customer) {
    return (
      <div className="shell-narrow section">
        <Empty title="No session" hint="Enable cookies and reload." />
      </div>
    );
  }

  await connectDb();

  // The most recent settled payment for *this* customer. Scoped by customerId,
  // so the redirect's query string can't be used to look at someone else's.
  const doc = await PaymentModel.findOne({
    customerId: customer.id,
    status: { $in: ["succeeded", "partially_refunded"] },
  }).sort({ createdAt: -1 });

  const payment = doc ? toPayment(doc) : null;
  const access = await accessFor(customer.id);

  return (
    <div className="shell-narrow section">
      <SuccessPanel
        settled={payment !== null}
        granted={access.granted}
        paymentId={payment?.id ?? null}
      >
        {payment ? (
          <Receipt className="mt-8">
            <div className="receipt-row">
              <Eyebrow>receipt</Eyebrow>
            </div>

            <ReceiptRow
              label={payment.description ?? payment.type.replace("_", " ")}
              value={money(payment.amount)}
            />

            {payment.platformFee !== null ? (
              <ReceiptRow
                label="Platform fee"
                value={`− ${money(payment.platformFee)}`}
              />
            ) : null}

            {payment.sellerPayout !== null ? (
              <ReceiptRow
                label="Seller payout"
                value={money(payment.sellerPayout)}
              />
            ) : null}

            <ReceiptRow label="When" value={timestamp(payment.createdAt)} />
            <ReceiptRow
              label="Payment intent"
              value={payment.stripePaymentIntentId}
            />
            <ReceiptRow label="Paid" value={money(payment.amount)} total />
          </Receipt>
        ) : null}
      </SuccessPanel>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/premium" className="btn-secondary">
          Go to premium
        </Link>
        <Link href="/events" className="btn-ghost">
          Watch the webhook land
        </Link>
      </div>
    </div>
  );
}
