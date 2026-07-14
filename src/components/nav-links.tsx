"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { motion } from "motion/react";
import { cx } from "@/components/ui";

/**
 * `Route` typing means a typo in one of these hrefs is a build error, not a
 * 404 someone finds in production (next.config: typedRoutes).
 */
const LINKS: ReadonlyArray<{ href: Route; label: string }> = [
  { href: "/scenarios", label: "Scenarios" },
  { href: "/premium", label: "Access" },
  { href: "/connect", label: "Marketplace" },
  { href: "/events", label: "Events" },
  { href: "/dashboard", label: "Dashboard" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Primary">
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            // Next prefetches these on hover/viewport by default — the nav feels
            // instant without any manual work.
            className={cx(
              "relative px-2.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] transition-colors sm:px-3",
              active ? "text-ink" : "text-ink-faint hover:text-ink",
            )}
            aria-current={active ? "page" : undefined}
          >
            {link.label}

            {active ? (
              // Shared layout animation: the underline slides between items.
              <motion.span
                layoutId="nav-underline"
                className="absolute inset-x-2.5 -bottom-px h-px bg-ink sm:inset-x-3"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
