/**
 * Formatting helpers. Shared by server and client, so no `server-only` here.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 1200 → "$12.00" */
export function money(minorUnits: number): string {
  return usd.format(minorUnits / 100);
}

/** 1200 → "$12"; 1250 → "$12.50" */
export function moneyCompact(minorUnits: number): string {
  return minorUnits % 100 === 0
    ? usdWhole.format(minorUnits / 100)
    : usd.format(minorUnits / 100);
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function timestamp(date: Date | string): string {
  return dateTime.format(new Date(date));
}

export function day(date: Date | string): string {
  return dateOnly.format(new Date(date));
}

/** "2 minutes ago" — for the live event feed. */
export function relative(date: Date | string): string {
  const then = new Date(date).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/** Truncate a Stripe id for display: `pi_3Abc...XyZ` */
export function shortId(id: string, keep = 10): string {
  return id.length <= keep + 4 ? id : `${id.slice(0, keep)}…${id.slice(-4)}`;
}
