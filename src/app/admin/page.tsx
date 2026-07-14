import type { Metadata } from "next";
import { IconLogout } from "@tabler/icons-react";

import { money, shortId, timestamp } from "@/lib/format";
import { adminOverview, requireAdmin } from "@/server/admin";
import { adminLogout } from "@/server/actions";
import { recentEvents, type FeedEvent } from "@/server/events";
import { EventFeed } from "@/components/event-feed";
import { LiveRefresh } from "@/components/live-refresh";
import { RefundForm } from "@/components/refund-form";
import { SubmitButton } from "@/components/action-form";
import {
  Badge,
  Empty,
  Eyebrow,
  Stat,
  TableWrap,
  type Tone,
} from "@/components/ui";
import type { PaymentStatus } from "@/lib/domain";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  succeeded: "settled",
  partially_refunded: "pending",
  refunded: "failed",
  failed: "failed",
  pending: "pending",
  requires_action: "pending",
};

export default async function AdminPage() {
  // The proxy already gated /admin, but a Server Action is a POST to this same
  // route — authorisation is re-asserted next to the data, not just at the edge.
  await requireAdmin();

  const overview = await adminOverview();
  const events = await recentEvents(15).catch((): FeedEvent[] => []);

  return (
    <div className="shell section">
      {/* Refunds settle via webhook a moment after the action returns, so the
          page re-asks the server until the new state shows up. */}
      <LiveRefresh />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>admin · test mode</Eyebrow>
          <h1 className="h1 mt-4">The other side of the counter.</h1>
        </div>

        <form action={adminLogout}>
          <SubmitButton variant="ghost" size="sm">
            <IconLogout size={14} aria-hidden />
            Sign out
          </SubmitButton>
        </form>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-4">
        <Stat label="Gross settled" value={money(overview.grossSettled)} tone="settled" />
        <Stat label="Refunded" value={money(overview.refunded)} tone="failed" />
        <Stat label="Net" value={money(overview.net)} />
        <Stat label="Customers" value={overview.customers} />
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Payments + refunds                                          */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-14">
        <Eyebrow>payments</Eyebrow>
        <h2 className="h2 mb-2 mt-3">Refund anything.</h2>
        <p className="prose-ink mb-6 max-w-2xl text-sm">
          A refund here goes to Stripe, comes back as{" "}
          <span className="num text-ink">charge.refunded</span>, and the handler
          revokes the customer&rsquo;s access. Nothing is revoked optimistically
          — the webhook is the source of truth, exactly as it would be for a real
          dispute.
        </p>

        {overview.payments.length === 0 ? (
          <Empty
            title="No payments yet"
            hint="Run a checkout with 4242 4242 4242 4242 and it'll appear here."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Payment intent</th>
                <th scope="col">Type</th>
                <th scope="col">Amount</th>
                <th scope="col">Refunded</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {overview.payments.map((payment) => {
                const refundable = payment.amount - payment.amountRefunded;
                const settled =
                  payment.status === "succeeded" ||
                  payment.status === "partially_refunded";

                return (
                  <tr key={payment.id}>
                    <td className="num whitespace-nowrap text-ink-faint">
                      {timestamp(payment.createdAt)}
                    </td>
                    <td className="num text-xs text-ink-soft">
                      {shortId(payment.stripePaymentIntentId, 12)}
                    </td>
                    <td className="font-mono text-xs">
                      {payment.type.replace("_", " ")}
                    </td>
                    <td className="num">{money(payment.amount)}</td>
                    <td className="num text-failed">
                      {payment.amountRefunded > 0
                        ? `− ${money(payment.amountRefunded)}`
                        : "—"}
                    </td>
                    <td>
                      <Badge tone={PAYMENT_TONE[payment.status]}>
                        {payment.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td>
                      {settled ? (
                        <RefundForm
                          paymentId={payment.id}
                          refundable={refundable}
                        />
                      ) : (
                        <span className="font-mono text-xs text-ink-faint">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Subscriptions                                               */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-14">
        <Eyebrow>subscriptions</Eyebrow>
        <h2 className="h2 mb-6 mt-3">Active billing</h2>

        {overview.subscriptions.length === 0 ? (
          <Empty title="No subscriptions yet" />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col">Created</th>
                <th scope="col">Subscription</th>
                <th scope="col">Plan</th>
                <th scope="col">Renews</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {overview.subscriptions.map((subscription) => (
                <tr key={subscription.id}>
                  <td className="num whitespace-nowrap text-ink-faint">
                    {timestamp(subscription.createdAt)}
                  </td>
                  <td className="num text-xs text-ink-soft">
                    {shortId(subscription.stripeSubId, 12)}
                  </td>
                  <td className="font-mono text-xs">{subscription.plan}</td>
                  <td className="num whitespace-nowrap text-xs">
                    {subscription.currentPeriodEnd
                      ? timestamp(subscription.currentPeriodEnd)
                      : "—"}
                  </td>
                  <td>
                    <Badge
                      tone={
                        subscription.status === "active" ||
                        subscription.status === "trialing"
                          ? "settled"
                          : subscription.status === "past_due"
                            ? "pending"
                            : "failed"
                      }
                    >
                      {subscription.status}
                      {subscription.cancelAtPeriodEnd ? " · ending" : ""}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      {/* ---------------------------------------------------------- */}
      <section className="mt-14">
        <Eyebrow>webhook · log</Eyebrow>
        <h2 className="h2 mb-6 mt-3">What Stripe told us</h2>
        <EventFeed initial={events} limit={15} />
      </section>
    </div>
  );
}
