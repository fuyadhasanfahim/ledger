"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { IconLoader2 } from "@tabler/icons-react";

import { issueRefund } from "@/server/actions";
import { money } from "@/lib/format";
import { FormError } from "@/components/ui";

/**
 * Refund control for one payment. Blank amount = full refund; a value = partial.
 *
 * The refundable ceiling is enforced server-side too (see server/refunds.ts) —
 * the `max` here is a convenience, not the check.
 *
 * On success the row does *not* change immediately, and that's correct: the
 * refund has been sent to Stripe, but nothing is written to our database until
 * `charge.refunded` comes back signed. So we say "settling" and let LiveRefresh
 * pull the real state in a moment, rather than optimistically drawing a refund
 * that might not have happened.
 */
export function RefundForm({
  paymentId,
  refundable,
}: {
  paymentId: string;
  refundable: number;
}) {
  const [state, formAction] = useActionState(issueRefund, null);
  const [amount, setAmount] = useState("");

  if (refundable <= 0) {
    return (
      <span className="font-mono text-xs text-ink-faint">fully refunded</span>
    );
  }

  // The action succeeded; we're now waiting on the webhook to land.
  if (state?.ok) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-pending">
        <IconLoader2 size={12} className="animate-spin" aria-hidden />
        settling…
      </span>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="paymentId" value={paymentId} />

      <label htmlFor={`amount-${paymentId}`} className="sr-only">
        Refund amount in dollars (blank for a full refund)
      </label>

      <input
        id={`amount-${paymentId}`}
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        max={(refundable / 100).toFixed(2)}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder={(refundable / 100).toFixed(2)}
        className="input w-24 px-2 py-1 text-xs"
      />

      <RefundButton amount={amount} refundable={refundable} />

      <FormError>{state?.error}</FormError>
    </form>
  );
}

/** Split out because useFormStatus only reports for a *parent* <form>. */
function RefundButton({
  amount,
  refundable,
}: {
  amount: string;
  refundable: number;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-danger btn-sm whitespace-nowrap"
      aria-busy={pending}
    >
      {pending ? (
        <IconLoader2 size={12} className="animate-spin" aria-hidden />
      ) : null}
      {amount ? "Refund part" : `Refund ${money(refundable)}`}
    </button>
  );
}
