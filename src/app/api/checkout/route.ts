import type { NextRequest } from "next/server";
import { z } from "zod";

import { log } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { requireCustomer } from "@/server/customers";
import {
  createMarketplaceIntent,
  createOneTimeIntent,
  createSubscriptionIntent,
} from "@/server/checkout";

/**
 * POST /api/checkout
 *
 * Creates the intent for our own themed checkout page and returns its client
 * secret. The secret only ever authorises paying *this* intent — it is not a
 * credential, which is why it is safe to hand to the browser.
 *
 * The actor is resolved from the signed session cookie, never from the body, so
 * a caller cannot start a checkout on someone else's behalf.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("subscription"), plan: z.enum(["monthly", "yearly"]) }),
  z.object({ mode: z.literal("one_time") }),
  z.object({ mode: z.literal("marketplace") }),
]);

export async function POST(request: NextRequest): Promise<Response> {
  if (!rateLimit(`checkout:${clientIp(request.headers)}`, 15, 60_000).ok) {
    return Response.json(
      { error: "Too many attempts. Wait a minute." },
      { status: 429 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const customer = await requireCustomer();

    const intent =
      parsed.data.mode === "subscription"
        ? await createSubscriptionIntent(customer, parsed.data.plan)
        : parsed.data.mode === "one_time"
          ? await createOneTimeIntent(customer)
          : await marketplace(customer);

    return Response.json(intent, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    log.error("checkout.intent_failed", { mode: parsed.data.mode, error });

    return Response.json(
      {
        error: "Could not start checkout.",
        ...(process.env.NODE_ENV !== "production" && {
          detail: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 },
    );
  }
}

async function marketplace(
  customer: Awaited<ReturnType<typeof requireCustomer>>,
) {
  if (!customer.connectAccountId) {
    throw new Error("Onboard a seller account first.");
  }
  return createMarketplaceIntent(customer, customer.connectAccountId);
}
