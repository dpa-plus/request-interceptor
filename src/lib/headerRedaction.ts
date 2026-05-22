// Sensitive header names that should never be stored in plaintext beyond the
// configured retention window. Comparison is case-insensitive.
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-amz-security-token',
  'cookie',
  'set-cookie',
]);

export const REDACTED_VALUE = '[REDACTED]';

/**
 * How many days plaintext auth/cookie headers are retained before they get
 * scrubbed by the cleanup job. `0` (the default) means redact immediately on
 * write — the UI will only ever show `[REDACTED]`. Negative values are
 * normalized to 0.
 */
export function getAuthHeaderRetentionDays(): number {
  const raw = process.env.AUTH_HEADER_RETENTION_DAYS;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Return a shallow copy of `headers` with sensitive header values replaced by
 * `[REDACTED]`. Header keys are preserved so the UI still surfaces that the
 * caller sent an auth header — only the secret value is dropped.
 */
export function redactSensitiveHeaders<T extends Record<string, unknown>>(headers: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      out[key] = REDACTED_VALUE;
    } else {
      out[key] = headers[key];
    }
  }
  return out as T;
}

/**
 * Apply redaction conditionally based on `AUTH_HEADER_RETENTION_DAYS`. When
 * retention is 0, headers are scrubbed before they ever hit the DB.
 */
export function redactHeadersForStorage<T extends Record<string, unknown>>(headers: T): T {
  if (getAuthHeaderRetentionDays() === 0) {
    return redactSensitiveHeaders(headers);
  }
  return headers;
}
