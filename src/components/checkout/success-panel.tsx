"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  IconCheck,
  IconClockPause,
  IconDownload,
  IconLoader2,
} from "@tabler/icons-react";

/**
 * The settle-then-confirm panel.
 *
 * When the customer lands here the payment has been confirmed *by Stripe*, but
 * our own record only exists once the signed webhook arrives. That gap is
 * usually a second or two, and pretending it doesn't exist is exactly the bug
 * this whole project is about. So: poll quietly until the webhook lands, and say
 * so honestly while we wait.
 */
export function SuccessPanel({
  settled,
  granted,
  paymentId,
  children,
}: {
  settled: boolean;
  granted: boolean;
  paymentId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);

  // Refresh the server component until the webhook has written the payment.
  useEffect(() => {
    if (settled) return;

    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [settled, router]);

  async function downloadReceipt() {
    if (!paymentId) return;

    setDownloading(true);

    try {
      // Navigating directly would work too, but this keeps a failed render on
      // this page (as an error) instead of dumping the user on a blank tab.
      const response = await fetch(`/api/receipt/${paymentId}`);

      if (!response.ok) throw new Error("render failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `ledger-receipt-${paymentId.slice(-8)}.pdf`;
      link.click();

      URL.revokeObjectURL(url);
    } catch {
      window.open(`/api/receipt/${paymentId}`, "_blank");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className={`flex size-12 items-center justify-center rounded-full border ${
          settled
            ? "border-settled/40 bg-settled-wash text-settled"
            : "border-pending/40 bg-pending-wash text-pending"
        }`}
      >
        {settled ? (
          <IconCheck size={22} aria-hidden />
        ) : (
          <IconClockPause size={22} aria-hidden />
        )}
      </motion.div>

      <h1 className="h1 mt-6 text-balance">
        {settled ? "Settled." : "Settling…"}
      </h1>

      <p className="prose-ink mt-4 text-pretty text-lg">
        {settled ? (
          <>
            Stripe took the payment, the signed webhook came back, and the ledger
            wrote it down.{" "}
            {granted
              ? "Access is granted."
              : "This one doesn't carry an entitlement."}
          </>
        ) : (
          <>
            Stripe has confirmed the payment. We&rsquo;re waiting for the signed
            webhook before we write anything down — a browser redirect isn&rsquo;t
            proof of payment, so it doesn&rsquo;t get to grant you anything.
          </>
        )}
      </p>

      {!settled ? (
        <p className="mt-4 flex items-center gap-2 font-mono text-xs text-ink-faint">
          <IconLoader2 size={13} className="animate-spin" aria-hidden />
          Watching for payment_intent.succeeded…
        </p>
      ) : null}

      {children}

      {settled && paymentId ? (
        <button
          type="button"
          onClick={downloadReceipt}
          disabled={downloading}
          className="btn-primary mt-6"
        >
          {downloading ? (
            <IconLoader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <IconDownload size={14} aria-hidden />
          )}
          Download receipt (PDF)
        </button>
      ) : null}
    </div>
  );
}
