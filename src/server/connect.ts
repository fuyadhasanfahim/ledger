import "server-only";

import type { Customer } from "@/lib/domain";
import { connectDb } from "@/lib/db";
import { CustomerModel } from "@/models";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

/**
 * Stripe Connect (Express) — the marketplace seller.
 *
 * In this demo the visitor plays both sides: they onboard a test Express
 * account as "the seller", then buy from it. The point is to show the split on
 * a single payment: total → platform fee + seller payout.
 */
export async function ensureConnectAccount(
  customer: Customer,
): Promise<string> {
  if (customer.connectAccountId) return customer.connectAccountId;

  const account = await stripe().accounts.create(
    {
      type: "express",
      metadata: { ledgerCustomerId: customer.id },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    },
    { idempotencyKey: `connect:${customer.id}` },
  );

  await connectDb();
  await CustomerModel.updateOne(
    { _id: customer.id },
    { $set: { connectAccountId: account.id } },
  );

  log.info("connect.account_created", {
    customerId: customer.id,
    accountId: account.id,
  });

  return account.id;
}

/**
 * A single-use onboarding link. These expire quickly, so we mint a fresh one
 * every time rather than storing it.
 */
export async function onboardingLink(customer: Customer): Promise<string> {
  const accountId = await ensureConnectAccount(customer);
  const base = env().APP_URL;

  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${base}/connect?status=refresh`,
    return_url: `${base}/connect?status=onboarded`,
  });

  return link.url;
}

export interface ConnectStatus {
  accountId: string | null;
  onboarded: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
}

/**
 * Ask Stripe for the live state of the connected account rather than trusting
 * our cached flag — onboarding can complete or lapse outside our app.
 */
export async function connectStatus(
  customer: Customer,
): Promise<ConnectStatus> {
  if (!customer.connectAccountId) {
    return {
      accountId: null,
      onboarded: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      requirementsDue: [],
    };
  }

  try {
    const account = await stripe().accounts.retrieve(customer.connectAccountId);

    const onboarded = Boolean(
      account.details_submitted && account.charges_enabled,
    );

    // Keep the cached flag honest.
    if (onboarded !== customer.connectOnboarded) {
      await connectDb();
      await CustomerModel.updateOne(
        { _id: customer.id },
        { $set: { connectOnboarded: onboarded } },
      );
    }

    return {
      accountId: account.id,
      onboarded,
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      requirementsDue: account.requirements?.currently_due ?? [],
    };
  } catch (error) {
    log.warn("connect.status_lookup_failed", {
      customerId: customer.id,
      error,
    });

    return {
      accountId: customer.connectAccountId,
      onboarded: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      requirementsDue: [],
    };
  }
}
