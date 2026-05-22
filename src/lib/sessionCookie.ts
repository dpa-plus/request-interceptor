import crypto from 'crypto';

const COOKIE_NAME = 'ri_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface SessionPayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  iat: number;
  exp: number;
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export function getSessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS;
}

function getSecret(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET must be set to a string of at least 16 characters when OAUTH_PROVIDER is enabled.'
    );
  }
  return Buffer.from(secret, 'utf-8');
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(secret: Buffer, payload: string): string {
  return b64urlEncode(crypto.createHmac('sha256', secret).update(payload).digest());
}

/**
 * Sign a session payload into a compact `<b64-payload>.<b64-sig>` string.
 */
export function signSession(payload: Omit<SessionPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = { ...payload, iat: now, exp: now + SESSION_TTL_SECONDS };
  const encoded = b64urlEncode(Buffer.from(JSON.stringify(full), 'utf-8'));
  const sig = hmac(getSecret(), encoded);
  return `${encoded}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  let expectedSig: string;
  try {
    expectedSig = hmac(getSecret(), encoded);
  } catch {
    return null;
  }
  // Constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString('utf-8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

/**
 * Build a Set-Cookie value for the session.
 */
export function buildSessionCookie(value: string, opts: { secure: boolean; maxAge?: number }): string {
  const maxAge = opts.maxAge ?? SESSION_TTL_SECONDS;
  const parts = [
    `${COOKIE_NAME}=${value}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie(opts: { secure: boolean }): string {
  return buildSessionCookie('', { ...opts, maxAge: 0 });
}

/**
 * Parse the `ri_session` cookie out of the request `Cookie` header.
 */
export function readSessionFromHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const segments = cookieHeader.split(';');
  for (const seg of segments) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    const name = seg.slice(0, eq).trim();
    if (name === COOKIE_NAME) return seg.slice(eq + 1).trim();
  }
  return null;
}
