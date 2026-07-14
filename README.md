# Ledger

**Payments that settle exactly as designed.**

A live Stripe integration you can drive yourself. Subscribe, buy once, split a
marketplace payment, force a decline, trigger a refund — and watch the webhook
layer settle each one in real time.

Everything runs in **Stripe test mode**. No real card is charged, and the UI
never lets you forget it.

---

## Why this exists

Most payment demos show the happy path: a green tick after `4242 4242 4242 4242`.
The interesting parts of a payments integration are the ones that only surface
when things go wrong — a card that attaches but fails on charge, a webhook
delivered twice, a refund that has to claw back access someone already has.

Ledger is built so a visitor can *cause* those cases on purpose, then check what
the system did about them in a public event log.

---

## Architecture

```
                  ┌───────────────┐
   visitor ─────► │  Next.js app  │  signed session cookie (httpOnly, HMAC)
                  └──────┬────────┘
                         │  Server Action (zod-validated, rate-limited)
                         ▼
                  ┌───────────────┐
                  │Stripe Checkout│ ◄── the card never touches our origin (SAQ-A)
                  └──────┬────────┘
                         │  authorised / declined
                         ▼
                  ┌───────────────┐
                  │    Stripe     │
                  └──────┬────────┘
                         │  POST /api/webhooks/stripe   (signed, at-least-once)
                         ▼
        ┌─────────────────────────────────────┐
        │ 1. verify HMAC over the RAW body    │ bad signature → 400, no logic runs
        │ 2. INSERT event id (UNIQUE)         │ replay loses the race → no-op
        │ 3. run handler                      │
        │ 4. record the outcome in the log    │
        └────────────────┬────────────────────┘
                         ▼
                  ┌───────────────┐
                  │  PostgreSQL   │  Payment · Subscription · Refund · Access
                  └──────┬────────┘
                         ▼
                   access state  ──►  /premium is open, or locked
```

**The rule this codebase enforces everywhere:** the browser never grants itself
anything. Coming back from Checkout with `?status=success` shows a "settling…"
message, not access — a URL parameter is not proof of payment. Only a
signature-verified webhook moves money-derived state.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, React 19.2 + React Compiler) |
| Language | TypeScript, `strict` |
| Payments | Stripe SDK v22 (API `2026-06-24.dahlia`), Stripe-hosted Checkout |
| Database | PostgreSQL (Neon) via Prisma 7 + the `PrismaPg` driver adapter |
| Styling | Tailwind CSS v4 (CSS-first `@theme`, shared classes as `@utility`) |
| Motion | Framer Motion (`motion/react`) |
| Icons | Tabler |
| Validation | Zod v4 |

> **Next.js 16 note:** the `middleware` file convention was renamed to
> **`proxy`**. The request-time gate lives in [`src/proxy.ts`](src/proxy.ts) and
> exports a function named `proxy`. `params` and `searchParams` are Promises now,
> and are awaited everywhere.

---

## Setup

### 1. Database (Neon)

