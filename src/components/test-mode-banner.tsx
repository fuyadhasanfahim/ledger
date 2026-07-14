import { IconFlask2 } from "@tabler/icons-react";

/**
 * The brief is emphatic that test mode must be obvious. This sits above
 * everything, on every page, and never dismisses.
 */
export function TestModeBanner() {
  return (
    <div className="border-b border-pending/30 bg-pending-wash">
      <div className="shell flex items-center justify-center gap-2 py-1.5">
        <IconFlask2 size={13} className="shrink-0 text-pending" aria-hidden />
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-pending">
          Stripe test mode — no real card is charged, no real money moves
        </p>
      </div>
    </div>
  );
}
