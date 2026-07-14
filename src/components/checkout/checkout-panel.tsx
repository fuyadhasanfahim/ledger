"use client";

import { useEffect, useState } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { IconLoader2 } from "@tabler/icons-react";

import { ledgerAppearance } from "@/components/checkout/appearance";
import { CheckoutForm } from "@/components/checkout/checkout-form";

/**
 * Boots Stripe.js and fetches the intent for this checkout mode.
 *
 * `loadStripe` sits at module scope on purpose — calling it inside the component
 * would re-download and re-initialise Stripe.js on every render.
 *
 * The publishable key is public by design; it can only *create* payments, never
 * read or refund. The secret key never leaves the server.
 */
const stripePromise: Promise<Stripe | null> = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
);

export type CheckoutMode =
  | { mode: "subscription"; plan: "monthly" | "yearly" }
  | { mode: "one_time" }
  | { mode: "marketplace" };

interface IntentResponse {
  clientSecret: string;
  amount: number;
  error?: string;
  detail?: string;
}

export function CheckoutPanel({
  request,
  label,
}: {
  request: CheckoutMode;
  label: string;
}) {
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        const data: IntentResponse = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          setError(data.detail ?? data.error ?? "Could not start checkout.");
          return;
        }

        setIntent(data);
      } catch {
        if (!cancelled) setError("Network error. Reload and try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // `request` is a fresh object literal each render at the call site, so it is
    // deliberately serialised — depending on the object identity would refetch
    // an intent on every render, and each one costs a Stripe API call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(request)]);

  if (error) {
    return (
      <div className="card border-failed/40 bg-failed-wash p-6">
        <p className="font-mono text-sm text-failed">Checkout unavailable</p>
        <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{error}</p>
      </div>
    );
  }

  if (!intent) {
    return (
      <div className="card flex items-center justify-center gap-2 p-14">
        <IconLoader2 size={16} className="animate-spin text-ink-faint" aria-hidden />
        <p className="font-mono text-xs text-ink-faint">Preparing checkout…</p>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: intent.clientSecret,
        appearance: ledgerAppearance,
        // Deliberately no `fonts` entry. Our fonts are self-hosted by next/font,
        // and the Element runs in Stripe's iframe where they don't exist — so
        // pulling JetBrains Mono in would mean a third-party font request from
        // inside the payment frame. The appearance falls back to the system
        // monospace, which is close enough and keeps the frame dependency-free.
      }}
    >
      <CheckoutForm
        clientSecret={intent.clientSecret}
        amount={intent.amount}
        label={label}
      />
    </Elements>
  );
}
