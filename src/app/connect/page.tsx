import type { Metadata } from "next";
import { z } from "zod";
import { IconBuildingStore, IconCheck, IconExternalLink } from "@tabler/icons-react";

import { db } from "@/lib/db";
import { MARKETPLACE_LISTING, splitMarketplace } from "@/lib/catalog";
import { money, timestamp } from "@/lib/format";
import { currentCustomer } from "@/server/customers";
import { connectStatus } from "@/server/connect";
import { startConnectOnboarding, startMarketplaceCheckout } from "@/server/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  Badge,
  Empty,
  Eyebrow,
  Receipt,
  ReceiptRow,
  TableWrap,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "One payment, split between the platform and a connected seller via Stripe Connect — with the application fee and payout shown explicitly.",
};

export const dynamic = "force-dynamic";

const statusSchema = z
  .enum(["success", "canceled", "onboarded", "refresh"])
  .optional()
  .catch(undefined);

export default async function ConnectPage(props: PageProps<"/connect">) {
  const params = await props.searchParams;

  const flow = statusSchema.parse(
    Array.isArray(params.status) ? params.status[0] : params.status,
  );

  const customer = await currentCustomer();

  if (!customer) {
    return (
      <div className="shell-narrow section">
        <Empty
          title="No session"
          hint="Cookies are disabled. Enable them and reload."
        />
      </div>
    );
  }

  const [connect, payments] = await Promise.all([
    connectStatus(customer),
    db.payment.findMany({
      where: { customerId: customer.id, type: "marketplace" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const split = splitMarketplace(MARKETPLACE_LISTING.amount);

  return (
    <div className="shell section">
      <div className="max-w-2xl">
        <Eyebrow>connect · destination charge</Eyebrow>

        <h1 className="h1 mt-5 text-balance">One charge, two parties.</h1>

        <p className="prose-ink mt-6 text-pretty text-lg">
          A marketplace payment isn&rsquo;t two transactions. It&rsquo;s one
          charge, with an application fee held back by the platform and the
          remainder transferred to the connected seller — atomically, by Stripe.
        </p>

        <p className="mt-4 font-mono text-xs text-ink-faint">
          You play both sides here: onboard a test seller, then buy from it.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* -------------------------------------------------------- */}
        {/* Step 1 — the seller                                       */}
        {/* -------------------------------------------------------- */}
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Eyebrow>step 1 · seller</Eyebrow>
              <h2 className="h3 mt-2">The connected account</h2>
            </div>

            {connect.onboarded ? (
              <Badge tone="settled">
                <IconCheck size={12} aria-hidden />
                Ready
              </Badge>
            ) : connect.accountId ? (
              <Badge tone="pending">Incomplete</Badge>
            ) : (
              <Badge tone="failed" dot={false}>
                None
              </Badge>
            )}
          </div>

          {flow === "onboarded" && !connect.onboarded ? (
            <p className="mt-4 rounded-card border border-pending/40 bg-pending-wash p-3 text-xs text-ink-soft">
              Stripe says onboarding isn&rsquo;t finished. Express test accounts
              sometimes need a second pass — run it again.
            </p>
          ) : null}

          {connect.onboarded ? (
            <>
              <p className="prose-ink mt-3 text-sm">
                This Express account can accept charges and receive payouts.
              </p>

              <Receipt className="mt-5">
                <ReceiptRow label="Account" value={connect.accountId ?? "—"} />
                <ReceiptRow
                  label="Charges"
                  value={connect.chargesEnabled ? "enabled" : "disabled"}
                />
                <ReceiptRow
                  label="Payouts"
                  value={connect.payoutsEnabled ? "enabled" : "disabled"}
                />
              </Receipt>
            </>
          ) : (
            <>
              <p className="prose-ink mt-3 text-sm">
                Onboard an Express test account. Stripe&rsquo;s hosted flow
                accepts obviously fake details in test mode — use{" "}
                <span className="num text-ink">000-000-0000</span> for the phone
                and any test SSN it asks for.
              </p>

              <ActionForm action={startConnectOnboarding} className="mt-5">
                <SubmitButton>
                  <IconBuildingStore size={14} aria-hidden />
                  Onboard a seller
                  <IconExternalLink size={13} aria-hidden />
                </SubmitButton>
              </ActionForm>
            </>
          )}
        </div>

        {/* -------------------------------------------------------- */}
        {/* Step 2 — the split                                        */}
        {/* -------------------------------------------------------- */}
        <div className="card flex flex-col p-6">
          <Eyebrow>step 2 · the split</Eyebrow>
          <h2 className="h3 mt-2">{MARKETPLACE_LISTING.name}</h2>
          <p className="prose-ink mt-1 text-sm">{MARKETPLACE_LISTING.blurb}</p>

          <Receipt className="mt-5">
            <ReceiptRow label="Buyer pays" value={money(split.total)} />
            <ReceiptRow
              label="Platform fee · 10%"
              value={`− ${money(split.platformFee)}`}
            />
            <ReceiptRow
              label="Seller receives"
              value={money(split.sellerPayout)}
              total
            />
          </Receipt>

          <div className="mt-auto pt-6">
            <ActionForm action={startMarketplaceCheckout}>
              <SubmitButton className="w-full" disabled={!connect.onboarded}>
                Buy — {money(split.total)}
              </SubmitButton>
            </ActionForm>

            {!connect.onboarded ? (
              <p className="mt-3 font-mono text-xs text-ink-faint">
                Onboard the seller first — Stripe refuses a destination charge to
                an account that can&rsquo;t accept one.
              </p>
            ) : (
              <p className="mt-3 font-mono text-xs text-ink-faint">
                The <span className="text-ink">application_fee.created</span>{" "}
                webhook confirms the platform&rsquo;s cut.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Settled marketplace payments                               */}
      {/* ---------------------------------------------------------- */}
      <section className="mt-16">
        <Eyebrow>settled · marketplace</Eyebrow>
        <h2 className="h2 mt-3 mb-6">Your splits</h2>

        {payments.length === 0 ? (
          <Empty
            title="No marketplace payments yet"
            hint="Onboard a seller and buy the listing. The split is recorded from the payment intent's metadata when the webhook settles."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Total</th>
                <th scope="col">Platform fee</th>
                <th scope="col">Seller payout</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="num text-ink-faint">
                    {timestamp(payment.createdAt)}
                  </td>
                  <td className="num">{money(payment.amount)}</td>
                  <td className="num text-event">
                    {payment.platformFee !== null
                      ? money(payment.platformFee)
                      : "—"}
                  </td>
                  <td className="num text-settled">
                    {payment.sellerPayout !== null
                      ? money(payment.sellerPayout)
                      : "—"}
                  </td>
                  <td>
                    <Badge
                      tone={
                        payment.status === "succeeded"
                          ? "settled"
                          : payment.status === "failed"
                            ? "failed"
                            : "pending"
                      }
                    >
                      {payment.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>
    </div>
  );
}
