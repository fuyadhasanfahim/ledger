import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TestModeBanner } from "@/components/test-mode-banner";

import "./globals.css";

// next/font self-hosts these at build time — no runtime request to Google, which
// also keeps the CSP free of a third-party font-src exception.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Ledger — Payments that settle exactly as designed",
    template: "%s · Ledger",
  },
  description:
    "A live Stripe integration you can drive yourself: subscriptions, one-time checkout, marketplace splits, refunds and failed-payment recovery — with the webhook layer visible in real time. Test mode only.",
  openGraph: {
    title: "Ledger — Payments that settle exactly as designed",
    description:
      "Drive every payment flow yourself with Stripe test cards, and watch the webhook layer settle in real time.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      {/*
        Browser extensions (Grammarly, password managers, dark-mode addons) inject
        attributes into <body> before React hydrates — e.g. `data-gr-ext-installed`.
        Server HTML and client DOM then disagree and React warns.

        This suppresses the mismatch for *this element's own attributes only*. It
        does not extend to children, so a genuine hydration bug anywhere inside the
        app will still be reported. That containment is the reason it's safe here
        and shouldn't be sprinkled around more widely.
      */}
      <body
        className="flex min-h-dvh flex-col antialiased"
        suppressHydrationWarning
      >
        <TestModeBanner />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
