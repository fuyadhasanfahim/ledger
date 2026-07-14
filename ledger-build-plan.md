# Ledger — Build Plan

**A live Stripe integration demo for a developer portfolio.** Clients can drive every payment flow themselves using Stripe test cards — subscriptions, one-time checkout, marketplace splits, refunds, and failed-payment recovery — with the webhook layer visible in real time.

Hand this file to Claude Code as the master brief. Build in the phases below, in order. Don't skip the webhook + idempotency work — that's the part that proves seniority.

---

## Project identity

- **Name:** Ledger
- **Tagline:** Payments that settle exactly as designed.
- **Positioning:** A proof-of-work piece. Code quality, architecture, security, and observability matter as much as features. Everything runs in Stripe **test mode** — no real money moves, and the UI makes that obvious.

---

## Tech stack (fixed)

- **Next.js** (App Router) + **TypeScript**
- **Stripe** test mode — `stripe` (server SDK) + `@stripe/stripe-js` / Stripe Checkout
- **Prisma + PostgreSQL** (Neon)
- **Tailwind CSS**
- **Deploy:** Vercel. All keys in Vercel env vars. Secret key server-side only, never in the client bundle.

---

## Design direction — "Ledger" look

Keep it distinct from a generic SaaS template. Warm paper / receipt aesthetic:

- **Background:** warm off-white `#e8e6dc` with faint horizontal ruled lines (ledger paper)
- **Ink:** near-black `#12130f`
- **Transaction accents:** green `#1a7f4b` (settled / success), amber `#b8791f` (dunning / pending), red `#b23a2e` (failed / refunded), violet `#5b4b8a` (neutral event)
- **Type:** Space Grotesk for display/headings, JetBrains Mono for ALL numbers, data, card values, event logs, code labels
- **Structural devices:** thin ink rules between sections, mono eyebrows like `// checkout · mode=subscription`, receipt-style split panels
- **Motion:** restrained. The webhook event log animates in as events "arrive." Everything else quiet.

(There's a static HTML reference for the landing look — port its visual language into the Next.js components.)

---

## IMPORTANT — how test cards are shown

Do **not** dump the test card in the hero. Instead build a dedicated **Test Scenarios** section: a gallery of cards, each one a "scenario" the client can copy and use to trigger a specific outcome. Each card in the gallery shows:

- The card number (mono, copy-on-click)
- A label for what it triggers
- A short line explaining the resulting flow
- A status color (green / amber / red) matching the outcome

Scenarios to include (all Stripe official test cards):

| Card | Triggers | Color |
|---|---|---|
| `4242 4242 4242 4242` | Successful payment | green |
| `4000 0000 0000 9995` | Declined — insufficient funds | red |
| `4000 0000 0000 0002` | Declined — generic | red |
| `4000 0025 0000 3155` | Requires authentication (3DS) | amber |
| `4000 0000 0000 0341` | Attaches but fails on charge | red |
| `4000 0000 0000 0259` | Successful, then disputes / becomes refundable | amber |

Under each card: "any future expiry · any CVC · any ZIP." Make it obvious this is test mode, no real charge.

This gallery is a signature feature — it invites the client to actively break things, which is exactly what proves the integration is robust.

---

## Features (full scope)

### 1. One-time payment
- Product checkout via Payment Intent / Checkout Session
- Success → record payment, grant access to a demo "premium" page
- Failure → clear failure state, no access

### 2. Subscription billing
- 2+ plans (Monthly, Yearly). Yearly discounted.
- Create via Checkout Session (mode: subscription)
- Upgrade / downgrade WITH proration
- Cancel (at period end + immediate)
- Live status: active / past_due / canceled / trialing

### 3. Stripe Connect (marketplace)
- Platform fee + connected seller payout on a single payment
- Connect Express test account
- UI shows the split: total, platform fee, seller payout

### 4. Refunds
- Admin button: full or partial refund on any completed payment
- On refund → revoke access, update status, log event

### 5. Failed payment / dunning
- Handle `invoice.payment_failed`
- Retry state, revoke access on final failure
- Clear user-facing recovery messaging

---

## Webhook layer (the proof of seniority)

Single endpoint: `/api/webhooks/stripe`

- **Signature verification** on raw body (`stripe.webhooks.constructEvent`)
- **Idempotent** — dedupe by event ID against DB; replays never double-process
- Handle at minimum:
  - `checkout.session.completed`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.created / updated / deleted`
  - `charge.refunded`
  - `application_fee.created`
- Every event written to a **webhook event log** table: event ID, type, status (processed / failed / ignored), timestamp, summary
- Surface that log in the UI as a live, auto-updating feed (poll or revalidate) — this is a headline feature, not a hidden admin tool

---

## Pages / structure

1. **Landing** — hero, subscription plans, "what runs under the hood" (capabilities + receipt split panel), live event-log preview, CTA
2. **Test Scenarios** — the card gallery described above
3. **Checkout flows** — subscription, one-time, connect
4. **Access page** — gated "premium" content, shows current access state
5. **Live dashboard** — current subscription status, last payment, access status, real-time
6. **Event log** — full webhook feed
7. **Admin** — payments/subscriptions list, trigger refunds, view log

---

## Data model (Prisma — minimum)

- `Customer` (stripeCustomerId, email)
- `Subscription` (stripeSubId, plan, status, currentPeriodEnd)
- `Payment` (stripePaymentIntentId, amount, status, type)
- `Refund` (stripeRefundId, paymentId, amount, status)
- `WebhookEvent` (stripeEventId UNIQUE, type, status, summary, createdAt) ← unique constraint powers idempotency
- `Access` (customerId, granted boolean, reason)

---

## Quality + security checklist

- Typed throughout; Stripe logic in a service layer, not inline in routes
- Error handling + logging on every API route
- Secret key server-side only; never in client bundle
- Webhook signature verification required
- Idempotency via `WebhookEvent.stripeEventId` unique constraint
- `.env.example` committed (no real values); `.env` gitignored
- Obvious "TEST MODE" indicator in the UI

---

## Deliverables

1. Working Next.js app, deployable to Vercel as-is
2. Prisma schema + migrations + seed (plans/products)
3. `.env.example`
4. `README.md`: setup, Stripe CLI webhook testing (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`), Vercel deploy steps, full test-card scenario reference, and a short architecture diagram (customer → checkout → Stripe → webhook → DB → access state)

---

## Suggested build order (phase by phase in Claude Code)

1. **Scaffold** — Next.js + TS + Tailwind + Prisma + Neon connection + design tokens
2. **Data model** — Prisma schema + migrations
3. **One-time payment** — checkout + success/fail + access grant
4. **Webhook endpoint** — signature verify + idempotency + event log table + live feed
5. **Subscriptions** — plans, create, upgrade/downgrade proration, cancel
6. **Refunds** — admin trigger + refund webhook + access revoke
7. **Failed payment / dunning** — invoice.payment_failed handling
8. **Stripe Connect** — marketplace split
9. **Test Scenarios gallery** — the card gallery
10. **Dashboard + admin + polish** — live status, styling pass, README, deploy

Build and test each phase before moving to the next. Use the Stripe CLI to replay events locally.
