"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { IconArrowRight, IconCheck } from "@tabler/icons-react";

import { PLANS, type PlanId } from "@/lib/catalog";
import { moneyCompact } from "@/lib/format";
import { Eyebrow, cx } from "@/components/ui";

/**
 * Plan gallery.
 *
 * These are plain links now, not form actions: checkout happens on our own
 * /checkout page, so the plan travels in the query string rather than a POST.
 * next/link prefetches, so the page is already warm by the time it's clicked.
 */
export function PlanCards({ currentPlan }: { currentPlan?: PlanId | null }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {PLANS.map((plan, index) => {
        const isCurrent = currentPlan === plan.id;

        return (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: index * 0.08 }}
            className={cx(
              "card flex flex-col p-6",
              plan.featured && !isCurrent && "border-ink",
              isCurrent && "border-settled bg-settled-wash",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Eyebrow>plan · {plan.id}</Eyebrow>
                <h3 className="h3 mt-2">{plan.name}</h3>
              </div>

              {isCurrent ? (
                <span className="badge-settled">
                  <span className="dot" aria-hidden />
                  Current
                </span>
              ) : plan.savingsPct ? (
                <span className="badge-event">Save {plan.savingsPct}%</span>
              ) : null}
            </div>

            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="num text-4xl text-ink">
                {moneyCompact(plan.amount)}
              </span>
              <span className="font-mono text-xs text-ink-faint">
                / {plan.interval}
              </span>
            </p>

            <p className="prose-ink mt-2 text-sm">{plan.blurb}</p>

            <ul className="mt-5 space-y-2">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2 text-sm text-ink-soft"
                >
                  <IconCheck
                    size={14}
                    className="mt-0.5 shrink-0 text-settled"
                    aria-hidden
                  />
                  {feature}
                </li>
              ))}
            </ul>

            <div className="mt-6 pt-1">
              {isCurrent ? (
                <p className="font-mono text-xs text-settled">
                  You&rsquo;re on this plan.
                </p>
              ) : (
                <Link
                  href={`/checkout?mode=subscription&plan=${plan.id}`}
                  className={cx(
                    "w-full",
                    plan.featured ? "btn-primary" : "btn-secondary",
                  )}
                >
                  Subscribe {plan.name}
                  <IconArrowRight size={14} aria-hidden />
                </Link>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
