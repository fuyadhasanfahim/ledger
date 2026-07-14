import Link from "next/link";
import { NavLinks } from "@/components/nav-links";

/**
 * Server component shell; the active-link highlighting needs the pathname, so
 * that part (and only that part) is a client component.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-sm">
      <div className="shell flex h-14 items-center justify-between gap-6">
        <Link
          href="/"
          className="group flex items-baseline gap-2"
          aria-label="Ledger — home"
        >
          <span className="display text-lg tracking-[-0.03em]">Ledger</span>
          <span className="hidden font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-faint sm:inline">
            / stripe
          </span>
        </Link>

        <NavLinks />
      </div>
    </header>
  );
}
