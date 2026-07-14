import "server-only";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import {
  ADMIN_COOKIE,
  SESSION_COOKIE,
  serialize,
  verify,
} from "@/lib/session-crypto";

export {
  ADMIN_COOKIE,
  SESSION_COOKIE,
  adminCookieOptions,
  sessionCookieOptions,
} from "@/lib/session-crypto";

/**
 * Request-scoped session reads, for Server Components / Actions / Route
 * Handlers. The signing scheme itself lives in session-crypto so the proxy can
 * share it.
 */

/**
 * The visitor's session id, or null.
 *
 * Read-only by design: a Server Component cannot set cookies, so the session is
 * minted by the proxy on first request (see src/proxy.ts).
 */
export async function getSessionId(): Promise<string | null> {
  const jar = await cookies();
  return verify(jar.get(SESSION_COOKIE)?.value);
}

/** Whether the current request carries a valid admin cookie. */
export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verify(jar.get(ADMIN_COOKIE)?.value) === "admin";
}

/**
 * Constant-time password comparison, so the endpoint doesn't leak the
 * password's prefix through response timing.
 */
export function checkAdminPassword(submitted: string): boolean {
  const expected = Buffer.from(env().ADMIN_PASSWORD);
  const actual = Buffer.from(submitted);

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function adminCookieValue(): string {
  return serialize("admin");
}
