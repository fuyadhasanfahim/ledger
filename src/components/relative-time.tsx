"use client";

import { useSyncExternalStore } from "react";
import { relative } from "@/lib/format";

/**
 * A timestamp that reads "2m ago" and keeps itself current.
 *
 * The subtlety this exists to solve: "44s ago" is not a pure function of the
 * data — it depends on *when* it is rendered. The server renders it at one
 * instant, the browser hydrates a beat later, the two strings disagree, and
 * React tears down and regenerates the tree. Inside `AnimatePresence` that
 * regeneration is what produced the "children should not have changed" error.
 *
 * Two pieces fix it:
 *
 *  - `suppressHydrationWarning` tells React this element's text is *expected* to
 *    differ between server and client. React keeps the server's text and moves
 *    on instead of regenerating. This is precisely the case React's docs call
 *    out for the attribute, and it is scoped to this one element — a genuine
 *    hydration bug anywhere else still reports.
 *
 *  - `useSyncExternalStore` re-renders on a timer so the label doesn't sit
 *    frozen at whatever the server said. It's used rather than
 *    `useEffect` + `setState` because a store subscription is what this actually
 *    is, and it keeps the component free of the set-state-in-effect smell.
 */

/** Coarse clock: changes once every 10 seconds, so re-renders stay cheap. */
function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, 10_000);
  return () => clearInterval(timer);
}

function getSnapshot(): number {
  return Math.floor(Date.now() / 10_000);
}

// Constant on the server: there is no clock to subscribe to during SSR, and
// returning Date.now() here would make the render non-deterministic.
function getServerSnapshot(): number {
  return 0;
}

export function RelativeTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  // Subscribed purely for its side effect of re-rendering; the value itself is
  // just a tick counter.
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {relative(iso)}
    </time>
  );
}
