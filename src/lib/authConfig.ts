import crypto from 'crypto';
import { Request } from 'express';

export type AuthMode = 'basic' | 'google';

export function getAuthMode(): AuthMode {
  const raw = (process.env.OAUTH_PROVIDER || '').toLowerCase().trim();
  if (raw === 'google') return 'google';
  return 'basic';
}

/**
 * Signing key for basic-mode session cookies (the form login). Prefers an
 * explicit SESSION_SECRET; otherwise derives a stable key from the admin
 * credentials so no extra env var is needed for the simple `docker compose up`
 * flow. Tying it to the password means changing ADMIN_PASSWORD invalidates
 * existing sessions, which is the behavior you'd want.
 */
export function getBasicSessionSecret(): Buffer {
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) return Buffer.from(explicit, 'utf-8');
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASSWORD || 'changeme';
  return crypto.createHash('sha256').update(`ri-basic-session:${user}:${pass}`).digest();
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  allowedEmails: string[];
  allowedDomains: string[];
  publicAdminUrl: string | null;
}

export function getGoogleConfig(): GoogleAuthConfig {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    allowedEmails: splitCsv(process.env.GOOGLE_OAUTH_ALLOWED_EMAILS),
    allowedDomains: splitCsv(process.env.GOOGLE_OAUTH_ALLOWED_DOMAINS),
    publicAdminUrl: process.env.PUBLIC_ADMIN_URL || null,
  };
}

/**
 * Decide whether a Google account is allowed to sign in. Either the email is
 * on the explicit allow-list, or its domain matches the domain allow-list.
 * If both lists are empty, sign-in is refused — better to fail closed than to
 * accidentally expose the dashboard to anyone with a Google account.
 */
export function isAccountAllowed(email: string, cfg: GoogleAuthConfig): boolean {
  const lower = email.toLowerCase();
  if (cfg.allowedEmails.includes(lower)) return true;
  const at = lower.lastIndexOf('@');
  if (at >= 0) {
    const domain = lower.slice(at + 1);
    if (cfg.allowedDomains.includes(domain)) return true;
  }
  return false;
}

/**
 * Best-effort detection of the externally-reachable admin base URL so we can
 * construct an OAuth `redirect_uri` that matches what's registered in the
 * Google Cloud Console. Prefers PUBLIC_ADMIN_URL, then X-Forwarded-* headers,
 * then the request itself.
 */
export function resolvePublicAdminUrl(req: Request, cfg: GoogleAuthConfig): string {
  if (cfg.publicAdminUrl) return cfg.publicAdminUrl.replace(/\/+$/g, '');
  const fwdProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const fwdHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  const proto = fwdProto || (req.secure ? 'https' : 'http');
  const host = fwdHost || (req.headers.host as string | undefined) || 'localhost';
  return `${proto}://${host}`;
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const fwd = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  return fwd === 'https';
}
