import "server-only";

import { z } from "zod";

/**
 * Server-side environment.
 *
 * Validation is **lazy** (on first access), not at module load. That matters:
 * `next build` imports every module, and a top-level `parse()` would make the
 * build fail on a machine that has no secrets — which is exactly the machine
 * CI runs on. Instead a missing/invalid var throws at the moment it is used,
 * with a message naming the variable.
 */
const serverSchema = z.object({
  MONGODB_URI: z
    .string()
    .startsWith("mongodb", {
      error: "MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string",
    }),

  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("sk_test_", {
      error:
        "Refusing to boot with a non-test Stripe key. Ledger is a demo — it must never touch live mode.",
    }),

  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),

  /**
   * Publishable key. Public by design (it ships in the client bundle), but it is
   * validated here so a missing one fails loudly at boot rather than as a blank
   * card form at checkout. `pk_test_` is enforced for the same reason as the
   * secret key: this demo must never touch live mode.
   */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_test_", {
    error:
      "Refusing to boot with a non-test publishable key. Ledger is a demo — test mode only.",
  }),

  // Signs the visitor session cookie and the admin cookie (HMAC-SHA256).
  SESSION_SECRET: z
    .string()
    .min(32, { error: "SESSION_SECRET must be at least 32 chars — generate with: openssl rand -base64 32" }),

  ADMIN_PASSWORD: z
    .string()
    .min(8, { error: "ADMIN_PASSWORD must be at least 8 chars" }),

  // Absolute origin, used to build Stripe success/cancel return URLs.
  APP_URL: z.url().default("http://localhost:3000"),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** True when the app is running with a real (non-placeholder) Stripe test key. */
export function isConfigured(): boolean {
  return serverSchema.safeParse(process.env).success;
}
