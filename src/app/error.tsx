"use client";

import { useEffect } from "react";
import Link from "next/link";
import { IconAlertTriangle } from "@tabler/icons-react";

/**
 * Route-level error boundary.
 *
 * Note what it does *not* print: `error.message`. A server error's message can
 * carry a connection string or a Stripe error detail, and this component runs
 * in the browser. Next already strips messages in production, but leaning on
 * that is not a plan — we show the digest, which is a safe correlation id.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route error", { digest: error.digest });
  }, [error]);

  return (
    <div className="shell-narrow section">
      <div className="card p-8">
        <IconAlertTriangle size={22} className="text-failed" aria-hidden />

        <h1 className="h2 mt-4">Something failed to settle.</h1>

        <p className="prose-ink mt-3">
          An error was thrown while rendering this page. It&rsquo;s been logged.
          Nothing was charged.
        </p>

        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-ink-faint">
            digest: <span className="text-ink">{error.digest}</span>
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Back to safety
          </Link>
        </div>
      </div>
    </div>
  );
}
