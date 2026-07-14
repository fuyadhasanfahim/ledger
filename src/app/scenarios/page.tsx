import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";

import { SCENARIOS } from "@/lib/catalog";
import { ScenarioCard } from "@/components/scenario-card";
import { Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Test scenarios",
  description:
    "Stripe's official test cards, each one wired to a specific outcome: settle, decline, 3D Secure, fail-on-charge, dispute. Copy one and drive the flow yourself.",
};

export default function ScenariosPage() {
  return (
    <div className="shell section">
      <div className="max-w-2xl">
        <Eyebrow>testing · official stripe cards</Eyebrow>

        <h1 className="h1 mt-5 text-balance">Break it on purpose.</h1>

        <p className="prose-ink mt-6 text-pretty text-lg">
          Each card below forces a specific branch of the integration. Copy one,
          run any checkout with it, then open the{" "}
          <Link href="/events" className="link text-ink">
            event log
          </Link>{" "}
          and watch what the webhook layer did about it.
        </p>

        <p className="mt-4 font-mono text-xs text-ink-faint">
          An integration you can&rsquo;t break is one nobody tried to break.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {SCENARIOS.map((scenario, index) => (
          <ScenarioCard
            key={scenario.number}
            scenario={scenario}
            index={index}
          />
        ))}
      </div>

      <div className="card mt-10 flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div>
          <Eyebrow>next</Eyebrow>
          <p className="prose-ink mt-2 text-sm">
            Pick a card, then start a flow. The declines are the interesting
            ones — they&rsquo;re what a demo usually hides.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <Link href="/#plans" className="btn-secondary">
            Subscribe
          </Link>
          <Link href="/premium" className="btn-primary">
            Buy once
            <IconArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
