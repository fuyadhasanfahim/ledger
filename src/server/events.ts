import "server-only";

import { db } from "@/lib/db";

/** The shape the live feed renders. Serialisable — crosses to a Client Component. */
export interface FeedEvent {
  id: string;
  stripeEventId: string;
  type: string;
  status: "processed" | "failed" | "ignored";
  summary: string;
  createdAt: string;
}

export type EventFilter = "all" | "processed" | "failed" | "ignored";

export async function recentEvents(
  limit = 25,
  filter: EventFilter = "all",
): Promise<FeedEvent[]> {
  const rows = await db.webhookEvent.findMany({
    where: filter === "all" ? undefined : { status: filter },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });

  return rows.map((row) => ({
    id: row.id,
    stripeEventId: row.stripeEventId,
    type: row.type,
    status: row.status,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface EventStats {
  total: number;
  processed: number;
  failed: number;
  ignored: number;
}

export async function eventStats(): Promise<EventStats> {
  const grouped = await db.webhookEvent.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const stats: EventStats = { total: 0, processed: 0, failed: 0, ignored: 0 };

  for (const row of grouped) {
    const count = row._count._all;
    stats[row.status] = count;
    stats.total += count;
  }

  return stats;
}
