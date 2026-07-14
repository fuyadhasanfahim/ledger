import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import {
  IconArrowRight,
  IconLock,
  IconLockOpen,
  IconClockPause,
} from "@tabler/icons-react";

import { ONE_TIME_PRODUCT } from "@/lib/catalog";
import { money, timestamp } from "@/lib/format";
import { accessFor } from "@/server/access";
import { currentCustomer } from "@/server/customers";
import { startOneTimeCheckout } from "@/server/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Eyebrow, Receipt, ReceiptRow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Premium access",
  description:
    "The gated page. Access is granted only by a verified webhook, and revoked the moment a payment is refunded or dunning is exhausted.",
};

export const dynamic = "force-dynamic";

/** Why the visitor is (or isn't) allowed in — phrased for a human. */
const REASON_COPY: Record<string, string> = {
  one_time_payment: "A one-time payment settled.",
  subscription_active: "Your subscription is active.",
  payment_failed: "Your last payment failed, so access was never granted.",
  refunded: "Your payment was refunded, so access was revoked.",
  subscription_canceled: "Your subscription ended.",
  dunning_exhausted:
    "Stripe exhausted its retry schedule on a failed invoice, so access was revoked.",
  never_granted: "You haven't bought anything yet.",
};

const statusSchema = z.enum(["success", "canceled"]).optional().catch(undefined);

export default async function PremiumPage(props: PageProps<"/premium">) {
  const params = await props.searchParams;

  const status = statusSchema.parse(
    Array.isArray(params.status) ? params.status[0] : params.status,
  );

  const customer = await currentCustomer();
  const access = customer
    ? await accessFor(customer.id)
    : { granted: false, reason: "never_granted" as const, grantedAt: null, revokedAt: null };

  return (
    <div className="shell-narrow section">
      <Eyebrow>access · gated content</Eyebrow>

      <h1 className="h1 mt-5 text-balance">
        {access.granted ? "You're in." : "Locked."}
      </h1>

      {/*
        The "returned from Checkout but the webhook hasn't landed yet" window.
        Access is deliberately NOT granted from this redirect — `?status=success`
        is attacker-controlled. Only the signed webhook moves the state, so we
        say "settling" and let the poll catch up.
      */}
      {status === "success" && !access.granted ? (
        <div className="card mt-8 flex items-start gap-3 border-pending/40 bg-pending-wash p-5">
          <IconClockPause
            size={18}
            className="mt-0.5 shrink-0 text-pending"
            aria-hidden
          />
          <div>
            <p className="font-mono text-sm text-pending">Settling…</p>
            <p className="mt-1 text-sm text-ink-soft">
              Checkout completed. Access appears when{" "}
              <span className="num">payment_intent.succeeded</span> arrives and
              is verified — usually a second or two. Refresh, or watch it land in
              the{" "}
              <Link href="/events" className="link text-ink">
                event log
              </Link>
              .
            </p>
            <p className="mt-2 font-mono text-xs text-ink-faint">
              We don&rsquo;t grant access from the redirect — a URL parameter
              isn&rsquo;t proof of payment.
            </p>
          </div>
        </div>
      ) : null}

      {status === "canceled" ? (
        <div className="card mt-8 border-rule-strong p-5">
          <p className="font-mono text-sm text-ink">Checkout canceled.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Nothing was charged. Start again whenever you like.
          </p>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ */}
      {access.granted ? (
        <>
          <div className="mt-8 flex items-center gap-3">
            <Badge tone="settled">
              <IconLockOpen size={12} aria-hidden />
              Access granted
            </Badge>
            {access.grantedAt ? (
              <span className="num text-xs text-ink-faint">
                since {timestamp(access.grantedAt)}
              </span>
            ) : null}
          </div>

          <div className="card mt-6 p-8">
            <Eyebrow>premium</Eyebrow>

            <h2 className="h2 mt-3">The part behind the paywall.</h2>

            <p className="prose-ink mt-4">
              This content is rendered on the server, and only after{" "}
              <span className="num text-ink">Access.granted</span> was checked
              against the database. It was never sent to your browser while you
              were locked out — a hidden <span className="num">div</span> isn&rsquo;t
              a paywall.
            </p>

            <p className="prose-ink mt-4">
              Now go take it away from yourself: open the{" "}
              <Link href="/admin" className="link text-ink">
                admin panel
              </Link>{" "}
              and refund the payment. The{" "}
              <span className="num text-ink">charge.refunded</span> webhook will
              revoke this page out from under you.
            </p>

            <Receipt className="mt-6">
              <ReceiptRow
                label="Reason"
                value={REASON_COPY[access.reason] ?? access.reason}
              />
              <ReceiptRow label="State" value="granted" total />
            </Receipt>
          </div>
        </>
      ) : (
        <>
          <div className="mt-8 flex items-center gap-3">
            <Badge tone="failed">
              <IconLock size={12} aria-hidden />
              No access
            </Badge>
          </div>

          <p className="prose-ink mt-6 text-lg">
            {REASON_COPY[access.reason] ?? "You don't have access."}
          </p>

          <div className="card mt-8 p-6">
            <Eyebrow>checkout · mode=payment</Eyebrow>

            <div className="mt-4 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <h2 className="h3">{ONE_TIME_PRODUCT.name}</h2>
                <p className="prose-ink mt-1 text-sm">
                  {ONE_TIME_PRODUCT.blurb}
                </p>
              </div>

              <p className="num shrink-0 text-3xl text-ink">
                {money(ONE_TIME_PRODUCT.amount)}
              </p>
            </div>

            <ActionForm action={startOneTimeCheckout} className="mt-6">
              <SubmitButton className="w-full sm:w-auto">
                Pay {money(ONE_TIME_PRODUCT.amount)} once
              </SubmitButton>
            </ActionForm>

            <p className="mt-4 font-mono text-xs text-ink-faint">
              Test mode. Use <span className="text-ink">4242 4242 4242 4242</span>{" "}
              to settle, or{" "}
              <Link href="/scenarios" className="link text-ink">
                pick a card that fails
              </Link>
              .
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/#plans" className="btn-secondary">
              Or subscribe instead
              <IconArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
