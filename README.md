<div align="center">

# Ledger

**Payments that settle exactly as designed.**

A complete, live Stripe integration you can drive yourself — subscriptions, one-time checkout,
marketplace splits, refunds, and failed-payment recovery — with the webhook layer visible in real time.

[**→ Live demo**](https://ledger-alpha-green.vercel.app/) · [Test scenarios](https://ledger-alpha-green.vercel.app/scenarios) · [Event log](https://ledger-alpha-green.vercel.app/events)

`Next.js 16` · `React 19` · `TypeScript` · `Stripe` · `MongoDB` · `Tailwind v4`

**Everything runs in Stripe test mode. No real card is charged, and the UI never lets you forget it.**

</div>

---

## Why this exists

Most payment demos show the happy path: a green tick after `4242 4242 4242 4242`.

But the interesting parts of a payments integration are the ones that only surface when things go
wrong — a card that attaches to the customer but fails on the charge, a webhook delivered twice, a
refund that has to claw back access someone is already using, a subscription that dies quietly after
Stripe gives up retrying.

Ledger is built so you can **cause those cases on purpose**, and then check what the system actually
did about them in a public, live event log.

> **The one rule this codebase enforces everywhere:** the browser never grants itself anything.
> Coming back from checkout with `?status=success` shows a *"settling…"* message — not access.
> A URL parameter is not proof of payment. Only a **signature-verified webhook** moves money-derived state.

---

## What you can try in 60 seconds

| # | Do this | Watch what happens |
|---|---------|--------------------|
| 1 | [Subscribe](https://ledger-alpha-green.vercel.app/#plans) with `4242 4242 4242 4242` | Status goes `active` on the dashboard — but only *after* `invoice.paid` is verified |
| 2 | Switch Monthly → Yearly | Proration: you're billed only the difference, not the full plan |
| 3 | [Refund yourself](https://ledger-alpha-green.vercel.app/admin) from the admin panel | `charge.refunded` lands and **locks you out of `/premium`.** You didn't do that — the webhook did |
| 4 | Pay with `4000 0000 0000 9995` | Declined. Access never appears anywhere |
| 5 | Pay with `4000 0000 0000 0341` | The card *attaches*, then the charge fails. This is the case that breaks naive integrations |
| 6 | [Split a payment](https://ledger-alpha-green.vercel.app/connect) via Connect | One charge → $250 total, $25 platform fee, $225 seller payout |
| 7 | Replay any event from the Stripe dashboard | The log records a **duplicate** — access is granted exactly once |

Then download a themed **PDF receipt** from the success page.

---

## Architecture

```
                    ┌────────────────┐
     visitor ─────► │   Next.js app  │  signed session cookie (httpOnly, HMAC-SHA256)
                    └───────┬────────┘  no login — a client can pay immediately
                            │
                            │  POST /api/checkout   (zod-validated, rate-limited)
                            ▼
                    ┌────────────────┐
                    │ Payment Element│ ◄── Stripe's iframe. The card number never
                    │ (our theme)    │     touches our origin, our server, or our logs
                    └───────┬────────┘
                            │  confirmed client-side with the client secret
                            ▼
                    ┌────────────────┐
                    │     Stripe     │  authorises · declines · challenges (3DS)
                    └───────┬────────┘
                            │
                            │  POST /api/webhooks/stripe   (signed, at-least-once)
                            ▼
        ┌───────────────────────────────────────────┐
        │  1. verify HMAC over the RAW body         │  bad signature → 400, no logic runs
        │  2. INSERT event id (UNIQUE INDEX)        │  replay loses the race → no-op
        │  3. run the handler                       │
        │  4. record the outcome in the event log   │
        └───────────────────┬───────────────────────┘
                            ▼
                    ┌────────────────┐
                    │    MongoDB     │  Payment · Subscription · Refund · Access
                    └───────┬────────┘
                            ▼
                     access state  ──►  /premium is open, or locked
```

Nothing between the browser and the database is trusted. The webhook is the only writer of
money-derived state.

---

## The webhook layer

Single endpoint: **`POST /api/webhooks/stripe`** → [`src/app/api/webhooks/stripe/route.ts`](src/app/api/webhooks/stripe/route.ts)

### Signature verified on the raw body

The payload is read with `request.text()` and **never parsed first**. `constructEvent` recomputes the
HMAC over the exact bytes Stripe signed — parse-and-reserialise would change them and every signature
would fail. It also rejects stale timestamps, so a captured request can't be replayed later.

### Idempotent by database constraint, not by `if`

Stripe delivers **at-least-once**. Network hiccups, our own 5xx responses, and manual dashboard
replays all mean the same event id can arrive more than once. Processing one twice would
double-grant access or double-count a payment.

The guard is a **unique index**, and the claim happens *before* the handler runs:

```ts
// src/server/webhooks/process.ts
await WebhookEventModel.create({ stripeEventId: event.id, ... });   // ← 1. claim it
//   duplicate → MongoDB raises E11000 → we return early, no-op
const summary = await handler(event);                               // ← 2. only then run
```

A check-then-insert would leave a window where two simultaneous deliveries both pass the check and
both run. Here **the database settles the race**, not application code.

> Verified against a real cluster: 10 concurrent deliveries of the same event id → exactly **1** wins,
> **9** rejected, **1** document persisted.

### Failed events stay retryable

A handler that throws leaves its row as `failed` and returns **500**, so Stripe redelivers — and the
redelivery is *allowed to re-run* rather than being swallowed as a duplicate. Without that, one
transient blip would bury an event forever.

### Handled events

`checkout.session.completed` · `payment_intent.succeeded` · `payment_intent.payment_failed` ·
`invoice.paid` · `invoice.payment_failed` · `customer.subscription.created | updated | deleted` ·
`charge.refunded` · `application_fee.created`

Everything else is recorded as `ignored` — the log still shows it arrived.

### Dunning does the patient thing

`invoice.payment_failed` does **not** revoke access immediately. Stripe retries on a schedule and the
subscription sits in `past_due` while it does — the customer keeps access and is told to fix their
card. Access is revoked only once `next_payment_attempt` is `null`, i.e. **Stripe has genuinely given up**.

Revoking on the first failure would lock out every customer whose card had a temporary hiccup.

---

## Checkout

This is **not** Stripe-hosted Checkout. `/checkout` is our own page, our own type, our own paper.

- **Stripe Payment Element**, themed via the [Appearance API](src/components/checkout/appearance.ts)
  to match the ledger's ink-on-paper design.
- The PAN is typed into **Stripe's cross-origin iframe** — it never reaches our origin, so the PCI
  surface stays SAQ-A.
- Test cards are one click away: Stripe's own preset panel (bottom-right, test mode only) fills the
  form, and a themed strip under it carries all six scenarios, copy-on-click.

> **Why not "tap a card and it autofills"?** An Element *cannot* be prefilled from our JavaScript — it
> is cross-origin by design, and that restriction is precisely what keeps the card number off our
> server. Faking a worse version of Stripe's own panel would have been a lie about what's possible.

### Subscriptions, without the hosted page

```ts
// src/server/checkout.ts
const subscription = await stripe().subscriptions.create({
  payment_behavior: "default_incomplete",
  expand: ["latest_invoice.confirmation_secret"],   // ← not `payment_intent`
  ...
});
const clientSecret = subscription.latest_invoice.confirmation_secret.client_secret;
```

⚠️ Note the expand path. `latest_invoice.payment_intent.client_secret` — the field most tutorials still
use — **no longer exists** in current Stripe API versions, and expanding the wrong path silently
yields `undefined`.

---

## Test card scenarios

Any future expiry, any CVC, any ZIP. Full gallery at [**/scenarios**](https://ledger-alpha-green.vercel.app/scenarios).

| Card | Triggers | What you should see |
|------|----------|---------------------|
| `4242 4242 4242 4242` | Successful payment | `payment_intent.succeeded` → access granted |
| `4000 0000 0000 9995` | Declined — insufficient funds | Decline code recorded, **no access** |
| `4000 0000 0000 0002` | Declined — generic | `card_declined`, no access |
| `4000 0025 0000 3155` | Requires authentication (3DS) | Complete the challenge → settles. Dismiss it → intent stays unconfirmed |
| `4000 0000 0000 0341` | **Attaches, then fails on charge** | The card attaches but the charge fails. *This is the one that breaks naive integrations* |
| `4000 0000 0000 0259` | **Settles, then disputes** | Succeeds; refund it from `/admin` and watch access get revoked |

---

## Stack

| | |
|---|---|
| **Framework** | Next.js 16 — App Router, Turbopack, React 19.2, React Compiler |
| **Language** | TypeScript, `strict` |
| **Payments** | Stripe SDK v22, API version `2026-06-24.dahlia`, Payment Element |
| **Database** | MongoDB (Atlas) via Mongoose 9 |
| **Styling** | Tailwind CSS v4 — CSS-first `@theme`, shared classes as `@utility` |
| **Motion** | Framer Motion (`motion/react`) |
| **Icons** | Tabler |
| **Validation** | Zod v4 |
| **PDF** | `puppeteer-core` + `@sparticuz/chromium` |
| **Deploy** | Vercel |

### Next.js 16 notes

Two conventions changed, and both bite silently:

- **`middleware` is now `proxy`.** The request-time gate lives in [`src/proxy.ts`](src/proxy.ts) and
  exports a function named `proxy`. It always runs on the Node.js runtime.
- **`params` and `searchParams` are Promises.** They're awaited everywhere, and every value read from
  them is parsed through Zod — a query string is untrusted input like any other.

---

## Design

A warm paper-and-ink ledger, not a generic SaaS gradient.

- **Paper** `#e8e6dc` with a real film-grain texture (SVG `feTurbulence`, inlined as a `data:` URI — no
  network request, no CSP exception)
- **Ink** `#12130f`
- **Transaction accents** — settled `#1a7f4b` · pending `#b8791f` · failed `#b23a2e` · event `#5b4b8a`
- **Type** — Space Grotesk for display, **JetBrains Mono for every number, id, card value and event line**
- Receipt-style split panels, hairline rules, mono eyebrows like `// checkout · mode=subscription`
- **Motion is restrained.** The event feed animates as events *arrive*. Everything else stays still.

The design system lives in [`src/app/globals.css`](src/app/globals.css) as Tailwind v4 `@utility`
classes — not scattered through the components.

> Why `@utility` and not `@layer components`? In Tailwind v4, `@apply` only resolves **utilities**. A
> component-layer class can't be composed into another one, so `.btn-primary` could never build on
> `.btn`. Declaring them as utilities is what keeps the file DRY.

---

## Getting started

### 1. MongoDB

Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/atlas). Grab the connection string.

**Network Access → add `0.0.0.0/0`.** Vercel's serverless IPs are not fixed, so they cannot be
whitelisted individually. Skip this and every database call times out in production.

### 2. Environment

```bash
cp .env.example .env
```

```bash
MONGODB_URI="mongodb+srv://…/ledger?retryWrites=true&w=majority"

STRIPE_SECRET_KEY="sk_test_…"                    # test keys only — the app refuses sk_live_
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_…"
STRIPE_WEBHOOK_SECRET="whsec_…"                  # from `stripe listen`, step 4

APP_URL="http://localhost:3000"
SESSION_SECRET="…"                               # openssl rand -base64 32
ADMIN_PASSWORD="…"
```

`.env` is gitignored. `.env.example` holds no real values.

### 3. Install, index, run

```bash
npm install
npm run db:indexes    # ← builds the unique index. Not optional. See below.
npm run dev
```

> **`db:indexes` is not housekeeping — it *is* the idempotency guard.** Without the unique index on
> `WebhookEvent.stripeEventId`, a duplicate insert simply succeeds, the duplicate-key error never
> fires, and a replayed Stripe event gets processed **twice**. Everything would look fine right up
> until it double-granted access. The script fails loudly if the index is missing.

### 4. Webhooks, locally

Stripe can't reach `localhost`, so forward events with the [Stripe CLI](https://docs.stripe.com/stripe-cli):

```bash
npm run stripe:listen
# → stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

It prints a signing secret. **Put it in `.env` as `STRIPE_WEBHOOK_SECRET` and restart the dev server.**

Replay events without touching the UI:

```bash
stripe trigger payment_intent.succeeded
stripe trigger invoice.payment_failed
stripe trigger charge.refunded
```

Resending the **same event id** twice is the interesting one — the second is recorded as a duplicate
and changes nothing.

### 5. PDF receipts (optional, local only)

Receipts are rendered by a headless Chrome. On Vercel this is handled automatically. Locally:

```bash
npm run chrome:install     # downloads Chrome for Testing, no sudo needed
```

On a bare Linux/WSL box Chromium also needs its shared libraries, **once**:

```bash
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
  libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2
```

(Amazon Linux — what Vercel runs — already ships these, which is why `@sparticuz/chromium` works there
out of the box.)

---

## Deploying to Vercel

1. **Push to GitHub, import the repo in Vercel.**

2. **Add every variable from `.env.example`.** Set `APP_URL` to the real deployment URL — Stripe's
   return URLs are built from it. Put a placeholder in `STRIPE_WEBHOOK_SECRET` for now.

3. **Stripe Dashboard → Webhooks → Add destination:**

   | Field | Value |
   |---|---|
   | Endpoint URL | `https://your-app.vercel.app/api/webhooks/stripe` |
   | Events from | **Your account** |
   | Payload style | **Snapshot** |
   | API version | `2026-06-24.dahlia` (match the SDK) |
   | Events | the 10 listed above |

4. **Copy that endpoint's signing secret** into `STRIPE_WEBHOOK_SECRET` — then **redeploy**.

> ⚠️ Two traps, both silent:
> - The dashboard's `whsec_` is **not** the same as the Stripe CLI's. Using the wrong one makes every
>   event fail with `400 Invalid signature`.
> - Changing an env var **does not** trigger a redeploy. Vercel keeps serving the old value until you
>   redeploy by hand.

5. **Verify:** Send test event → `payment_intent.succeeded` → expect **200**, then check `/events`.

`application_fee.created` only appears in Stripe's event list **after Connect is enabled** — it's the
one event you may have to come back and add.

---

## Security

| | |
|---|---|
| **Secret key** | Server-only. Every module touching it imports `server-only`, so a client import is a **build error**, not a runtime leak |
| **Card data** | Never touches our origin — typed into Stripe's iframe (SAQ-A) |
| **Webhooks** | HMAC-verified on raw bytes; unsigned requests rejected with 400 *before* any business logic runs |
| **Idempotency** | Unique index, plus Stripe idempotency keys on every mutating API call — a double-clicked refund refunds once |
| **Sessions** | httpOnly, `SameSite=Lax`, HMAC-SHA256 signed, verified in **constant time**. A tampered cookie is discarded, never trusted |
| **Admin** | Password-gated, `SameSite=Strict`, constant-time comparison, rate-limited. Authorisation is re-checked **inside every Server Action** — a Server Action is a POST to the page's own route, and proxy coverage of it is easy to lose in a refactor |
| **Receipts** | Scoped to the session owner. Payment ids are guessable-adjacent, so without the ownership check anyone could enumerate other people's receipts |
| **Input** | Every action, route and search param validated with Zod. `?next=` redirects restricted to same-site paths (no open redirect) |
| **Headers** | CSP with per-request nonce, HSTS, `X-Frame-Options: DENY`, `nosniff`, `frame-ancestors 'none'` |
| **Logs** | Structured JSON with card numbers, secret keys and client secrets redacted |
| **Live keys** | The app **refuses to boot** with an `sk_live_` key |

**Honest limitation:** rate limiting is in-process, per instance. It exists to stop one client hammering
Stripe, not as a security boundary — a real deployment would back it with Redis. The interface in
[`src/lib/rate-limit.ts`](src/lib/rate-limit.ts) wouldn't change.

---

## Layout

```
src/
├── proxy.ts                  Next 16 "middleware" — session bootstrap, admin gate, CSP nonce
│
├── lib/
│   ├── env.ts                lazily validated (a missing key must not break `next build`)
│   ├── db.ts                 cached Mongoose connection (HMR- and serverless-safe)
│   ├── stripe.ts             pinned API version, lazily constructed
│   ├── session-crypto.ts     HMAC cookie signing — shared by the proxy and the app
│   ├── rate-limit.ts         fixed-window limiter
│   ├── logger.ts             structured JSON, with PAN/secret redaction
│   ├── catalog.ts            plans, products, the six test-card scenarios
│   └── domain.ts             enums + the plain shapes that cross to the client
│
├── models/                   Mongoose schemas · the UNIQUE index that powers idempotency
│
├── server/                   the service layer — Stripe logic lives here, never inline in a route
│   ├── actions.ts            Server Actions (zod-validated, rate-limited)
│   ├── checkout.ts           payment intents · subscriptions · marketplace splits
│   ├── subscriptions.ts      proration · cancel (both modes) · resume
│   ├── refunds.ts            full + partial
│   ├── connect.ts            Express onboarding, destination charges
│   ├── access.ts             the entitlement state machine
│   ├── receipt.ts            the PDF's HTML (themed, self-contained)
│   ├── pdf.ts                headless Chrome rendering
│   └── webhooks/             verify → dedupe → handle → log
│
├── components/               shared UI (the design system lives in app/globals.css)
└── app/                      landing · scenarios · checkout · premium · dashboard · connect · events · admin
```

---

## Scripts

```bash
npm run dev             # dev server (Turbopack)
npm run build           # production build
npm run typecheck       # tsc --noEmit
npm run lint
npm run db:indexes      # build MongoDB indexes — REQUIRED for webhook idempotency
npm run stripe:listen   # forward Stripe webhooks to localhost:3000
npm run chrome:install  # Chrome for Testing, for local PDF receipts (no sudo)
```

---

<div align="center">

**Test mode only. No real money moves.**

[Live demo](https://ledger-alpha-green.vercel.app/) · [Event log](https://ledger-alpha-green.vercel.app/events) · [Test scenarios](https://ledger-alpha-green.vercel.app/scenarios)

</div>
