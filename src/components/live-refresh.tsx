"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a Server Component page current without a manual reload.
 *
 * This exists because of a deliberate property of the system: an admin refund
 * (or a checkout, or a cancellation) does not change our database. It calls
 * Stripe, and the state only moves when the *signed webhook* comes back a second
 * or two later. `revalidatePath` inside the action runs before that — so the
 * page it re-renders still shows the old row, and the user is left reloading by
 * hand to find out whether anything happened.
 *
 * Rather than fake it with an optimistic update (which would quietly contradict
 * the one rule this project is built on — the webhook is the only source of
 * truth), the page just re-asks the server on a timer until the truth arrives.
 *
 * Pauses on a hidden tab: an admin page left open in a background tab shouldn't
 * keep hitting the database forever.
 */
export function LiveRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}
