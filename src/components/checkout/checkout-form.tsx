"use client";

import { useState } from "react";
import {
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { motion } from "motion/react";
import { IconLoader2, IconLock, IconWand } from "@tabler/icons-react";

import { money } from "@/lib/format";
import { TestCardHint } from "@/components/checkout/test-card-hint";

/**
 * The themed checkout.
 *
 * One path: Stripe's Payment Element, styled through the Appearance API so it
 * reads as part of Ledger. The card number is typed into Stripe's own iframe and
 * never touches our origin.
 *
 * There is deliberately no "tap a card to autofill" control of our own. An
 * Element is a cross-origin iframe and cannot be filled from our JS — that
 * restriction is the whole reason the PAN stays off our server. Stripe ships its
 * own test-mode panel (bottom-right of the page) which *can* fill it, because it
 * runs inside Stripe's frame. We point at that instead of faking a worse version
 * of it.
 */
export function CheckoutForm({
  clientSecret,
  amount,
  label,
}: {
  clientSecret: string;
  amount: number;
  label: string;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(event: React.FormEvent) {
    event.preventDefault();

    if (!stripe || !elements) return;

    setBusy(true);
    setError(null);

    const { error: submitError } = await elements.submit();

    if (submitError) {
      setError(submitError.message ?? "Check the card details.");
      setBusy(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success`,
      },
    });

    // We only reach here if the redirect didn't happen — which means it failed.
    // A success navigates away, so there is no success branch to handle.
    if (confirmError) {
      setError(confirmError.message ?? "The payment could not be completed.");
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-rule px-6 py-3">
        <p className="eyebrow">
          <span aria-hidden>{"// "}</span>payment
        </p>
      </div>

      <form onSubmit={pay} className="p-6">
        <PaymentElement options={{ layout: "tabs" }} />

        <button
          type="submit"
          disabled={!stripe || busy}
          className="btn-primary mt-6 w-full"
        >
          {busy ? (
            <IconLoader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <IconLock size={14} aria-hidden />
          )}
          Pay {money(amount)} — {label}
        </button>

        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-card border border-failed/40 bg-failed-wash px-4 py-3 font-mono text-xs text-failed"
            role="alert"
          >
            {error}
          </motion.p>
        ) : null}

        {/* Stripe's own test-card panel is the only thing that can fill the
            Element. Tell people it's there rather than shipping a decoy. */}
        <p className="mt-5 flex items-start gap-2 font-mono text-[0.6875rem] leading-relaxed text-ink-faint">
          <IconWand size={13} className="mt-px shrink-0" aria-hidden />
          <span>
            Test mode. Stripe&rsquo;s card presets sit in the panel at the bottom
            right — pick one and it fills this form. Or copy a number below.
          </span>
        </p>
      </form>

      <TestCardHint />
    </div>
  );
}
