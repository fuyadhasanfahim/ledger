import "server-only";

import { connectDb } from "@/lib/db";
import { WebhookEventModel } from "@/models";
import type { WebhookStatus } from "@/lib/domain";

/** The shape the live feed renders. Plain + serialisable — it crosses to a Client Component. */
export interface FeedEvent {
  id: string;
  stripeEventId: string;
  type: string;
  status: WebhookStatus;
  summary: string;
  createdAt: string;
}

export type EventFilter = "all" | WebhookStatus;

export async function recentEvents(
  limit = 25,
  filter: EventFilter = "all",
): Promise<FeedEvent[]> {
  await connectDb();

  const docs = await WebhookEventModel.find(
    filter === "all" ? {} : { status: filter },
  )
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100));

  return docs.map((doc) => ({
    id: doc._id.toString(),
    stripeEventId: doc.stripeEventId,
    type: doc.type,
    status: doc.status,
    summary: doc.summary,
    createdAt: doc.createdAt.toISOString(),
  }));
}

export interface EventStats {
  total: number;
  processed: number;
  failed: number;
  ignored: number;
}

export async function eventStats(): Promise<EventStats> {
  await connectDb();

  const grouped = await WebhookEventModel.aggregate<{
    _id: WebhookStatus;
    count: number;
  }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]);

  const stats: EventStats = { total: 0, processed: 0, failed: 0, ignored: 0 };

  for (const row of grouped) {
    stats[row._id] = row.count;
    stats.total += row.count;
  }

  return stats;
}
