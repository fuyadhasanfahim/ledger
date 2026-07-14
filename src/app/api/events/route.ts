import type { NextRequest } from "next/server";
import { z } from "zod";
import { log } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { recentEvents } from "@/server/events";

/**
 * GET /api/events?limit=25
 *
 * Read-only feed behind the live event log. The client polls this while the tab
 * is visible. The webhook event log is public *by design* — it's the headline
 * feature of the demo — but it only ever exposes event type, status, summary
 * and timestamp, never the raw Stripe payload or any customer identifier.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["all", "processed", "failed", "ignored"]).default("all"),
});

export async function GET(request: NextRequest): Promise<Response> {
  const limiter = rateLimit(
    `events:${clientIp(request.headers)}`,
    120, // generous: the feed polls every 5s
    60_000,
  );

  if (!limiter.ok) {
    return Response.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((limiter.resetAt - Date.now()) / 1000),
          ),
        },
      },
    );
  }

  const query = request.nextUrl.searchParams;

  const parsed = querySchema.safeParse({
    limit: query.get("limit") ?? undefined,
    status: query.get("status") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid query", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const events = await recentEvents(parsed.data.limit, parsed.data.status);

    return Response.json(
      { events },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("events.fetch_failed", { error });
    return Response.json({ error: "Could not load events" }, { status: 500 });
  }
}
