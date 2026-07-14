import "server-only";

import type { Payment } from "@/lib/domain";
import { money, timestamp } from "@/lib/format";

/**
 * The receipt, as a standalone HTML document.
 *
 * Kept separate from the React tree on purpose: Puppeteer renders this string
 * directly, so the PDF can't drift when a page component changes. It also means
 * no Tailwind — the CSS is inlined, because the headless browser has no build
 * pipeline and the design tokens have to be literal.
 */
export function receiptHtml(payment: Payment): string {
  const isRefunded = payment.amountRefunded > 0;

  const rows: Array<[string, string]> = [
    ["Receipt no.", payment.id.slice(-12).toUpperCase()],
    ["Date", timestamp(payment.createdAt)],
    ["Payment intent", payment.stripePaymentIntentId],
    ["Type", payment.type.replace("_", " ")],
    ["Status", payment.status.replace("_", " ")],
  ];

  if (payment.platformFee !== null && payment.sellerPayout !== null) {
    rows.push(["Platform fee", `− ${money(payment.platformFee)}`]);
    rows.push(["Seller payout", money(payment.sellerPayout)]);
  }

  if (isRefunded) {
    rows.push(["Refunded", `− ${money(payment.amountRefunded)}`]);
  }

  const net = payment.amount - payment.amountRefunded;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ledger receipt ${payment.id}</title>
<style>
  @page { size: A4; margin: 0; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    width: 210mm;
    min-height: 297mm;
    padding: 24mm 22mm;
    background: #e8e6dc;
    color: #12130f;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .mono {
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }

  .eyebrow {
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #85867c;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 14px;
    border-bottom: 1px solid #12130f;
  }

  h1 { font-size: 26px; letter-spacing: -0.02em; font-weight: 500; }

  .test-badge {
    display: inline-block;
    margin-top: 6px;
    padding: 3px 8px;
    border: 1px solid rgba(184,121,31,.4);
    background: #f0e4cd;
    color: #b8791f;
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .amount {
    margin-top: 34px;
    padding: 22px;
    background: #f0eee6;
    border: 1px solid #c9c6b8;
  }

  .amount .value {
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 40px;
    letter-spacing: -0.02em;
  }

  table { width: 100%; margin-top: 28px; border-collapse: collapse; }

  td {
    padding: 11px 0;
    border-bottom: 1px solid #c9c6b8;
    font-size: 12px;
  }

  td:first-child {
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #85867c;
  }

  td:last-child {
    text-align: right;
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  }

  .total td {
    border-bottom: none;
    border-top: 1px solid #12130f;
    padding-top: 14px;
    font-size: 15px;
    font-weight: 600;
  }

  footer {
    margin-top: 40px;
    padding-top: 14px;
    border-top: 1px solid #c9c6b8;
    font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 9px;
    line-height: 1.8;
    color: #85867c;
  }

  .settled { color: #1a7f4b; }
  .failed  { color: #b23a2e; }
</style>
</head>
<body>
  <header>
    <div>
      <h1>Ledger</h1>
      <p class="eyebrow" style="margin-top:4px">Payments that settle exactly as designed</p>
    </div>
    <div style="text-align:right">
      <p class="test-badge">Test mode — not a real charge</p>
    </div>
  </header>

  <div class="amount">
    <p class="eyebrow">${isRefunded ? "Net after refund" : "Amount paid"}</p>
    <p class="value ${isRefunded ? "failed" : "settled"}" style="margin-top:6px">
      ${money(net)}
    </p>
    <p class="mono" style="margin-top:6px;font-size:11px;color:#4a4b44">
      ${payment.description ?? payment.type.replace("_", " ")}
    </p>
  </div>

  <table>
    ${rows
      .map(
        ([label, value]) =>
          `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`,
      )
      .join("\n    ")}
    <tr class="total">
      <td>Total</td>
      <td>${money(net)}</td>
    </tr>
  </table>

  <footer>
    <p>This document was generated from a Stripe test-mode payment. No money moved.</p>
    <p>Access is granted only by a signature-verified webhook — never by a browser redirect.</p>
    <p style="margin-top:8px">${escapeHtml(payment.stripePaymentIntentId)}</p>
  </footer>
</body>
</html>`;
}

/**
 * Escape anything interpolated into the receipt.
 *
 * Most of these values come from Stripe, but `description` originates from our
 * own catalog and ids are strings we join — treating all of them as untrusted
 * costs nothing and means this template can never become an HTML-injection
 * vector if a future field is user-supplied.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
