import type { Metadata } from "next";
import { z } from "zod";
import { IconShieldLock } from "@tabler/icons-react";

import { adminLogin } from "@/server/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * `?next=` decides where we land after login, so it is a redirect target and
 * therefore untrusted. Anything that isn't a same-site absolute path is thrown
 * away — otherwise this is a textbook open redirect.
 */
const nextSchema = z
  .string()
  .refine((v) => v.startsWith("/") && !v.startsWith("//"))
  .catch("/admin");

export default async function AdminLoginPage(
  props: PageProps<"/admin/login">,
) {
  const params = await props.searchParams;

  const next = nextSchema.parse(
    Array.isArray(params.next) ? params.next[0] : (params.next ?? "/admin"),
  );

  return (
    <div className="shell-narrow section">
      <div className="mx-auto max-w-sm">
        <Eyebrow>admin</Eyebrow>

        <h1 className="h2 mt-4">Restricted.</h1>

        <p className="prose-ink mt-3 text-sm">
          The admin panel can issue refunds against real (test-mode) Stripe
          payments, so it&rsquo;s behind a password.
        </p>

        <div className="card mt-8 p-6">
          <ActionForm action={adminLogin}>
            <input type="hidden" name="next" value={next} />

            <label htmlFor="password" className="label">
              Password
            </label>

            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
              placeholder="••••••••"
            />

            <SubmitButton className="mt-4 w-full">
              <IconShieldLock size={14} aria-hidden />
              Enter
            </SubmitButton>
          </ActionForm>

          <p className="mt-4 font-mono text-xs text-ink-faint">
            Set <span className="text-ink">ADMIN_PASSWORD</span> in your env.
            Attempts are rate-limited and the comparison is constant-time.
          </p>
        </div>
      </div>
    </div>
  );
}
