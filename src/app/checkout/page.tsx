import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { IconArrowLeft } from "@tabler/icons-react";

import {
  MARKETPLACE_LISTING,
  ONE_TIME_PRODUCT,
  getPlan,
  splitMarketplace,
} from "@/lib/catalog";
import { money } from "@/lib/format";
import { currentCustomer } from "@/server/customers";
import { CheckoutPanel, type CheckoutMode } from "@/components/checkout/checkout-panel";
import { Empty, Eyebrow, Receipt, ReceiptRow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Our own checkout. `?mode=` picks the flow, and it is attacker-controlled — so
 * it goes through Zod like any other untrusted input, with `.catch()` falling
 * back rather than throwing on junk.
 */
const paramsSchema = z.object({
  mode: z.enum(["subscription", "one_time", "marketplace"]).catch("one_time"),
  plan: z.enum(["monthly", "yearly"]).catch("monthly"),
});

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CheckoutPage(props: PageProps<"/checkout">) {
  const raw = await props.searchParams;

  const { mode, plan } = paramsSchema.parse({
    mode: first(raw.mode),
    plan: first(raw.plan),
  });

  const customer = await currentCustomer();

  if (!customer) {
    return (
      <div className="shell-narrow section">
        <Empty
          title="No session"
          hint="Cookies are disabled, so there's nothing to attach a payment to. Enable them and reload."
        />
      </div>
    );
  }

  if (mode === "marketplace" && !customer.connectAccountId) {
    return (
      <div className="shell-narrow section">
        <Empty
          title="No seller yet"
          hint="A marketplace payment needs a connected account to pay out to. Onboard one first."
          action={
            <Link href="/connect" className="btn-primary mt-2">
              Onboard a seller
            </Link>
          }
        />
      </div>
    );
  }

  /* ---- What are we selling on this page? --------------------------- */
  const summary = buildSummary(mode, plan);

  const request: CheckoutMode =
    mode === "subscription"
      ? { mode: "subscription", plan }
      : mode === "marketplace"
        ? { mode: "marketplace" }
        : { mode: "one_time" };

  return (
    <div className="shell-narrow section">
      <Link
        href={mode === "marketplace" ? "/connect" : "/"}
        className="btn-ghost btn-sm -ml-3 mb-6"
      >
        <IconArrowLeft size={13} aria-hidden />
        Back
      </Link>

      <Eyebrow>checkout · mode={mode}</Eyebrow>
      <h1 className="h1 mt-4 text-balance">{summary.title}</h1>
      <p className="prose-ink mt-4 text-pretty">{summary.blurb}</p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        {/* ---- Receipt ------------------------------------------------ */}
        <Receipt>
          <div className="receipt-row">
            <Eyebrow>order</Eyebrow>
          </div>

          {summary.lines.map((line) => (
            <ReceiptRow key={line.label} label={line.label} value={line.value} />
          ))}

          <ReceiptRow label="Total" value={money(summary.total)} total />
        </Receipt>

        {/* ---- Payment ------------------------------------------------ */}
        <CheckoutPanel request={request} label={summary.short} />
      </div>
    </div>
  );
}

function buildSummary(
  mode: "subscription" | "one_time" | "marketplace",
  planId: "monthly" | "yearly",
) {
  if (mode === "subscription") {
    const plan = getPlan(planId)!;

    return {
      title: `Subscribe — ${plan.name}.`,
      short: plan.name,
      blurb:
        "A real Stripe subscription. The first invoice is confirmed right here; renewals happen on Stripe's schedule, and every one of them arrives back as a webhook.",
      total: plan.amount,
      lines: [
        { label: `Ledger ${plan.name}`, value: money(plan.amount) },
        { label: "Billing", value: `every ${plan.interval}` },
        { label: "Cancel", value: "any time" },
      ],
    };
  }

  if (mode === "marketplace") {
    const split = splitMarketplace(MARKETPLACE_LISTING.amount);

    return {
      title: "One charge, split two ways.",
      short: MARKETPLACE_LISTING.name,
      blurb:
        "A Connect destination charge. The platform keeps its fee and Stripe transfers the rest to the seller — atomically, on a single payment.",
      total: split.total,
      lines: [
        { label: MARKETPLACE_LISTING.name, value: money(split.total) },
        { label: "Platform fee · 10%", value: `− ${money(split.platformFee)}` },
        { label: "Seller receives", value: money(split.sellerPayout) },
      ],
    };
  }

  return {
    title: "One payment. Then it's yours.",
    short: ONE_TIME_PRODUCT.name,
    blurb:
      "A single charge. Access appears the moment the signed webhook settles — not the moment your browser comes back.",
    total: ONE_TIME_PRODUCT.amount,
    lines: [
      { label: ONE_TIME_PRODUCT.name, value: money(ONE_TIME_PRODUCT.amount) },
      { label: "Billing", value: "once" },
    ],
  };
}
