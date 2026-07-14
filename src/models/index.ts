/**
 * Deliberately NOT marked `server-only`.
 *
 * The schemas need to be importable from a plain Node script (`npm run
 * db:indexes`), and `server-only` throws outside a React Server Component. The
 * guard isn't load-bearing here anyway: this module holds no secrets, and
 * importing Mongoose into a client bundle fails loudly on its own. The modules
 * that *do* hold secrets — lib/env, lib/db, lib/stripe — keep the guard.
 */
import { Schema, model, models, type Model, type Types } from "mongoose";
import {
  AccessReason,
  PaymentStatus,
  PaymentType,
  RefundStatus,
  SubscriptionStatus,
  WebhookStatus,
  values,
} from "@/lib/domain";

/**
 * Mongoose models.
 *
 * Every model is registered through `models.X ?? model("X", schema)`. Without
 * that guard, Next's hot reload would re-run this module and Mongoose would
 * throw `OverwriteModelError` on the second evaluation.
 */

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

export interface CustomerDoc {
  _id: Types.ObjectId;
  sessionId: string;
  stripeCustomerId?: string | null;
  email?: string | null;
  connectAccountId?: string | null;
  connectOnboarded: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<CustomerDoc>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    stripeCustomerId: { type: String, default: null, index: true, sparse: true },
    email: { type: String, default: null },
    connectAccountId: { type: String, default: null, sparse: true },
    connectOnboarded: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const CustomerModel: Model<CustomerDoc> =
  (models.Customer as Model<CustomerDoc>) ??
  model<CustomerDoc>("Customer", customerSchema);

/* ------------------------------------------------------------------ */
/* Subscription                                                        */
/* ------------------------------------------------------------------ */

export interface SubscriptionDoc {
  _id: Types.ObjectId;
  stripeSubId: string;
  customerId: Types.ObjectId;
  plan: string;
  stripePriceId?: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<SubscriptionDoc>(
  {
    stripeSubId: { type: String, required: true, unique: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    plan: { type: String, required: true },
    stripePriceId: { type: String, default: null },
    status: {
      type: String,
      enum: values(SubscriptionStatus),
      default: SubscriptionStatus.incomplete,
      index: true,
    },
    currentPeriodEnd: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const SubscriptionModel: Model<SubscriptionDoc> =
  (models.Subscription as Model<SubscriptionDoc>) ??
  model<SubscriptionDoc>("Subscription", subscriptionSchema);

/* ------------------------------------------------------------------ */
/* Payment                                                             */
/* ------------------------------------------------------------------ */

export interface PaymentDoc {
  _id: Types.ObjectId;
  stripePaymentIntentId: string;
  customerId: Types.ObjectId;
  amount: number;
  currency: string;
  status: PaymentStatus;
  type: PaymentType;
  description?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  platformFee?: number | null;
  sellerPayout?: number | null;
  connectAccountId?: string | null;
  amountRefunded: number;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<PaymentDoc>(
  {
    stripePaymentIntentId: { type: String, required: true, unique: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    // Minor units (cents). Never a float — money in a double is a bug waiting.
    amount: { type: Number, required: true },
    currency: { type: String, default: "usd" },
    status: {
      type: String,
      enum: values(PaymentStatus),
      default: PaymentStatus.pending,
      index: true,
    },
    type: { type: String, enum: values(PaymentType), required: true },
    description: { type: String, default: null },
    failureCode: { type: String, default: null },
    failureMessage: { type: String, default: null },
    platformFee: { type: Number, default: null },
    sellerPayout: { type: Number, default: null },
    connectAccountId: { type: String, default: null },
    amountRefunded: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const PaymentModel: Model<PaymentDoc> =
  (models.Payment as Model<PaymentDoc>) ??
  model<PaymentDoc>("Payment", paymentSchema);

/* ------------------------------------------------------------------ */
/* Refund                                                              */
/* ------------------------------------------------------------------ */

export interface RefundDoc {
  _id: Types.ObjectId;
  stripeRefundId: string;
  paymentId: Types.ObjectId;
  amount: number;
  status: RefundStatus;
  reason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<RefundDoc>(
  {
    stripeRefundId: { type: String, required: true, unique: true },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: values(RefundStatus),
      default: RefundStatus.pending,
    },
    reason: { type: String, default: null },
  },
  { timestamps: true },
);

export const RefundModel: Model<RefundDoc> =
  (models.Refund as Model<RefundDoc>) ??
  model<RefundDoc>("Refund", refundSchema);

/* ------------------------------------------------------------------ */
/* WebhookEvent — the idempotency ledger                               */
/* ------------------------------------------------------------------ */

export interface WebhookEventDoc {
  _id: Types.ObjectId;
  stripeEventId: string;
  type: string;
  status: WebhookStatus;
  summary: string;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEventSchema = new Schema<WebhookEventDoc>(
  {
    /**
     * THE guarantee of this whole codebase.
     *
     * `unique: true` becomes a unique index in MongoDB. Inserting a duplicate
     * raises a duplicate-key error (code 11000) *at the database*, which is what
     * makes replay handling safe under concurrency — two simultaneous deliveries
     * of the same event cannot both win. A find-then-insert in application code
     * would have a race window between the two statements.
     *
     * Note this index must actually exist in the cluster: run `npm run db:indexes`.
     * Mongoose's autoIndex builds it in development, but it is disabled in
     * production (index builds are not something you want on a cold request).
     */
    stripeEventId: { type: String, required: true, unique: true },
    type: { type: String, required: true, index: true },
    status: { type: String, enum: values(WebhookStatus), required: true },
    summary: { type: String, required: true },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

webhookEventSchema.index({ createdAt: -1 });

export const WebhookEventModel: Model<WebhookEventDoc> =
  (models.WebhookEvent as Model<WebhookEventDoc>) ??
  model<WebhookEventDoc>("WebhookEvent", webhookEventSchema);

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export interface AccessDoc {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  granted: boolean;
  reason: AccessReason;
  grantedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const accessSchema = new Schema<AccessDoc>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      unique: true,
    },
    granted: { type: Boolean, default: false },
    reason: {
      type: String,
      enum: values(AccessReason),
      default: AccessReason.never_granted,
    },
    grantedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const AccessModel: Model<AccessDoc> =
  (models.Access as Model<AccessDoc>) ??
  model<AccessDoc>("Access", accessSchema);

/** MongoDB's duplicate-key error. The idempotency guard keys off this. */
export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}
