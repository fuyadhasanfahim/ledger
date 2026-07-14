import "server-only";

/**
 * Fixed-window rate limiter, in-process.
 *
 * Honest about its limits: this is per-instance memory, so on Vercel each
 * serverless instance keeps its own counters and a determined attacker spread
 * across instances gets a higher effective ceiling. It is here to stop a single
 * client hammering Stripe (each checkout call costs a real API round-trip), not
 * as a security boundary. A production deployment would back this with Redis /
 * Upstash — the interface below wouldn't change.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Bound the map so a flood of unique keys can't grow it without limit.
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_KEYS) {
      // Cheap eviction: drop everything already expired.
      for (const [k, w] of windows) {
        if (w.resetAt <= now) windows.delete(k);
      }
      // Still full of live windows — refuse rather than grow unbounded.
      if (windows.size >= MAX_KEYS) {
        return { ok: false, remaining: 0, resetAt: now + windowMs };
      }
    }

    const fresh: Window = { count: 1, resetAt: now + windowMs };
    windows.set(key, fresh);
    return { ok: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }

  existing.count += 1;

  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Best-effort client IP, trusting Vercel's proxy headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
