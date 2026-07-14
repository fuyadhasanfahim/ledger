"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { IconLoader2 } from "@tabler/icons-react";
import type { ActionResult } from "@/server/actions";
import { FormError, cx } from "@/components/ui";
import type { ReactNode } from "react";

/**
 * Thin wrappers around React 19's form primitives, so no page has to re-derive
 * pending/error handling.
 *
 * `useFormStatus` must be read by a *child* of the <form>, which is why
 * SubmitButton is its own component rather than a prop on ActionForm.
 */

export function SubmitButton({
  children,
  variant = "primary",
  size,
  className,
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm";
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  const variantClass = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    danger: "btn-danger",
    ghost: "btn-ghost",
  }[variant];

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cx(variantClass, size === "sm" && "btn-sm", className)}
      aria-busy={pending}
    >
      {pending ? (
        <IconLoader2 size={14} className="animate-spin" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

/**
 * A <form> bound to a Server Action, surfacing the action's error inline.
 *
 * The action signature is `(prevState, formData)`, which is what useActionState
 * expects — that's why the actions in server/actions.ts take a leading
 * `_prev` argument.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (
    prev: ActionResult | null,
    formData: FormData,
  ) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      <FormError>{state?.error}</FormError>
    </form>
  );
}
