"use client";

import { useState } from "react";
import { issueRefund } from "@/server/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { money } from "@/lib/format";

/**
 * Refund control for one payment. Blank amount = full refund; a value = partial.
 *
 * The refundable ceiling is enforced server-side too (see server/refunds.ts) —
 * this max is a convenience, not the check.
 */
export function RefundForm({
  paymentId,
  refundable,
}: {
  paymentId: string;
  refundable: number;
}) {
  const [amount, setAmount] = useState("");

  if (refundable <= 0) {
    return (
      <span className="font-mono text-xs text-ink-faint">fully refunded</span>
    );
  }

  return (
    <ActionForm action={issueRefund} className="flex items-center gap-2">
      <input type="hidden" name="paymentId" value={paymentId} />

      <label htmlFor={`amount-${paymentId}`} className="sr-only">
        Refund amount in dollars (blank for full)
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
        placeholder={`${(refundable / 100).toFixed(2)}`}
        className="input w-24 px-2 py-1 text-xs"
      />

      <SubmitButton variant="danger" size="sm">
        {amount ? "Refund part" : `Refund ${money(refundable)}`}
      </SubmitButton>
    </ActionForm>
  );
}
