"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { z } from "zod";

import { log } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  adminCookieValue,
  checkAdminPassword,
} from "@/lib/session";
import { requireCustomer } from "@/server/customers";
import { requireAdmin } from "@/server/admin";
import { ensureConnectAccount, onboardingLink } from "@/server/connect";
import { RefundError, paymentById, refundPayment } from "@/server/refunds";
import {
  activeSubscription,
  cancelSubscription,
  changePlan,
  resumeSubscription,
} from "@/server/subscriptions";

/**
 * Server Actions.
 *
 * Every one of them:
 *  - validates its input with Zod (never trusts the FormData),
 *  - resolves the actor from the signed session cookie rather than any id the
 *    client sent,
 *  - rate-limits, because each costs a real Stripe API call,
 *  - returns a typed result instead of throwing raw errors at the user.
 *
 * Note what is absent: nothing here grants access or marks a payment settled.
 * That is the webhook's job alone.
 *
 * Checkout itself is no longer an action — it's an API route that returns a
 * client secret to the themed Payment Element (see /api/checkout).
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const OK: ActionResult = { ok: true };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * Failure message for an unexpected exception.
 *
 * Production stays deliberately vague — a raw error can carry a connection
 * string or a Stripe internal detail, and this string is rendered in a browser.
 * Development appends the real cause, because the vague version turns a
 * five-second fix into a debugging session.
 */
function failWithCause(userMessage: string, error: unknown): ActionResult {
  if (process.env.NODE_ENV === "production") return fail(userMessage);

  const cause =
    error instanceof Error
      ? error.message.split("\n").at(-1)?.trim()
      : String(error);

  return fail(`${userMessage}\n\n[dev] ${cause}`);
}

/** One rate-limit bucket per IP per action family. */
async function guard(bucket: string, limit = 10): Promise<boolean> {
  const ip = clientIp(await headers());
  return rateLimit(`${bucket}:${ip}`, limit, 60_000).ok;
}

/* ------------------------------------------------------------------ */
/* Connect                                                             */
/* ------------------------------------------------------------------ */

export async function startConnectOnboarding(
  _prev: ActionResult | null,
): Promise<ActionResult> {
  if (!(await guard("connect", 5))) {
    return fail("Too many attempts. Wait a minute and try again.");
  }

  let url: string;

  try {
    const customer = await requireCustomer();
    await ensureConnectAccount(customer);
    url = await onboardingLink(customer);
  } catch (error) {
    log.error("action.connect_onboarding_failed", { error });
    return failWithCause("Could not create the onboarding link.", error);
  }

  // redirect() signals by throwing, so it must sit outside the try/catch —
  // inside, the catch would swallow it and the user would never leave.
  redirect(url);
}

/* ------------------------------------------------------------------ */
/* Subscription management                                             */
/* ------------------------------------------------------------------ */

const planSchema = z.object({ plan: z.enum(["monthly", "yearly"]) });

export async function switchPlan(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!(await guard("subscription"))) {
    return fail("Too many attempts. Wait a minute and try again.");
  }

  const parsed = planSchema.safeParse({ plan: formData.get("plan") });
  if (!parsed.success) return fail("Pick a valid plan.");

  try {
    const customer = await requireCustomer();
    const subscription = await activeSubscription(customer.id);

    if (!subscription) return fail("You don't have an active subscription.");

    await changePlan(customer, subscription, parsed.data.plan);
  } catch (error) {
    log.error("action.switch_plan_failed", { error });
    return failWithCause("Could not change the plan.", error);
  }

  revalidatePath("/dashboard");
  return OK;
}

const cancelSchema = z.object({
  mode: z.enum(["immediate", "at_period_end"]),
});

export async function cancel(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!(await guard("subscription"))) {
    return fail("Too many attempts. Wait a minute and try again.");
  }

  const parsed = cancelSchema.safeParse({ mode: formData.get("mode") });
  if (!parsed.success) return fail("Invalid cancellation mode.");

  try {
    const customer = await requireCustomer();
    const subscription = await activeSubscription(customer.id);

    if (!subscription) return fail("You don't have an active subscription.");

    await cancelSubscription(customer, subscription, parsed.data.mode);
  } catch (error) {
    log.error("action.cancel_failed", { error });
    return failWithCause("Could not cancel the subscription.", error);
  }

  revalidatePath("/dashboard");
  return OK;
}

export async function resume(_prev: ActionResult | null): Promise<ActionResult> {
  if (!(await guard("subscription"))) {
    return fail("Too many attempts. Wait a minute and try again.");
  }

  try {
    const customer = await requireCustomer();
    const subscription = await activeSubscription(customer.id);

    if (!subscription) return fail("You don't have an active subscription.");

    await resumeSubscription(customer, subscription);
  } catch (error) {
    log.error("action.resume_failed", { error });
    return failWithCause("Could not resume the subscription.", error);
  }

  revalidatePath("/dashboard");
  return OK;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({
  password: z.string().min(1),
  // Relative paths only — an absolute URL here would be an open redirect.
  next: z
    .string()
    .refine((v) => v.startsWith("/") && !v.startsWith("//"))
    .default("/admin"),
});

export async function adminLogin(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  // Tighter bucket: this is the one endpoint worth brute-forcing.
  if (!(await guard("admin-login", 5))) {
    return fail("Too many attempts. Wait a minute and try again.");
  }

  const rawNext = formData.get("next");

  const parsed = loginSchema.safeParse({
    password: formData.get("password"),
    next: typeof rawNext === "string" && rawNext !== "" ? rawNext : undefined,
  });

  if (!parsed.success) return fail("Enter the admin password.");

  if (!checkAdminPassword(parsed.data.password)) {
    log.warn("admin.login_failed");
    return fail("Incorrect password.");
  }

  const jar = await cookies();
  jar.set(ADMIN_COOKIE, adminCookieValue(), adminCookieOptions);

  log.info("admin.login_succeeded");

  redirect(parsed.data.next);
}

export async function adminLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect("/");
}

const refundSchema = z.object({
  paymentId: z.string().min(1),
  // Dollars, from the form. Blank means a full refund.
  amount: z.coerce.number().positive().optional(),
});

export async function issueRefund(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  // Re-asserted here, not just in the proxy: a Server Action is a POST to the
  // page route, and proxy coverage of it is easy to lose in a refactor.
  await requireAdmin();

  if (!(await guard("refund", 20))) {
    return fail("Too many refund attempts. Wait a minute.");
  }

  const rawAmount = formData.get("amount");

  const parsed = refundSchema.safeParse({
    paymentId: formData.get("paymentId"),
    amount:
      typeof rawAmount === "string" && rawAmount.trim() !== ""
        ? rawAmount.trim()
        : undefined,
  });

  if (!parsed.success) {
    return fail("Enter a valid amount, or leave it blank for a full refund.");
  }

  try {
    const payment = await paymentById(parsed.data.paymentId);
    if (!payment) return fail("That payment no longer exists.");

    // The form speaks dollars; Stripe speaks minor units.
    const minorUnits =
      parsed.data.amount === undefined
        ? undefined
        : Math.round(parsed.data.amount * 100);

    await refundPayment(payment, minorUnits);
  } catch (error) {
    if (error instanceof RefundError) return fail(error.message);

    log.error("action.refund_failed", { error });
    return failWithCause("Stripe rejected the refund.", error);
  }

  revalidatePath("/admin");
  return OK;
}
