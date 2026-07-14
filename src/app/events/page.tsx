import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { eventStats, recentEvents, type FeedEvent } from "@/server/events";
import { EventFeed } from "@/components/event-feed";
import { Eyebrow, Stat, cx } from "@/components/ui";

export const metadata: Metadata = {
  title: "Event log",
  description:
    "The live Stripe webhook feed: every event signature-verified, deduplicated by unique constraint, and recorded with its outcome.",
};

export const dynamic = "force-dynamic";

/**
 * `?show=` filter, validated. searchParams is a Promise in Next 16 (async
 * request APIs), and its values are attacker-controlled — so it gets parsed
 * through Zod like any other untrusted input rather than used raw.
 */
const filterSchema = z.enum(["all", "processed", "failed", "ignored"]).catch("all");

const FILTERS = [
  { value: "all", label: "All" },
  { value: "processed", label: "Processed" },
  { value: "failed", label: "Failed" },
  { value: "ignored", label: "Ignored" },
] as const;

export default async function EventsPage(props: PageProps<"/events">) {
  const params = await props.searchParams;

  const show = filterSchema.parse(
    Array.isArray(params.show) ? params.show[0] : params.show,
  );

  let events: FeedEvent[] = [];
  let stats = { total: 0, processed: 0, failed: 0, ignored: 0 };
  let offline = false;

  try {
    [events, stats] = await Promise.all([recentEvents(100), eventStats()]);
  } catch {
    offline = true;
  }

  const filtered =
    show === "all" ? events : events.filter((event) => event.status === show);

  // `key={show}` remounts the feed on filter change so it doesn't animate the
  // whole list as if every row were newly arrived.

  return (
    <div className="shell section">
      <div className="max-w-2xl">
        <Eyebrow>webhook · /api/webhooks/stripe</Eyebrow>

        <h1 className="h1 mt-5 text-balance">Every event, and what it did.</h1>

        <p className="prose-ink mt-6 text-pretty text-lg">
          Stripe delivers at-least-once, so the same event can arrive twice. The
          id is claimed against a{" "}
          <span className="num text-ink">unique index</span> before any handler
          runs — a replay loses that race inside the database itself and becomes
          a no-op.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-4">
        <Stat label="Total received" value={stats.total} />
        <Stat label="Processed" value={stats.processed} tone="settled" />
        <Stat label="Failed" value={stats.failed} tone="failed" />
        <Stat label="Ignored" value={stats.ignored} />
      </div>

      {/* Filter as real links, so the state lives in the URL and is shareable
          + back-button friendly. Prefetched by next/link. */}
      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Filter events">
        {FILTERS.map((filter) => {
          const active = show === filter.value;

          return (
            <Link
              key={filter.value}
              href={filter.value === "all" ? "/events" : `/events?show=${filter.value}`}
              scroll={false}
              className={cx(
                "btn btn-sm",
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-rule-strong text-ink-soft hover:border-ink hover:text-ink",
              )}
              aria-current={active ? "true" : undefined}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">
        {offline ? (
          <div className="card px-6 py-10 text-center">
            <p className="font-mono text-sm text-failed">
              Cannot reach the database.
            </p>
            <p className="mt-2 text-sm text-ink-faint">
              Set <span className="num">MONGODB_URI</span> and run{" "}
              <span className="num">npm run db:indexes</span>.
            </p>
          </div>
        ) : (
          <EventFeed key={show} initial={filtered} limit={100} status={show} />
        )}
      </div>
    </div>
  );
}
