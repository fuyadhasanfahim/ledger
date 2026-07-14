import "server-only";

/**
 * Structured logging. One JSON line per event so Vercel's log drain can index
 * it, with a redaction pass so we never write a card number, a secret key, or a
 * client_secret into logs.
 */
type Level = "info" | "warn" | "error";

const REDACT = /(sk_(?:test|live)_|whsec_|pi_[a-zA-Z0-9]+_secret_)[A-Za-z0-9_-]+/g;
const PAN = /\b(?:\d[ -]*?){13,19}\b/g;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(REDACT, "$1[redacted]").replace(PAN, "[redacted-pan]");
  }
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message) };
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v)]),
    );
  }
  return value;
}

function emit(level: Level, event: string, context: Record<string, unknown>) {
  const line = {
    level,
    event,
    at: new Date().toISOString(),
    ...(redact(context) as Record<string, unknown>),
  };

  const serialized = JSON.stringify(line);

  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const log = {
  info: (event: string, context: Record<string, unknown> = {}) =>
    emit("info", event, context),
  warn: (event: string, context: Record<string, unknown> = {}) =>
    emit("warn", event, context),
  error: (event: string, context: Record<string, unknown> = {}) =>
    emit("error", event, context),
};
