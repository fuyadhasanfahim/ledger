import "server-only";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/session";

/**
 * Authorisation check for every admin surface.
 *
 * The proxy already redirects unauthenticated visitors away from /admin, but
 * that is not sufficient on its own: Server Actions are POSTs to the page's own
 * route, and Next's docs are explicit that a matcher change or a refactor can
 * silently drop proxy coverage for them. So authorisation is asserted *here*,
 * next to the data, and every admin action calls this first.
 *
 * (`forbidden()` would be the more expressive interrupt, but it still sits
 * behind the experimental `authInterrupts` flag in Next 16 — not something to
 * hang a security boundary on. A redirect is stable and does the same job.)
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }
}

export async function adminOverview() {
  const [payments, subscriptions, customers] = await Promise.all([
    db.payment.findMany({
      orderBy: { createdAt: "desc" },
      include: { refunds: true },
      take: 50,
    }),
    db.subscription.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.customer.count(),
  ]);

  const grossSettled = payments
    .filter((p) => p.status === "succeeded" || p.status === "partially_refunded")
    .reduce((sum, p) => sum + p.amount, 0);

  const refunded = payments.reduce((sum, p) => sum + p.amountRefunded, 0);

  return {
    payments,
    subscriptions,
    customers,
    grossSettled,
    refunded,
    net: grossSettled - refunded,
  };
}
