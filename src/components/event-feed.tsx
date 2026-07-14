"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconAlertTriangle, IconCheck, IconMinus } from "@tabler/icons-react";
import type { FeedEvent } from "@/server/events";
import { relative, shortId } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * The live webhook feed.
 *
 * Polls while the tab is visible (and stops when it isn't — no point burning
 * the user's battery and our DB on a background tab). New events animate in
 * from the top; everything else in this design stays still.
 */

const POLL_MS = 5_000;

const STATUS_META = {
  processed: { icon: IconCheck, className: "text-settled" },
  failed: { icon: IconAlertTriangle, className: "text-failed" },
  ignored: { icon: IconMinus, className: "text-ink-faint" },
} as const;

export function EventFeed({
  initial,
  limit = 25,
  status = "all",
  className,
}: {
  initial: FeedEvent[];
  limit?: number;
  /** Keeps the poll in step with the page's ?show= filter. */
  status?: "all" | "processed" | "failed" | "ignored";
  className?: string;
}) {
  const [events, setEvents] = useState<FeedEvent[]>(initial);
  const [live, setLive] = useState(true);
  const reduceMotion = useReducedMotion();


  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (document.visibilityState !== "visible") {
        timer = setTimeout(poll, POLL_MS);
        return;
      }

      try {
        const response = await fetch(
          `/api/events?limit=${limit}&status=${status}`,
          { cache: "no-store" },
        );

        if (response.ok && !cancelled) {
          const data: { events: FeedEvent[] } = await response.json();
          setEvents(data.events);
          setLive(true);
        } else if (!response.ok && !cancelled) {
          setLive(false);
        }
      } catch {
        if (!cancelled) setLive(false);
      }

      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [limit, status]);

  return (
    <div className={cx("card overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <p className="eyebrow">
          <span aria-hidden>{"// "}</span>webhook · event log
        </p>

        <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint">
          <span
            className={cx(
              "dot",
              live ? "animate-pulse bg-settled" : "bg-ink-faint",
            )}
            aria-hidden
          />
          {live ? "Live" : "Reconnecting"}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="px-4 py-10 text-center font-mono text-xs text-ink-faint">
          No events yet. Run a checkout and they&rsquo;ll land here.
        </p>
      ) : (
        <ul
          className="divide-y divide-rule"
          // Screen readers get told when new events arrive, without stealing focus.
          aria-live="polite"
          aria-relevant="additions"
        >
          <AnimatePresence initial={false}>
            {events.map((event) => {
              const meta = STATUS_META[event.status];
              const Icon = meta.icon;

              return (
                <motion.li
                  key={event.id}
                  layout={!reduceMotion}
                  /*
                   * `initial` runs only for rows mounted *after* the list itself
                   * — AnimatePresence's `initial={false}` suppresses it for the
                   * rows already on screen at mount. So an event flashes amber
                   * and slides in exactly once, when it actually arrives, and
                   * the existing log doesn't re-animate on every poll.
                   */
                  initial={
                    reduceMotion
                      ? false
                      : { opacity: 0, y: -10, backgroundColor: "#f0e4cd" }
                  }
                  animate={{ opacity: 1, y: 0, backgroundColor: "#00000000" }}
                  transition={{
                    duration: 0.45,
                    backgroundColor: { duration: 1.4 },
                  }}
                  className="event-row"
                >
                  <Icon
                    size={14}
                    className={cx("shrink-0", meta.className)}
                    aria-hidden
                  />

                  <div className="min-w-0">
                    <p className="truncate text-ink">
                      <span className="text-ink">{event.type}</span>
                    </p>
                    <p className="truncate text-ink-faint">{event.summary}</p>
                  </div>

                  <div className="text-right">
                    <p className="whitespace-nowrap text-ink-faint">
                      {relative(event.createdAt)}
                    </p>
                    <p className="whitespace-nowrap text-ink-faint/70">
                      {shortId(event.stripeEventId, 8)}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
