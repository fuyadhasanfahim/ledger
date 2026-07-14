import Link from "next/link";
import { IconBrandGithub } from "@tabler/icons-react";

const COLUMNS: ReadonlyArray<{
  title: string;
  links: ReadonlyArray<{ href: string; label: string; external?: boolean }>;
}> = [
  {
    title: "Flows",
    links: [
      { href: "/#plans", label: "Subscriptions" },
      { href: "/premium", label: "One-time" },
      { href: "/connect", label: "Marketplace split" },
    ],
  },
  {
    title: "Under the hood",
    links: [
      { href: "/events", label: "Webhook event log" },
      { href: "/scenarios", label: "Test scenarios" },
      { href: "/admin", label: "Admin · refunds" },
    ],
  },
  {
    title: "Reference",
    links: [
      {
        href: "https://docs.stripe.com/testing",
        label: "Stripe test cards",
        external: true,
      },
      {
        href: "https://docs.stripe.com/webhooks",
        label: "Stripe webhooks",
        external: true,
      },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-ink bg-paper-raised no-rules">
      <div className="shell py-14">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <p className="display text-lg">Ledger</p>
            <p className="prose-ink mt-2 max-w-xs text-sm">
              Payments that settle exactly as designed. A live Stripe
              integration, running end to end in test mode.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="eyebrow">{column.title}</p>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        // noreferrer/noopener: never hand the target window a
                        // handle back to ours.
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-ink-soft transition-colors hover:text-ink"
                      >
                        {link.label} ↗
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="font-mono text-xs text-ink-soft transition-colors hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">
            Test mode only · no real money moves
          </p>

          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-ink"
          >
            <IconBrandGithub size={14} aria-hidden />
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}
