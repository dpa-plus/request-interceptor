import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { RequestHandler } from 'express';
import { getAuthMode, getBasicSessionSecret } from '../lib/authConfig.js';
import {
  readSessionFromHeader,
  verifySession,
  signSession,
  buildSessionCookie,
  getSessionTtlSeconds,
  SessionPayload,
} from '../lib/sessionCookie.js';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: SessionPayload;
    }
  }
}

/** Constant-time string comparison that doesn't leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  // Hash to a fixed length so differing input lengths don't short-circuit.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/**
 * Validate a username/password pair against the configured admin credentials.
 * Used by both the Basic-auth header path (curl / API clients) and the form
 * login endpoint.
 */
export function verifyBasicCredentials(username: string, password: string): boolean {
  return safeEqual(username, ADMIN_USER) && safeEqual(password, ADMIN_PASSWORD);
}

/** Parse + validate an `Authorization: Basic` header. */
function checkBasicHeader(header: string | undefined): boolean {
  if (!header || !header.toLowerCase().startsWith('basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf-8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  return verifyBasicCredentials(decoded.slice(0, idx), decoded.slice(idx + 1));
}

/** The session identity used for basic-mode logins. */
export function basicSessionPayload(): Omit<SessionPayload, 'iat' | 'exp'> {
  return { sub: ADMIN_USER, email: '', name: ADMIN_USER };
}

/** Build a Set-Cookie value establishing a basic-mode session. */
export function buildBasicSessionCookie(secure: boolean): string {
  const token = signSession(basicSessionPayload(), getBasicSessionSecret());
  return buildSessionCookie(token, { secure, maxAge: getSessionTtlSeconds() });
}

/**
 * Authenticate the request.
 *
 * Basic mode accepts EITHER a valid session cookie (set by the in-page form
 * login, so password managers work) OR an `Authorization: Basic` header (so
 * `curl -u admin:changeme` and the API docs keep working). On failure it
 * returns a 401 JSON body the frontend uses to render the login form —
 * deliberately WITHOUT a `WWW-Authenticate` challenge, so browsers never pop
 * the native credential dialog.
 *
 * Google mode requires a valid signed session cookie.
 */
export const adminAuth: RequestHandler = (req, res, next) => {
  if (getAuthMode() === 'basic') {
    const session = verifySession(readSessionFromHeader(req.headers.cookie), getBasicSessionSecret());
    if (session) {
      req.authUser = session;
      next();
      return;
    }
    // Dashboard SPA requests (marked by apiFetch) authenticate by session
    // cookie only — never via a Basic header. Browsers keep auto-sending cached
    // Basic credentials after "clear site data", so honoring them here would
    // keep the user silently logged in instead of showing the login screen.
    const isDashboard = req.headers['x-dashboard'] === '1';
    if (!isDashboard && checkBasicHeader(req.headers.authorization)) {
      const now = Math.floor(Date.now() / 1000);
      req.authUser = { ...basicSessionPayload(), iat: now, exp: now };
      next();
      return;
    }
    res.status(401).json({
      error: 'Unauthorized',
      requiresLogin: true,
      loginUrl: '/api/auth/login',
      mode: 'basic',
    });
    return;
  }

  const session = verifySession(readSessionFromHeader(req.headers.cookie));
  if (session) {
    req.authUser = session;
    next();
    return;
  }
  res.status(401).json({
    error: 'Unauthorized',
    requiresLogin: true,
    loginUrl: '/auth/google/login',
    mode: 'google',
  });
};

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
