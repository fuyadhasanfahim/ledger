import Link from "next/link";
import {
  IconArrowRight,
  IconLock,
  IconReceiptRefund,
  IconRepeat,
  IconRouteAltLeft,
  IconShieldCheck,
} from "@tabler/icons-react";

import {
  MARKETPLACE_LISTING,
  ONE_TIME_PRODUCT,
  splitMarketplace,
} from "@/lib/catalog";
import { money } from "@/lib/format";
import { recentEvents, type FeedEvent } from "@/server/events";
import { EventFeed } from "@/components/event-feed";
import { PlanCards } from "@/components/plan-cards";
import { Eyebrow, Receipt, ReceiptRow, SectionHeading } from "@/components/ui";

// Reads the live event log, so it renders per request.
export const dynamic = "force-dynamic";

const CAPABILITIES = [
  {
    icon: IconShieldCheck,
    title: "Signed webhooks, verified on raw bytes",
    body: "Every event's HMAC is checked against the exact payload Stripe signed. An unsigned request is rejected before a single line of business logic runs.",
  },
  {
    icon: IconLock,
    title: "Idempotent by database constraint",
    body: "Event ids are claimed against a unique index, not an if-statement — the database settles the race, not application code. Replay the same event a hundred times and access is granted exactly once.",
  },
  {
    icon: IconRepeat,
    title: "Proration on plan change",
    body: "Upgrading mid-cycle bills only the difference; downgrading issues a credit. The subscription item is replaced, never appended — so nobody gets billed twice.",
  },
  {
    icon: IconReceiptRefund,
    title: "Refunds revoke access",
    body: "A refund isn't a status change, it's a state transition. charge.refunded arrives through the webhook and the entitlement disappears.",
  },
  {
    icon: IconRouteAltLeft,
    title: "Dunning that waits properly",
    body: "A failed subscription payment keeps access through Stripe's retry schedule, and only revokes it once the retries are genuinely exhausted.",
  },
] as const;

export default async function LandingPage() {
  let events: FeedEvent[] = [];

  // The landing page is the first thing anyone sees — it must render even
  // before the database is configured.
  try {
    events = await recentEvents(8);
  } catch {
    events = [];
  }

  const split = splitMarketplace(MARKETPLACE_LISTING.amount);

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="shell section">
        <div className="grid items-start gap-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <Eyebrow>stripe · test mode · live webhooks</Eyebrow>

            <h1 className="h1 mt-5 text-balance">
              Payments that settle
              <br />
              exactly as designed.
            </h1>

            <p className="prose-ink mt-6 max-w-xl text-pretty text-lg">
              A complete Stripe integration you can drive yourself. Subscribe,
              buy once, split a marketplace payment, force a decline, trigger a
              refund — and watch the webhook layer settle each one in real time.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/scenarios" className="btn-primary">
                Break it with a test card
                <IconArrowRight size={14} aria-hidden />
              </Link>

              <Link href="/events" className="btn-secondary">
                Watch the event log
              </Link>
            </div>

            <p className="mt-6 font-mono text-xs text-ink-faint">
              No signup. No real card. Your session is anonymous.
            </p>
          </div>

          {/* Receipt split panel — the design's signature device. */}
          <Receipt>
            <div className="receipt-row">
              <Eyebrow>receipt · marketplace</Eyebrow>
            </div>

            <ReceiptRow
              label={MARKETPLACE_LISTING.name}
              value={money(split.total)}
            />
            <ReceiptRow
              label="Platform fee · 10%"
              value={`− ${money(split.platformFee)}`}
            />
            <ReceiptRow label="Seller payout" value={money(split.sellerPayout)} />
            <ReceiptRow label="Settled" value="one charge" total />
          </Receipt>
        </div>
      </section>

      <hr className="rule" />

      {/* ---------------------------------------------------------------- */}
      {/* Plans                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section id="plans" className="shell section scroll-mt-20">
        <SectionHeading
          eyebrow="checkout · mode=subscription"
          title="Subscribe, then change your mind."
          intro="Both plans are real Stripe subscriptions. Upgrade and you'll see proration on the next invoice; cancel and you choose whether access ends now or at the end of the period you already paid for."
        />

        <PlanCards />

        <div className="card mt-8 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <Eyebrow>checkout · mode=payment</Eyebrow>
            <p className="h3 mt-2">
              {ONE_TIME_PRODUCT.name} — {money(ONE_TIME_PRODUCT.amount)} once
            </p>
            <p className="prose-ink mt-1 text-sm">{ONE_TIME_PRODUCT.blurb}</p>
          </div>

          <Link href="/premium" className="btn-secondary shrink-0">
            Buy once
            <IconArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </section>

      <hr className="rule" />

      {/* ---------------------------------------------------------------- */}
      {/* What runs under the hood                                          */}
      {/* ---------------------------------------------------------------- */}
      <section className="shell section">
        <SectionHeading
          eyebrow="architecture"
          title="What runs under the hood."
          intro="The parts of a payments integration that are easy to fake in a demo, and expensive to get wrong in production."
        />

        <div className="grid gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => {
            const Icon = capability.icon;

            return (
              <div key={capability.title} className="bg-paper-raised p-6">
                <Icon size={18} className="text-ink" aria-hidden />
                <h3 className="mt-4 font-display text-base font-medium text-ink">
                  {capability.title}
                </h3>
                <p className="prose-ink mt-2 text-sm">{capability.body}</p>
              </div>
            );
          })}

          <div className="flex flex-col justify-center bg-paper-sunk p-6">
            <Eyebrow>try it</Eyebrow>
            <p className="mt-2 text-sm text-ink-soft">
              Every claim on this page is checkable. Use a declining test card
              and confirm that access never appears.
            </p>
            <Link
              href="/scenarios"
              className="link mt-4 font-mono text-xs uppercase tracking-[0.12em] text-ink"
            >
              Test scenarios →
            </Link>
          </div>
        </div>
      </section>

      <hr className="rule" />

      {/* ---------------------------------------------------------------- */}
      {/* Live event log preview                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="shell section">
        <SectionHeading
          eyebrow="webhook · live"
          title="The event log, as it happens."
          intro="This is the real webhook feed, not a mock. Start a checkout in another tab and events land here within seconds — signature-verified, deduplicated, written to MongoDB."
        />

        <EventFeed initial={events} limit={8} />

        <div className="mt-6">
          <Link href="/events" className="btn-secondary">
            Full event log
            <IconArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </section>
    </>
  );
}
