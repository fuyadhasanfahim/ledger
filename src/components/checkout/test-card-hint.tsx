"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconCheck, IconChevronDown, IconCopy } from "@tabler/icons-react";

import { SCENARIOS, bareNumber, type ScenarioTone } from "@/lib/catalog";
import { cx } from "@/components/ui";

/**
 * The test-card strip under the checkout form.
 *
 * Copy-on-click, not autofill: filling the Element from here is impossible (it's
 * a cross-origin iframe, by design). Stripe's own preset panel can do it and
 * carries four cards; this carries all six scenarios, including the two that
 * break naive integrations — attach-then-fail, and settle-then-dispute.
 */

const ACCENT: Record<ScenarioTone, string> = {
  settled: "text-settled",
  pending: "text-pending",
  failed: "text-failed",
};

export function TestCardHint() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(number: string) {
    try {
      await navigator.clipboard.writeText(bareNumber(number));
      setCopied(number);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). Say nothing —
      // the number is on screen to select by hand.
    }
  }

  return (
    <div className="border-t border-rule bg-paper-sunk">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-paper"
        aria-expanded={open}
      >
        <span className="eyebrow">
          <span aria-hidden>{"// "}</span>test cards · {SCENARIOS.length}
        </span>

        <IconChevronDown
          size={14}
          className={cx(
            "shrink-0 text-ink-faint transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <ul className="divide-y divide-rule border-t border-rule">
              {SCENARIOS.map((scenario) => (
                <li key={scenario.number}>
                  <button
                    type="button"
                    onClick={() => copy(scenario.number)}
                    className="group flex w-full items-center justify-between gap-4 px-6 py-2.5 text-left transition-colors hover:bg-paper"
                    aria-label={`Copy ${scenario.number}`}
                  >
                    <span className="min-w-0">
                      <span className="num block text-xs tracking-[0.06em] text-ink">
                        {scenario.number}
                      </span>
                      <span
                        className={cx(
                          "block truncate font-mono text-[0.6875rem]",
                          ACCENT[scenario.tone],
                        )}
                      >
                        {scenario.triggers}
                      </span>
                    </span>

                    <span
                      className={cx(
                        "shrink-0 transition-colors",
                        copied === scenario.number
                          ? "text-settled"
                          : "text-ink-faint group-hover:text-ink",
                      )}
                      aria-hidden
                    >
                      {copied === scenario.number ? (
                        <IconCheck size={14} />
                      ) : (
                        <IconCopy size={14} />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="px-6 py-3 font-mono text-[0.6875rem] text-ink-faint">
              any future expiry · any CVC · any ZIP
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <span className="sr-only" role="status">
        {copied ? "Card number copied" : ""}
      </span>
    </div>
  );
}
