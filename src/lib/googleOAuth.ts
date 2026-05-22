import crypto from 'crypto';
import { GoogleAuthConfig } from './authConfig.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const STATE_COOKIE = 'ri_oauth_state';
const STATE_TTL_SECONDS = 10 * 60; // 10 min

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  hd?: string;
}

/**
 * Build the Google Authorization URL for the consent screen.
 */
export function buildAuthorizationUrl(opts: {
  cfg: GoogleAuthConfig;
  redirectUri: string;
  state: string;
  returnTo?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.cfg.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: opts.state,
    access_type: 'online',
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Generate a random state token and accompanying Set-Cookie value used to
 * defend against CSRF on the OAuth callback. The same token is also passed
 * through the `state` query param, and the callback checks both match.
 *
 * `returnTo` is embedded so the user lands back on the page they came from.
 */
export function buildStateCookie(returnTo: string, secure: boolean): { token: string; cookie: string } {
  const random = crypto.randomBytes(16).toString('hex');
  const payload = JSON.stringify({ r: returnTo, n: random });
  const token = Buffer.from(payload, 'utf-8').toString('base64url');
  const parts = [
    `${STATE_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${STATE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return { token, cookie: parts.join('; ') };
}

export function clearStateCookie(secure: boolean): string {
  const parts = [`${STATE_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function getStateCookieName(): string {
  return STATE_COOKIE;
}

export function parseStateToken(token: string): { returnTo: string } | null {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8')) as { r?: unknown };
    const returnTo = typeof payload.r === 'string' && payload.r.startsWith('/') ? payload.r : '/';
    return { returnTo };
  } catch {
    return null;
  }
}

/**
 * Exchange an authorization code for tokens. Throws on failure.
 */
export async function exchangeCodeForTokens(opts: {
  cfg: GoogleAuthConfig;
  code: string;
  redirectUri: string;
}): Promise<{ access_token: string; id_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.cfg.clientId,
    client_secret: opts.cfg.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as { access_token: string; id_token?: string; expires_in?: number };
}

/**
 * Fetch the authenticated user's profile from Google. Implicitly validates
 * the access_token (Google rejects malformed/expired tokens).
 */
export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo request failed: ${res.status}`);
  }
  return (await res.json()) as GoogleUserInfo;
}
