"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { bareNumber, type Scenario, type ScenarioTone } from "@/lib/catalog";
import { Badge, cx, type Tone } from "@/components/ui";

/**
 * A single test-card scenario. Click the number to copy it.
 *
 * This gallery is the invitation to break things: each card forces a specific
 * branch of the integration, and the event log shows what the branch did.
 */

const TONE: Record<ScenarioTone, Tone> = {
  settled: "settled",
  pending: "pending",
  failed: "failed",
};

const ACCENT: Record<ScenarioTone, string> = {
  settled: "before:bg-settled",
  pending: "before:bg-pending",
  failed: "before:bg-failed",
};

export function ScenarioCard({
  scenario,
  index,
}: {
  scenario: Scenario;
  index: number;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(bareNumber(scenario.number));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). Say nothing —
      // the number is right there to select by hand.
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.06, 0.3) }}
      className={cx(
        "card relative flex flex-col gap-4 p-5",
        // A coloured spine down the left edge, matching the outcome.
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        ACCENT[scenario.tone],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <Badge tone={TONE[scenario.tone]}>{scenario.triggers}</Badge>
      </div>

      <button
        type="button"
        onClick={copy}
        className="group flex items-center justify-between gap-3 rounded-card border border-rule bg-paper px-3 py-2.5 text-left transition-colors hover:border-ink"
        aria-label={`Copy card number ${scenario.number}`}
      >
        <span className="num text-sm tracking-[0.06em] text-ink">
          {scenario.number}
        </span>

        <span
          className={cx(
            "shrink-0 transition-colors",
            copied ? "text-settled" : "text-ink-faint group-hover:text-ink",
          )}
          aria-hidden
        >
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
        </span>
      </button>

      {/* Announce the copy without moving anything on screen. */}
      <span className="sr-only" role="status">
        {copied ? "Card number copied" : ""}
      </span>

      <p className="text-sm leading-relaxed text-ink-soft">{scenario.outcome}</p>

      <p className="mt-auto border-t border-rule pt-3 font-mono text-[0.6875rem] text-ink-faint">
        any future expiry · any CVC · any ZIP
      </p>
    </motion.article>
  );
}
