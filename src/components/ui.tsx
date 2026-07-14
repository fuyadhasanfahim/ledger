import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * Shared primitives.
 *
 * These deliberately hold no styling of their own beyond composing the shared
 * classes defined in globals.css — the design system lives in CSS, and these
 * components exist to give it types and structure.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Eyebrow — `// checkout · mode=subscription`                          */
/* ------------------------------------------------------------------ */

/**
 * The `//` prefix is added here rather than typed at each call site — as a bare
 * JSX text node it reads as a comment (to humans and to eslint alike).
 */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cx("eyebrow", className)}>
      <span aria-hidden>{"// "}</span>
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Section heading with a thin ink rule                                */
/* ------------------------------------------------------------------ */

export function SectionHeading({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
}) {
  return (
    <div className="mb-10 max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="h2 mt-3">{title}</h2>
      {intro ? <p className="prose-ink mt-3">{intro}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
/* ------------------------------------------------------------------ */

export type Tone = "settled" | "pending" | "failed" | "event";

const TONE_CLASS: Record<Tone, string> = {
  settled: "badge-settled",
  pending: "badge-pending",
  failed: "badge-failed",
  event: "badge-event",
};

export function Badge({
  tone,
  children,
  dot = true,
}: {
  tone: Tone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={TONE_CLASS[tone]}>
      {dot ? <span className="dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Receipt panel — label left, value right                             */
/* ------------------------------------------------------------------ */

export function Receipt({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx("receipt", className)}>{children}</div>;
}

export function ReceiptRow({
  label,
  value,
  total = false,
}: {
  label: ReactNode;
  value: ReactNode;
  total?: boolean;
}) {
  return (
    <div className={total ? "receipt-total" : "receipt-row"}>
      <span className="receipt-label">{label}</span>
      <span className="receipt-value">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="font-mono text-sm text-ink">{title}</p>
      {hint ? (
        <p className="max-w-sm text-sm text-ink-faint">{hint}</p>
      ) : null}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline form error                                                   */
/* ------------------------------------------------------------------ */

export function FormError({ children }: { children?: string }) {
  if (!children) return null;

  return (
    // whitespace-pre-line: in development the message carries a second line with
    // the underlying cause, and it must not collapse onto one.
    <p className="field-error whitespace-pre-line" role="alert">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Data grid card                                                      */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  const color =
    tone === "settled"
      ? "text-settled"
      : tone === "failed"
        ? "text-failed"
        : tone === "pending"
          ? "text-pending"
          : "text-ink";

  return (
    <div className="card px-5 py-4">
      <p className="receipt-label">{label}</p>
      <p className={cx("num mt-2 text-2xl", color)}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table wrapper — keeps wide tables from breaking the page on mobile  */
/* ------------------------------------------------------------------ */

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-ledger">{children}</table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mono value with a copy affordance is a client component (copy.tsx). */
/* This is the static version, for server-rendered ids.                */
/* ------------------------------------------------------------------ */

export function Mono({
  children,
  className,
  ...rest
}: ComponentPropsWithoutRef<"code"> & { children: ReactNode }) {
  return (
    <code className={cx("num text-xs text-ink-soft", className)} {...rest}>
      {children}
    </code>
  );
}
