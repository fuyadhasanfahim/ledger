import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { IconAlertTriangle, IconClockPause } from "@tabler/icons-react";

import { connectDb } from "@/lib/db";
import { PaymentModel } from "@/models";
import { toPayment } from "@/models/map";
import { PLANS, getPlan } from "@/lib/catalog";
import { money, timestamp } from "@/lib/format";
import { accessFor } from "@/server/access";
import { currentCustomer } from "@/server/customers";
import { activeSubscription } from "@/server/subscriptions";
import { recentEvents, type FeedEvent } from "@/server/events";
import { cancel, resume, switchPlan } from "@/server/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { EventFeed } from "@/components/event-feed";
import { LiveRefresh } from "@/components/live-refresh";
import { PlanCards } from "@/components/plan-cards";
import {
  Badge,
  Empty,
  Eyebrow,
  Receipt,
  ReceiptRow,
  SectionHeading,
  type Tone,
} from "@/components/ui";
import type { SubscriptionStatus } from "@/lib/domain";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your live subscription status, last payment, and access state — all derived from verified webhooks.",
};

export const dynamic = "force-dynamic";

/** How each Stripe subscription status should read and feel. */
const STATUS_META: Record<SubscriptionStatus, { tone: Tone; copy: string }> = {
  active: { tone: "settled", copy: "Billing normally." },
  trialing: { tone: "settled", copy: "In trial." },
  past_due: {
    tone: "pending",
    copy: "A payment failed. Stripe is retrying — you keep access while it does.",
  },
  unpaid: {
    tone: "failed",
    copy: "Stripe exhausted its retries. Access has been revoked.",
  },
  canceled: { tone: "failed", copy: "This subscription has ended." },
  incomplete: {
    tone: "pending",
    copy: "The first payment hasn't gone through yet.",
  },
  incomplete_expired: {
    tone: "failed",
    copy: "The first payment never completed and the subscription expired.",
  },
  paused: { tone: "pending", copy: "Paused." },
};