Create a project at [neon.tech](https://neon.tech) and take **both** connection
strings: the **pooled** one for the app, and the **direct** (unpooled) one for
migrations — DDL must not go through a connection pooler.

### 2. Environment

```bash
cp .env.example .env
```

Then fill it in:

```bash
DATABASE_URL="postgresql://…-pooler….neon.tech/ledger?sslmode=require"
DIRECT_URL="postgresql://….neon.tech/ledger?sslmode=require"

STRIPE_SECRET_KEY="sk_test_…"      # test only — the app refuses to boot on sk_live_
STRIPE_WEBHOOK_SECRET="whsec_…"    # from `stripe listen`, see step 5

APP_URL="http://localhost:3000"
SESSION_SECRET="…"                 # openssl rand -base64 32
ADMIN_PASSWORD="…"
```

`.env` is gitignored; `.env.example` holds no real values.

### 3. Migrate

```bash
npm install
npm run db:migrate     # create the schema
npm run db:seed        # optional — one placeholder row so the log isn't empty
```

### 4. Run

```bash
npm run dev
```

### 5. Webhooks, locally

Stripe can't reach `localhost`, so forward events with the
[Stripe CLI](https://docs.stripe.com/stripe-cli):

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

It prints a signing secret (`whsec_…`). **Put that in `.env` as
`STRIPE_WEBHOOK_SECRET` and restart the dev server.** The CLI's secret differs
from the dashboard's, and nothing will verify without the right one.

Replay events without touching the UI:

```bash
stripe trigger payment_intent.succeeded
stripe trigger invoice.payment_failed
stripe trigger charge.refunded
```

Resending the *same event id* twice is the interesting one: the second is
recorded as a duplicate and changes nothing.

---

## Test card scenarios

Any future expiry, any CVC, any ZIP. The full gallery is at **`/scenarios`**.

| Card | Triggers | What you should see |
|---|---|---|
| `4242 4242 4242 4242` | Successful payment | `payment_intent.succeeded` → access granted |
| `4000 0000 0000 9995` | Declined — insufficient funds | `payment_intent.payment_failed`, decline code recorded, **no access** |
| `4000 0000 0000 0002` | Declined — generic | `card_declined`, no access |
| `4000 0025 0000 3155` | Requires authentication (3DS) | 3DS challenge — complete it and it settles; abandon it and the intent stays unconfirmed |
| `4000 0000 0000 0341` | Attaches, then fails on charge | The card attaches but the charge fails. This is the case that breaks naive integrations. |
| `4000 0000 0000 0259` | Settles, then disputes | Succeeds; refund it from `/admin` and watch access get revoked |

---

## What to actually try

1. **Subscribe** from `/` with `4242…`, then open `/dashboard` — status `active`.
2. **Switch plan.** Monthly → Yearly prorates: you're billed only the difference.
3. **Refund yourself.** `/admin` → refund → `charge.refunded` lands → `/premium`
   locks you out. You didn't do that; the webhook did.
4. **Force a decline** with `4000 0000 0000 9995` and confirm access never
   appears anywhere.
5. **Split a payment.** `/connect` → onboard a test Express seller → buy. The
   receipt shows total, platform fee, and seller payout on a single charge.
6. **Replay a webhook** from the Stripe dashboard. The log records the duplicate,
   and access is granted exactly once.

---

## The webhook layer

Single endpoint: **`POST /api/webhooks/stripe`**.

- **Signature verified on the raw body.** The payload is read with
  `request.text()` and never parsed first — `constructEvent` recomputes the HMAC
  over the exact bytes Stripe signed. It also rejects stale timestamps, so a
  captured request can't be replayed later.
- **Idempotent by database constraint.** The event id is `INSERT`ed into
  `WebhookEvent.stripeEventId` (`UNIQUE`) *before* any handler runs. A concurrent
  replay loses that race at the database and returns early. Check-then-insert
  would leave a window where two simultaneous deliveries both pass the check.
- **Failed events stay retryable.** A handler that throws leaves the row `failed`
  and returns 500, so Stripe redelivers — and the redelivery is allowed to re-run
  rather than being swallowed as a duplicate.

Handled: `checkout.session.completed`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.created | updated | deleted`, `charge.refunded`,
`application_fee.created`.

Everything else is recorded as `ignored`, so the log still shows it arrived.

### Dunning

`invoice.payment_failed` does **not** revoke access immediately. Stripe retries on
a schedule and the subscription sits in `past_due` while it does — the customer
keeps access and is told to fix their card. Access is revoked only once
`next_payment_attempt` is `null`, i.e. Stripe has genuinely given up.

---

## Security

| | |
|---|---|
| Secret key | Server-only. Every module that touches it imports `server-only`, so a client import is a **build error**, not a runtime leak. |
| Card data | Never touches our origin — Stripe-hosted Checkout (SAQ-A). |
| Webhooks | HMAC-verified on raw bytes. Unsigned requests are rejected with 400 before any business logic runs. |
| Idempotency | A `UNIQUE` constraint, plus Stripe idempotency keys on every mutating API call — a double-clicked refund refunds once. |
| Sessions | httpOnly, `SameSite=Lax`, HMAC-SHA256 signed, verified in constant time. A tampered cookie is discarded, never trusted. |
| Admin | Password-gated, `SameSite=Strict` cookie, constant-time comparison, rate-limited. Authorisation is re-checked **inside every Server Action**, not only in the proxy — a Server Action is a POST to the page's own route, and proxy coverage of it is easy to lose in a refactor. |
| Input | Every Server Action and route handler validates with Zod. `?next=` redirect targets are restricted to same-site paths (no open redirect). |
| Headers | CSP with a per-request nonce, HSTS, `X-Frame-Options: DENY`, `nosniff`, `frame-ancestors 'none'`. |
| Logs | Structured JSON, with card numbers, secret keys and client secrets redacted. |
| Live keys | The app **refuses to boot** with an `sk_live_` key. |

Rate limiting is in-process, per instance. It's there to stop one client hammering
Stripe, not as a security boundary — a real deployment would back it with Redis.
The interface in `src/lib/rate-limit.ts` wouldn't change.

---

## Deploying to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Add every variable from `.env.example` under **Settings → Environment
   Variables**. Set `APP_URL` to the real deployment URL — Stripe's return URLs
   are built from it.
3. Deploy. `npm run build` runs `prisma generate` first.
4. Apply migrations to the production database:
   ```bash
   npm run db:deploy
   ```
5. In **Stripe → Developers → Webhooks**, add an endpoint:
   ```
   https://your-app.vercel.app/api/webhooks/stripe
   ```
   Subscribe it to the events listed above, then copy *that endpoint's* signing
   secret into `STRIPE_WEBHOOK_SECRET` in Vercel and redeploy. It is **not** the
   secret the Stripe CLI printed locally.

---

## Layout

```
prisma/schema.prisma   data model — WebhookEvent.stripeEventId powers idempotency
prisma.config.ts       Prisma 7 config (the datasource url lives here, not in the schema)

src/proxy.ts           Next 16 "middleware": session bootstrap, admin gate, CSP

src/lib/               env (lazily validated), db, stripe, session crypto, rate limit,
                       logger, formatting, catalog + test-card definitions

src/server/            the service layer — Stripe logic lives here, never inline in a route
  ├── actions.ts       Server Actions (zod-validated, rate-limited)
  ├── checkout.ts      Checkout Sessions: subscription / one-time / marketplace
  ├── subscriptions.ts proration, cancel (both modes), resume
  ├── refunds.ts       full + partial
  ├── connect.ts       Express onboarding, destination charges
  ├── access.ts        the entitlement state machine
  └── webhooks/        verify → dedupe → handle → log

src/components/        shared UI; the design system itself lives in app/globals.css
src/app/               landing · scenarios · premium · dashboard · connect · events · admin
```

---

## Scripts

```bash
npm run dev            # dev server (Turbopack)
npm run build          # prisma generate && next build
npm run typecheck      # tsc --noEmit
npm run lint
npm run db:migrate     # prisma migrate dev
npm run db:deploy      # prisma migrate deploy (production)
npm run db:seed
npm run db:studio
npm run stripe:listen  # forward webhooks to localhost:3000
```
