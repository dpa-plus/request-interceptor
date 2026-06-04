import basicAuth from 'express-basic-auth';
import rateLimit from 'express-rate-limit';
import { RequestHandler } from 'express';
import { getAuthMode } from '../lib/authConfig.js';
import { readSessionFromHeader, verifySession, SessionPayload } from '../lib/sessionCookie.js';

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

const basicAuthMiddleware: RequestHandler = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASSWORD },
  challenge: true,
  realm: 'Request Interceptor Admin',
}) as unknown as RequestHandler;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: SessionPayload;
    }
  }
}

/**
 * Authenticate the request. In `basic` mode, delegates to express-basic-auth
 * (preserves current behavior). In `google` mode, requires a valid signed
 * session cookie; rejects with 401 + JSON body `{ requiresLogin: true,
 * loginUrl: '/auth/google/login' }` so the frontend can render its login UI.
 */
export const adminAuth: RequestHandler = (req, res, next) => {
  if (getAuthMode() === 'basic') {
    basicAuthMiddleware(req, res, next);
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
  });
};

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
