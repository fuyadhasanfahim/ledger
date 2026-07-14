import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  SESSION_COOKIE,
  newSessionId,
  serialize,
  sessionCookieOptions,
  verify,
} from "@/lib/session-crypto";

/**
 * Next.js 16 renamed the `middleware` convention to `proxy` (the named export
 * must be `proxy`, and it always runs on the Node.js runtime — the `edge`
 * runtime is not supported here). This file is that convention.
 *
 * It does three things:
 *
 *  1. Mints the visitor session on first request. A Server Component cannot set
 *     a cookie, so the session has to be established here, before render —
 *     otherwise the first page load would have no customer to attach state to.
 *  2. Gates /admin.
 *  3. Sets the Content-Security-Policy, with a per-request nonce.
 *
 * The admin gate here is a *first* line of defence, not the only one. Server
 * Actions are POSTs to the page route and a matcher change could silently skip
 * them, so every admin action re-checks authorisation server-side (see
 * requireAdmin in src/server/admin.ts).
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const isDev = process.env.NODE_ENV === "development";

  /**
   * CSP.
   *
   * `frame-src`/`form-action` allow Stripe because Checkout is hosted on
   * Stripe's domain and 3D Secure challenges render in a Stripe iframe — a
   * strict policy without them would break the 3DS test card.
   *
   * 'unsafe-inline' in script-src is required in dev for React Refresh; in
   * production we go nonce-based + strict-dynamic.
   */
  const csp = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    isDev
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com`,
    // Tailwind injects styles; a nonce on the style tag isn't plumbed through
    // by Next's CSS pipeline, so inline styles stay permitted.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://*.stripe.com`,
    `font-src 'self' data:`,
    `connect-src 'self' https://api.stripe.com`,
    `frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com`,
    `form-action 'self' https://checkout.stripe.com`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", csp);

  /* ---- Session bootstrap ------------------------------------------ */
  const existing = verify(request.cookies.get(SESSION_COOKIE)?.value);

  if (!existing) {
    // Either absent, or the signature didn't check out (tampered / rotated
    // secret). Either way, issue a fresh one rather than trusting it.
    response.cookies.set(
      SESSION_COOKIE,
      serialize(newSessionId()),
      sessionCookieOptions,
    );
  }

  /* ---- Admin gate -------------------------------------------------- */
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const isAdmin = verify(request.cookies.get(ADMIN_COOKIE)?.value) === "admin";

    if (!isAdmin) {
      const login = new URL("/admin/login", request.url);
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /api/webhooks (Stripe must reach it without a session cookie, and it
     *    authenticates itself by signature)
     *  - Next internals and static assets
     */
    "/((?!api/webhooks|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
