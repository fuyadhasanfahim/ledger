import type { NextRequest } from "next/server";

import { log } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { currentCustomer } from "@/server/customers";
import { paymentById } from "@/server/refunds";
import { receiptHtml } from "@/server/receipt";
import { renderPdf } from "@/server/pdf";

/**
 * GET /api/receipt/[paymentId] → a themed PDF receipt.
 *
 * The authorisation check is the whole point of this file. Payment ids are
 * guessable-adjacent (they're just ObjectIds), so without the ownership test
 * anyone could enumerate this endpoint and pull down other people's receipts —
 * amounts, payment intent ids, the lot. So: resolve the customer from the signed
 * session cookie, and refuse any payment that isn't theirs.
 *
 * Rendering happens on the Node runtime because it drives a headless Chromium.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Chromium is slow to boot cold; give it room before the platform kills us.
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/receipt/[paymentId]">,
): Promise<Response> {
  if (!rateLimit(`receipt:${clientIp(request.headers)}`, 10, 60_000).ok) {
    return new Response("Too many requests", { status: 429 });
  }

  const { paymentId } = await ctx.params;

  const customer = await currentCustomer();
  if (!customer) return new Response("No session", { status: 401 });

  const payment = await paymentById(paymentId);

  // Same response for "doesn't exist" and "isn't yours" — distinguishing them
  // would let someone probe which payment ids are real.
  if (!payment || payment.customerId !== customer.id) {
    log.warn("receipt.denied", { paymentId, customerId: customer.id });
    return new Response("Not found", { status: 404 });
  }

  try {
    const pdf = await renderPdf(receiptHtml(payment));

    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ledger-receipt-${payment.id.slice(-8)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    log.error("receipt.render_failed", { paymentId, error });

    // In development, hand back the actual reason. The renderer's errors are
    // *actionable* ("Chrome is missing these libraries, run this") and hiding
    // them behind "Could not render the receipt" is what turned a two-minute
    // setup problem into a debugging session. Production stays terse — a raw
    // error can leak paths and internals.
    const detail =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? `\n\n${error.message}`
        : "";

    return new Response(`Could not render the receipt.${detail}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
