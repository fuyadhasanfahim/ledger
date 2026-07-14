import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Cookie signing primitives.
 *
 * Deliberately free of `next/headers` and `server-only` so that both the proxy
 * (which has no request-scoped cookie store) and Server Components (which do)
 * can share exactly one implementation of the signature scheme. If these
 * diverged, the proxy could mint sessions the app then rejects.
 */

export const SESSION_COOKIE = "ledger_sid";
export const ADMIN_COOKIE = "ledger_admin";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const ADMIN_MAX_AGE = 60 * 60 * 8; // 8 hours

function secret(): string {
  const value = process.env.SESSION_SECRET;

  if (!value || value.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short (need ≥32 chars). Generate one with: openssl rand -base64 32",
    );
  }

  return value;
}

/** Cookie values are `<payload>.<hmac-sha256>`. */
function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function serialize(value: string): string {
  return `${value}.${sign(value)}`;
}

/**
 * Returns the payload if the signature is valid, else null.
 *
 * Compared in constant time so the MAC can't be brute-forced byte-by-byte via
 * response timing.
 */
export function verify(signed: string | undefined): string | null {
  if (!signed) return null;

  const index = signed.lastIndexOf(".");
  if (index <= 0) return null;

  const value = signed.slice(0, index);
  const mac = signed.slice(index + 1);

  const expected = Buffer.from(sign(value));
  const actual = Buffer.from(mac);

  // timingSafeEqual throws on a length mismatch, so check that first.
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return value;
}

export function newSessionId(): string {
  return randomUUID();
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
} as const;

export const adminCookieOptions = {
  httpOnly: true,
  // Strict: the admin cookie must never ride along on a cross-site request.
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: ADMIN_MAX_AGE,
} as const;
