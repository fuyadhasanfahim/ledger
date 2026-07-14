/**
 * Static catalog: plans, the one-time product, the marketplace listing, and the
 * Stripe test-card scenarios.
 *
 * Safe to import from Client Components — there are no secrets here, only
 * public product shape and Stripe's *published* test card numbers.
 */

export type PlanId = "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  name: string;
  /** Minor units (cents). */
  amount: number;
  interval: "month" | "year";
  blurb: string;
  features: string[];
  /** Yearly is pitched against 12x monthly. */
  savingsPct?: number;
  featured?: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: "monthly",
    name: "Monthly",
    amount: 1200,
    interval: "month",
    blurb: "Billed every month. Cancel any time.",
    features: [
      "Full premium access",
      "Proration on upgrade",
      "Cancel now or at period end",
    ],
  },
  {
    id: "yearly",
    name: "Yearly",
    amount: 12000,
    interval: "year",
    blurb: "Two months free versus monthly.",
    features: [
      "Everything in Monthly",
      "12 months for the price of 10",
      "Downgrade with automatic credit",
    ],
    savingsPct: 17,
    featured: true,
  },
] as const;

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** The single one-time purchase. */
export const ONE_TIME_PRODUCT = {
  id: "lifetime",
  name: "Lifetime Access",
  amount: 4900,
  blurb: "A single charge. Access is granted the moment the webhook settles.",
} as const;

/** The marketplace listing — payment splits between platform and seller. */
export const MARKETPLACE_LISTING = {
  id: "consultation",
  name: "Integration Review",
  amount: 25000,
  /** Platform takes 10%; the connected seller receives the rest. */
  platformFeePct: 0.1,
  blurb: "A one-hour payments architecture review, sold by a connected seller.",
} as const;

export function splitMarketplace(amount: number) {
  const platformFee = Math.round(amount * MARKETPLACE_LISTING.platformFeePct);
  return { total: amount, platformFee, sellerPayout: amount - platformFee };
}

/* ------------------------------------------------------------------ */
/* Test card scenarios                                                 */
/* ------------------------------------------------------------------ */

export type ScenarioTone = "settled" | "pending" | "failed";

export interface Scenario {
  number: string;
  triggers: string;
  outcome: string;
  tone: ScenarioTone;
}

/**
 * Stripe's official test cards. Each one is a scenario a client can run to
 * force a specific branch of the integration.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    number: "4242 4242 4242 4242",
    triggers: "Successful payment",
    outcome:
      "Charge settles. payment_intent.succeeded lands, access is granted, the ledger shows a settled row.",
    tone: "settled",
  },
  {
    number: "4000 0000 0000 9995",
    triggers: "Declined — insufficient funds",
    outcome:
      "Charge is refused at authorisation. payment_intent.payment_failed lands with a decline code. No access.",
    tone: "failed",
  },
  {
    number: "4000 0000 0000 0002",
    triggers: "Declined — generic",
    outcome:
      "A flat card_declined. The failure surfaces with Stripe's reason attached, and access is never granted.",
    tone: "failed",
  },
  {
    number: "4000 0025 0000 3155",
    triggers: "Requires authentication (3DS)",
    outcome:
      "Checkout interrupts for a 3D Secure challenge. Complete it and it settles; abandon it and the intent stays unconfirmed.",
    tone: "pending",
  },
  {
    number: "4000 0000 0000 0341",
    triggers: "Attaches, then fails on charge",
    outcome:
      "The card attaches to the customer but the charge fails. This is the case that breaks naive integrations — the subscription exists, the money never arrives.",
    tone: "failed",
  },
  {
    number: "4000 0000 0000 0259",
    triggers: "Settles, then disputes",
    outcome:
      "Payment succeeds and is later disputed as fraudulent. Refund it from the admin panel and watch access get revoked.",
    tone: "pending",
  },
] as const;

/** `4242 4242 4242 4242` → `4242424242424242` */
export function bareNumber(n: string): string {
  return n.replaceAll(" ", "");
}