const statusSchema = z.enum(["success", "canceled"]).optional().catch(undefined);

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const params = await props.searchParams;

  const checkoutStatus = statusSchema.parse(
    Array.isArray(params.status) ? params.status[0] : params.status,
  );

  const customer = await currentCustomer();

  if (!customer) {
    return (
      <div className="shell-narrow section">
        <Empty
          title="No session"
          hint="Cookies are disabled, so there's nothing to attach a subscription to. Enable them and reload."
        />
      </div>
    );
  }

  await connectDb();

  const [subscription, access, lastPaymentDoc, events] = await Promise.all([
    activeSubscription(customer.id),
    accessFor(customer.id),
    PaymentModel.findOne({ customerId: customer.id }).sort({ createdAt: -1 }),
    recentEvents(10).catch((): FeedEvent[] => []),
  ]);

  const lastPayment = lastPaymentDoc ? toPayment(lastPaymentDoc) : null;

  const plan = subscription ? getPlan(subscription.plan) : undefined;
  const meta = subscription ? STATUS_META[subscription.status] : null;

  const otherPlan = PLANS.find((p) => p.id !== subscription?.plan);

  return (
    <div className="shell section">
      {/* Cancels and plan switches only land in our DB once Stripe's webhook
          confirms them — keep pulling until they do. */}
      <LiveRefresh />

      <div className="max-w-2xl">
        <Eyebrow>dashboard · live state</Eyebrow>
        <h1 className="h1 mt-5 text-balance">Where things stand.</h1>
        <p className="prose-ink mt-6 text-pretty">
          Everything below is derived from webhooks Stripe signed — never from
          what your browser claimed on the way back from Checkout.
        </p>
      </div>

      {checkoutStatus === "success" && !subscription ? (
        <div className="card mt-8 flex items-start gap-3 border-pending/40 bg-pending-wash p-5">
          <IconClockPause size={18} className="mt-0.5 shrink-0 text-pending" aria-hidden />
          <div>
            <p className="font-mono text-sm text-pending">Settling…</p>
            <p className="mt-1 text-sm text-ink-soft">
              Checkout completed. Your subscription appears here once{" "}
              <span className="num">invoice.paid</span> is verified. Refresh in a
              second.
            </p>
          </div>
        </div>
      ) : null}

      {checkoutStatus === "canceled" ? (
        <div className="card mt-8 border-rule-strong p-5">
          <p className="font-mono text-sm text-ink">Checkout canceled.</p>
          <p className="mt-1 text-sm text-ink-soft">Nothing was charged.</p>
        </div>
      ) : null}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* -------------------------------------------------------- */}
        {/* Subscription                                              */}
        {/* -------------------------------------------------------- */}
        <div>
          <div className="card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Eyebrow>subscription</Eyebrow>
                <h2 className="h3 mt-2">
                  {plan ? plan.name : subscription ? subscription.plan : "None"}
                </h2>
              </div>

              {subscription && meta ? (
                <Badge tone={meta.tone}>{subscription.status}</Badge>
              ) : (
                <Badge tone="failed" dot={false}>
                  inactive
                </Badge>
              )}
            </div>

            {subscription && meta ? (
              <>
                <p className="prose-ink mt-3 text-sm">{meta.copy}</p>

                {subscription.status === "past_due" ? (
                  <div className="mt-4 flex items-start gap-2 rounded-card border border-pending/40 bg-pending-wash p-3">
                    <IconAlertTriangle
                      size={15}
                      className="mt-0.5 shrink-0 text-pending"
                      aria-hidden
                    />
                    <p className="text-xs text-ink-soft">
                      Update your card to recover. If Stripe&rsquo;s retries run
                      out, access is revoked automatically.
                    </p>
                  </div>
                ) : null}

                <Receipt className="mt-5">
                  {plan ? (
                    <ReceiptRow
                      label="Price"
                      value={`${money(plan.amount)} / ${plan.interval}`}
                    />
                  ) : null}

                  <ReceiptRow
                    label={
                      subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"
                    }
                    value={
                      subscription.currentPeriodEnd
                        ? timestamp(subscription.currentPeriodEnd)
                        : "—"
                    }
                  />

                  <ReceiptRow
                    label="Subscription"
                    value={subscription.stripeSubId}
                  />
                </Receipt>

                {subscription.cancelAtPeriodEnd ? (
                  <div className="mt-5 rounded-card border border-pending/40 bg-pending-wash p-4">
                    <p className="font-mono text-xs text-pending">
                      Scheduled to cancel at the end of this period.
                    </p>
                    <ActionForm action={resume} className="mt-3">
                      <SubmitButton variant="secondary" size="sm">
                        Keep my subscription
                      </SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {otherPlan ? (
                      <ActionForm action={switchPlan}>
                        <input type="hidden" name="plan" value={otherPlan.id} />
                        <SubmitButton variant="secondary" size="sm">
                          Switch to {otherPlan.name}
                        </SubmitButton>
                      </ActionForm>
                    ) : null}

                    <ActionForm action={cancel}>
                      <input type="hidden" name="mode" value="at_period_end" />
                      <SubmitButton variant="ghost" size="sm">
                        Cancel at period end
                      </SubmitButton>
                    </ActionForm>

                    <ActionForm action={cancel}>
                      <input type="hidden" name="mode" value="immediate" />
                      <SubmitButton variant="danger" size="sm">
                        Cancel now
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}

                {otherPlan ? (
                  <p className="mt-4 font-mono text-xs text-ink-faint">
                    Switching prorates: you&rsquo;re billed (or credited) only
                    for the difference.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="mt-4">
                <p className="prose-ink text-sm">
                  You don&rsquo;t have a subscription yet.
                </p>
                <Link href="/#plans" className="btn-secondary btn-sm mt-4">
                  See plans
                </Link>
              </div>
            )}
          </div>

          {/* Last payment */}
          <div className="card mt-6 p-6">
            <Eyebrow>last payment</Eyebrow>

            {lastPayment ? (
              <Receipt className="mt-4">
                <ReceiptRow
                  label={lastPayment.type.replace("_", " ")}
                  value={money(lastPayment.amount)}
                />
                <ReceiptRow label="Status" value={lastPayment.status} />
                {lastPayment.failureMessage ? (
                  <ReceiptRow
                    label="Failure"
                    value={lastPayment.failureMessage}
                  />
                ) : null}
                {lastPayment.amountRefunded > 0 ? (
                  <ReceiptRow
                    label="Refunded"
                    value={`− ${money(lastPayment.amountRefunded)}`}
                  />
                ) : null}
                <ReceiptRow
                  label="When"
                  value={timestamp(lastPayment.createdAt)}
                  total
                />
              </Receipt>
            ) : (
              <p className="prose-ink mt-3 text-sm">No payments yet.</p>
            )}
          </div>
        </div>

        {/* -------------------------------------------------------- */}
        {/* Access + feed                                             */}
        {/* -------------------------------------------------------- */}
        <div className="space-y-6">
          <div className="card p-6">
            <Eyebrow>access</Eyebrow>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="h3">
                {access.granted ? "Granted" : "Revoked"}
              </p>
              <Badge tone={access.granted ? "settled" : "failed"}>
                {access.granted ? "open" : "locked"}
              </Badge>
            </div>

            <p className="prose-ink mt-3 text-sm">
              Reason:{" "}
              <span className="num text-ink">{access.reason}</span>
            </p>

            <Link href="/premium" className="btn-secondary btn-sm mt-5">
              Go to premium
            </Link>
          </div>

          <EventFeed initial={events} limit={10} />
        </div>
      </div>

      {/* ---------------------------------------------------------- */}
      {!subscription ? (
        <section className="mt-16">
          <SectionHeading
            eyebrow="checkout · mode=subscription"
            title="Start a subscription."
          />
          <PlanCards />
        </section>
      ) : null}
    </div>
  );
}
