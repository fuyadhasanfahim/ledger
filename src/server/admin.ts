import "server-only";

import { redirect } from "next/navigation";
import { connectDb } from "@/lib/db";
import { isAdmin } from "@/lib/session";
import { CustomerModel, PaymentModel, SubscriptionModel } from "@/models";
import { toPayment, toSubscription } from "@/models/map";
import type { Payment, Subscription } from "@/lib/domain";

/**
 * Authorisation check for every admin surface.
 *
 * The proxy already redirects unauthenticated visitors away from /admin, but
 * that alone is not sufficient: a Server Action is a POST to the page's own
 * route, and Next's own docs warn that a matcher change or refactor can silently
 * drop proxy coverage for it. So authorisation is asserted here, next to the
 * data, and every admin action calls this first.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }
}

export interface AdminOverview {
  payments: Payment[];
  subscriptions: Subscription[];
  customers: number;
  grossSettled: number;
  refunded: number;
  net: number;
}

export async function adminOverview(): Promise<AdminOverview> {
  await connectDb();

  const [paymentDocs, subscriptionDocs, customers] = await Promise.all([
    PaymentModel.find().sort({ createdAt: -1 }).limit(50),
    SubscriptionModel.find().sort({ createdAt: -1 }).limit(50),
    CustomerModel.countDocuments(),
  ]);

  const payments = paymentDocs.map(toPayment);

  const grossSettled = payments
    .filter((p) => p.status === "succeeded" || p.status === "partially_refunded")
    .reduce((sum, p) => sum + p.amount, 0);

  const refunded = payments.reduce((sum, p) => sum + p.amountRefunded, 0);

  return {
    payments,
    subscriptions: subscriptionDocs.map(toSubscription),
    customers,
    grossSettled,
    refunded,
    net: grossSettled - refunded,
  };
}
