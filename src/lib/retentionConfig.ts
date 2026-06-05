export const DEFAULT_LOG_RETENTION_DAYS = 30;
export const DEFAULT_CREDENTIAL_RETENTION_DAYS = 0;
export const DEFAULT_MEDIA_RETENTION_DAYS = 30;

function envRetentionDays(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return normalizeRetentionDays(raw, fallback);
}

export function normalizeRetentionDays(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function defaultLogRetentionDays(): number {
  return envRetentionDays('LOG_RETENTION_DAYS', DEFAULT_LOG_RETENTION_DAYS);
}

export function defaultCredentialRetentionDays(): number {
  return envRetentionDays('AUTH_HEADER_RETENTION_DAYS', DEFAULT_CREDENTIAL_RETENTION_DAYS);
}

export function defaultMediaRetentionDays(): number {
  return envRetentionDays('MEDIA_RETENTION_DAYS', DEFAULT_MEDIA_RETENTION_DAYS);
}
