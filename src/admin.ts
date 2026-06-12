import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './lib/prisma.js';
import { adminAuth, rateLimiter, verifyBasicCredentials, buildBasicSessionCookie } from './middleware/adminAuth.js';
import { getModelInfo as getOpenRouterModelInfo, getAllModels, getCacheStats as getOpenRouterCacheStats, refreshCache as refreshOpenRouterCache } from './lib/openRouterModels.js';
import { getModelInfo, getContextLength } from './lib/modelInfoService.js';
import { invalidateRoutingCache } from './lib/routing.js';
import { readMediaFile, mimeFromExt } from './lib/mediaStorage.js';
import { rehydrateInlineMedia } from './lib/multimodalProcessor.js';
import {
  defaultCredentialRetentionDays,
  defaultLogRetentionDays,
  defaultMediaRetentionDays,
  normalizeRetentionDays,
} from './lib/retentionConfig.js';
import {
  resolveRange,
  getSummary,
  getTimeseries,
  getTopPrompts,
  getLatency,
  getOpenRouterStats,
  Bucket,
} from './lib/stats.js';
import { getAuthMode, getBasicSessionSecret, getGoogleConfig, isAccountAllowed, resolvePublicAdminUrl, isHttpsRequest } from './lib/authConfig.js';
import {
  buildSessionCookie,
  buildClearSessionCookie,
  readSessionFromHeader,
  signSession,
  verifySession,
  getSessionTtlSeconds,
} from './lib/sessionCookie.js';
import {
  buildAuthorizationUrl,
  buildStateCookie,
  clearStateCookie,
  exchangeCodeForTokens,
  fetchUserInfo,
  getStateCookieName,
  parseStateToken,
  sanitizeReturnTo,
} from './lib/googleOAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readNamedCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const seg of header.split(';')) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    if (seg.slice(0, eq).trim() === name) return seg.slice(eq + 1).trim();
  }
  return null;
}

export function createAdminApp() {
  const app = express();

  // Trust proxy for proper client IP detection behind reverse proxies (Traefik, etc.)
  // Use 1 to trust the first proxy (Traefik). Using 'true' causes express-rate-limit validation errors.
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json());
  app.use(rateLimiter);

  // Health check (no auth)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ==================== AUTH ====================
  // These routes are deliberately mounted BEFORE the adminAuth middleware so
  // the login + callback can run without a session.

  // Public: tells the frontend which auth mode is active and where to send
  // unauthenticated users.
  app.get('/api/auth/config', (_req, res) => {
    const mode = getAuthMode();
    res.json({
      mode,
      loginUrl: mode === 'google' ? '/auth/google/login' : '/api/auth/login',
    });
  });

  // Public: log in with admin username/password (basic mode only). Sets a
  // signed session cookie so the SPA + password managers work without the
  // native browser auth dialog.
  app.post('/api/auth/login', (req, res) => {
    if (getAuthMode() !== 'basic') {
      res.status(404).json({ error: 'Form login is disabled when OAuth is enabled.' });
      return;
    }
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyBasicCredentials(username, password)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    res.setHeader('Set-Cookie', buildBasicSessionCookie(isHttpsRequest(req)));
    res.json({ ok: true, mode: 'basic', user: { name: username } });
  });

  // Public: current session info, or 401 if unauthenticated.
  app.get('/api/auth/me', (req, res) => {
    const mode = getAuthMode();
    if (mode === 'basic') {
      // Authenticated either by a session cookie (form login) or a Basic header
      // (curl / API clients). adminAuth enforces the same two paths. Dashboard
      // requests (X-Dashboard) are cookie-only so a stale cached Basic header
      // can't suppress the login screen after the cookie is cleared.
      const session = verifySession(readSessionFromHeader(req.headers.cookie), getBasicSessionSecret());
      const isDashboard = req.headers['x-dashboard'] === '1';
      const header = (req.headers.authorization || '') as string;
      const hasBasic = !isDashboard && header.toLowerCase().startsWith('basic ');
      if (session || hasBasic) {
        res.json({ mode: 'basic', user: { name: session?.name || process.env.ADMIN_USER || 'admin' } });
        return;
      }
      res.status(401).json({ requiresLogin: true, loginUrl: '/api/auth/login', mode: 'basic' });
      return;
    }
    // Google mode
    const session = verifySession(readSessionFromHeader(req.headers.cookie));
    if (!session) {
      res.status(401).json({ requiresLogin: true, loginUrl: '/auth/google/login', mode: 'google' });
      return;
    }
    res.json({
      mode: 'google',
      user: {
        email: session.email,
        name: session.name,
        picture: session.picture,
      },
    });
  });

  // Step 1: start OAuth flow. Redirects to Google's consent screen.
  app.get('/auth/google/login', (req, res) => {
    if (getAuthMode() !== 'google') {
      res.status(404).send('OAuth is not enabled.');
      return;
    }
    const cfg = getGoogleConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(500).send('Google OAuth is enabled but client credentials are not configured.');
      return;
    }
    const returnTo = typeof req.query.returnTo === 'string'
      ? sanitizeReturnTo(req.query.returnTo)
      : '/';
    const secure = isHttpsRequest(req);
    const { token: state, cookie: stateCookie } = buildStateCookie(returnTo, secure);
    const redirectUri = `${resolvePublicAdminUrl(req, cfg)}/auth/google/callback`;
    const authUrl = buildAuthorizationUrl({ cfg, redirectUri, state, returnTo });
    res.setHeader('Set-Cookie', stateCookie);
    res.redirect(302, authUrl);
  });

  // Step 2: Google redirects back with `code` + `state`. Verify state,
  // exchange code for tokens, fetch userinfo, check allow-list, set session.
  app.get('/auth/google/callback', async (req, res) => {
    if (getAuthMode() !== 'google') {
      res.status(404).send('OAuth is not enabled.');
      return;
    }
    const cfg = getGoogleConfig();
    const secure = isHttpsRequest(req);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookieState = readNamedCookie(req.headers.cookie, getStateCookieName());

    // Always clear the state cookie on the way out
    const setCookies: string[] = [clearStateCookie(secure)];

    if (!code || !state || !cookieState || state !== cookieState) {
      res.setHeader('Set-Cookie', setCookies);
      res.status(400).send('OAuth state mismatch — please retry from the login screen.');
      return;
    }

    const parsedState = parseStateToken(state);
    const returnTo = parsedState?.returnTo || '/';

    try {
      const redirectUri = `${resolvePublicAdminUrl(req, cfg)}/auth/google/callback`;
      const tokens = await exchangeCodeForTokens({ cfg, code, redirectUri });
      const user = await fetchUserInfo(tokens.access_token);

      if (!user.email || !user.email_verified) {
        res.setHeader('Set-Cookie', setCookies);
        res.status(403).send('Google account email is not verified.');
        return;
      }
      if (!isAccountAllowed(user.email, cfg)) {
        res.setHeader('Set-Cookie', setCookies);
        res.status(403).send(`Account ${user.email} is not on the allow-list.`);
        return;
      }

      const sessionToken = signSession({
        sub: user.sub,
        email: user.email,
        name: user.name,
        picture: user.picture,
      });
      setCookies.push(buildSessionCookie(sessionToken, { secure, maxAge: getSessionTtlSeconds() }));
      res.setHeader('Set-Cookie', setCookies);
      res.redirect(302, returnTo);
    } catch (err) {
      console.error('[OAuth] Callback failed:', err);
      res.setHeader('Set-Cookie', setCookies);
      res.status(500).send('Sign-in failed. Please try again.');
    }
  });

  // Logout — clears the session cookie. Works in both modes (no-op for basic).
  app.post('/api/auth/logout', (req, res) => {
    const secure = isHttpsRequest(req);
    res.setHeader('Set-Cookie', buildClearSessionCookie({ secure }));
    res.json({ ok: true });
  });

  // Protected API routes
  app.use('/api', adminAuth);

  // ==================== LOGS ====================

  // Get request logs with filters
  app.get('/api/logs', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
      const offset = parseInt(req.query.offset as string) || 0;
      const method = req.query.method as string;
      const isAiRequest = req.query.isAiRequest as string;
      const targetUrl = req.query.targetUrl as string;
      const from = req.query.from as string;
      const to = req.query.to as string;
      const search = req.query.search as string;
      const statusFilter = req.query.status as string; // "2xx", "3xx", "4xx", "5xx", "errors"
      const systemPromptHash = req.query.systemPromptHash as string;
      const projectTag = req.query.projectTag as string;

      const where: any = {};

      if (method) where.method = method;
      if (isAiRequest !== undefined) where.isAiRequest = isAiRequest === 'true';
      if (targetUrl) where.targetUrl = { contains: targetUrl };
      if (projectTag) where.projectTag = projectTag;
      if (systemPromptHash) where.aiRequest = { systemPromptHash };
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }
      if (search) {
        where.OR = [
          { url: { contains: search } },
          { path: { contains: search } },
          { body: { contains: search } },
          { projectTag: { contains: search } },
        ];
      }
      // Status code filtering
      if (statusFilter) {
        if (statusFilter === 'errors') {
          where.statusCode = { gte: 400 };
        } else if (statusFilter === '2xx') {
          where.statusCode = { gte: 200, lt: 300 };
        } else if (statusFilter === '3xx') {
          where.statusCode = { gte: 300, lt: 400 };
        } else if (statusFilter === '4xx') {
          where.statusCode = { gte: 400, lt: 500 };
        } else if (statusFilter === '5xx') {
          where.statusCode = { gte: 500 };
        }
      }

      const [logs, total] = await Promise.all([
        prisma.requestLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            aiRequest: {
              select: {
                id: true,
                provider: true,
                model: true,
                isStreaming: true,
                totalTokens: true,
                totalCostMicros: true,
                systemPromptHash: true,
              },
            },
          },
        }),
        prisma.requestLog.count({ where }),
      ]);

      res.json({ logs, total, limit, offset });
    } catch (error) {
      console.error('Error fetching logs:', error);
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  // Get single log with full details
  app.get('/api/logs/:id', async (req, res) => {
    try {
      const log = await prisma.requestLog.findUnique({
        where: { id: req.params.id },
        include: { aiRequest: true },
      });

      if (!log) {
        res.status(404).json({ error: 'Log not found' });
        return;
      }

      res.json(log);
    } catch (error) {
      console.error('Error fetching log:', error);
      res.status(500).json({ error: 'Failed to fetch log' });
    }
  });

  // Delete logs
  app.delete('/api/logs', async (req, res) => {
    try {
      const olderThan = req.query.olderThan as string;
      const where = olderThan
        ? { createdAt: { lt: new Date(olderThan) } }
        : {};

      // Delete associated AI requests first
      const logsToDelete = await prisma.requestLog.findMany({
        where,
        select: { aiRequestId: true },
      });

      const aiRequestIds = logsToDelete
        .map((l) => l.aiRequestId)
        .filter((id): id is string => id !== null);

      await prisma.requestLog.deleteMany({ where });

      if (aiRequestIds.length > 0) {
        await prisma.aiRequest.deleteMany({
          where: { id: { in: aiRequestIds } },
        });
      }

      res.json({ deleted: logsToDelete.length });
    } catch (error) {
      console.error('Error deleting logs:', error);
      res.status(500).json({ error: 'Failed to delete logs' });
    }
  });

  // ==================== AI REQUESTS ====================

  // Get AI requests
  app.get('/api/ai-requests', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
      const offset = parseInt(req.query.offset as string) || 0;
      const provider = req.query.provider as string;
      const model = req.query.model as string;
      const from = req.query.from as string;
      const to = req.query.to as string;
      const systemPromptHash = req.query.systemPromptHash as string;

      const where: any = {};

      if (provider) where.provider = provider;
      if (model) where.model = { contains: model };
      if (systemPromptHash) where.systemPromptHash = systemPromptHash;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }

      const [aiRequestsRaw, total] = await Promise.all([
        prisma.aiRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            provider: true,
            endpoint: true,
            kind: true,
            model: true,
            isStreaming: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            totalCostMicros: true,
            timeToFirstToken: true,
            totalDuration: true,
            createdAt: true,
            systemPromptHash: true,
            embeddingInputCount: true,
            embeddingDimensions: true,
            // Tool-call metadata
            hasToolCalls: true,
            toolCallCount: true,
            toolNames: true,
            // OpenRouter-specific fields
            openrouterEnriched: true,
            openrouterProviderName: true,
            openrouterTotalCost: true,
            openrouterCacheDiscount: true,
            openrouterNativeTokensReasoning: true,
            openrouterNativeTokensCached: true,
            // Include requestLog relation to get its ID
            requestLog: {
              select: { id: true },
            },
          } as any,
        }),
        prisma.aiRequest.count({ where }),
      ]);

      // Transform to include requestLogId at top level
      const aiRequests = aiRequestsRaw.map((req: any) => ({
        ...req,
        requestLogId: req.requestLog?.id || null,
        requestLog: undefined, // Remove nested object
      }));

      res.json({ aiRequests, total, limit, offset });
    } catch (error) {
      console.error('Error fetching AI requests:', error);
      res.status(500).json({ error: 'Failed to fetch AI requests' });
    }
  });

  // Get single AI request with full details
  app.get('/api/ai-requests/:id', async (req, res) => {
    try {
      const aiRequest = await prisma.aiRequest.findUnique({
        where: { id: req.params.id },
        include: { requestLog: true },
      });

      if (!aiRequest) {
        res.status(404).json({ error: 'AI request not found' });
        return;
      }

      res.json(aiRequest);
    } catch (error) {
      console.error('Error fetching AI request:', error);
      res.status(500).json({ error: 'Failed to fetch AI request' });
    }
  });

  // Search AI requests by prompt content
  app.get('/api/ai-requests/search/prompt', async (req, res) => {
    try {
      const query = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const hasToolCalls = req.query.hasToolCalls as string;
      const provider = req.query.provider as string;
      const model = req.query.model as string;

      if (!query || query.trim().length < 2) {
        res.status(400).json({ error: 'Search query must be at least 2 characters' });
        return;
      }

      // Build where clause for filters
      const whereFilters: any = {};
      if (hasToolCalls !== undefined) {
        whereFilters.hasToolCalls = hasToolCalls === 'true';
      }
      if (provider) {
        whereFilters.provider = provider;
      }
      if (model) {
        whereFilters.model = { contains: model };
      }

      // Use raw SQL for full-text search across prompt fields
      // SQLite LIKE is case-insensitive by default for ASCII
      const searchPattern = `%${query}%`;

      const results = await prisma.$queryRaw<Array<{
        id: string;
        provider: string;
        model: string | null;
        systemPrompt: string | null;
        userMessages: string | null;
        assistantResponse: string | null;
        hasToolCalls: number;
        toolNames: string | null;
        promptTokens: number | null;
        completionTokens: number | null;
        totalTokens: number | null;
        totalCostMicros: number | null;
        createdAt: string;
      }>>`
        SELECT
          id, provider, model, systemPrompt, userMessages, assistantResponse,
          hasToolCalls, toolNames, promptTokens, completionTokens, totalTokens,
          totalCostMicros, createdAt
        FROM AiRequest
        WHERE (
          systemPrompt LIKE ${searchPattern}
          OR userMessages LIKE ${searchPattern}
          OR assistantResponse LIKE ${searchPattern}
          OR messages LIKE ${searchPattern}
        )
        ${hasToolCalls !== undefined ? (hasToolCalls === 'true' ?
          (prisma.$queryRaw`AND hasToolCalls = 1` as any) :
          (prisma.$queryRaw`AND hasToolCalls = 0` as any)) : ''}
        ORDER BY createdAt DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      // Get total count
      const countResult = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*) as count
        FROM AiRequest
        WHERE (
          systemPrompt LIKE ${searchPattern}
          OR userMessages LIKE ${searchPattern}
          OR assistantResponse LIKE ${searchPattern}
          OR messages LIKE ${searchPattern}
        )
      `;

      res.json({
        results: results.map(r => ({
          ...r,
          hasToolCalls: Boolean(r.hasToolCalls),
        })),
        total: Number(countResult[0]?.count ?? 0),
        limit,
        offset,
        query,
      });
    } catch (error) {
      console.error('Error searching AI requests:', error);
      res.status(500).json({ error: 'Failed to search AI requests' });
    }
  });

  // Replay an AI request with modifications
  app.post('/api/ai-requests/:id/replay', async (req, res) => {
    try {
      const originalRequest = await prisma.aiRequest.findUnique({
        where: { id: req.params.id },
        include: { requestLog: true },
      });

      if (!originalRequest) {
        res.status(404).json({ error: 'AI request not found' });
        return;
      }

      if (!originalRequest.requestLog) {
        res.status(400).json({ error: 'Original request log not found' });
        return;
      }

      // Get modifications from request body
      const {
        model,
        temperature,
        maxTokens,
        systemPrompt,
        messages,
      } = req.body;

      // Parse original request
      let requestBody: any = {};
      try {
        requestBody = JSON.parse(originalRequest.fullRequest || '{}');
      } catch {
        res.status(400).json({ error: 'Could not parse original request' });
        return;
      }

      // Apply modifications
      if (model !== undefined) requestBody.model = model;
      if (temperature !== undefined) requestBody.temperature = temperature;
      if (maxTokens !== undefined) {
        requestBody.max_tokens = maxTokens;
        requestBody.max_completion_tokens = maxTokens;
      }
      if (systemPrompt !== undefined) {
        // Update system prompt in messages array
        if (Array.isArray(requestBody.messages)) {
          const systemIndex = requestBody.messages.findIndex((m: any) => m.role === 'system');
          if (systemIndex >= 0) {
            requestBody.messages[systemIndex].content = systemPrompt;
          } else {
            requestBody.messages.unshift({ role: 'system', content: systemPrompt });
          }
        }
        // Also for Anthropic format
        if (requestBody.system !== undefined) {
          requestBody.system = systemPrompt;
        }
      }
      if (messages !== undefined) {
        requestBody.messages = messages;
      }

      // Disable streaming for replay to simplify response handling
      requestBody.stream = false;

      // Get original headers
      let originalHeaders: Record<string, string> = {};
      try {
        originalHeaders = JSON.parse(originalRequest.requestLog.headers || '{}');
      } catch {
        // Use empty headers
      }

      // Build the replay URL using the proxy
      const targetUrl = originalRequest.requestLog.targetUrl;
      const path = originalRequest.requestLog.path;

      // Rehydrate `media:<hash>.<ext>` refs back into data: URLs so the
      // replayed request is wire-compatible with the original upstream call.
      const hydratedBody = await rehydrateInlineMedia(requestBody);

      // Return the modified request data for the frontend to execute
      // (We don't proxy directly from admin to avoid auth issues)
      res.json({
        replayData: {
          targetUrl,
          path,
          fullUrl: `${targetUrl}${path}`,
          method: originalRequest.requestLog.method,
          headers: {
            'Content-Type': 'application/json',
            // Preserve auth header if present (frontend should handle this)
            ...(originalHeaders.authorization ? { Authorization: originalHeaders.authorization } : {}),
          },
          body: hydratedBody,
        },
        original: {
          id: originalRequest.id,
          model: originalRequest.model,
          provider: originalRequest.provider,
        },
        modifications: {
          model: model !== undefined ? model : undefined,
          temperature: temperature !== undefined ? temperature : undefined,
          maxTokens: maxTokens !== undefined ? maxTokens : undefined,
          systemPrompt: systemPrompt !== undefined ? '[modified]' : undefined,
          messages: messages !== undefined ? '[modified]' : undefined,
        },
      });
    } catch (error) {
      console.error('Error preparing replay:', error);
      res.status(500).json({ error: 'Failed to prepare replay' });
    }
  });

  // Get prompt templates (recurring system prompts)
  app.get('/api/ai-requests/templates', async (_req, res) => {
    try {
      // Group requests by system prompt to find templates
      // We use a simple hash approach - in a real app you might want to use
      // more sophisticated similarity matching
      const templates = await prisma.$queryRaw<Array<{
        systemPromptHash: string;
        systemPromptPreview: string;
        count: number;
        avgCost: number;
        avgTokens: number;
        models: string;
        providers: string;
        firstSeen: string;
        lastSeen: string;
      }>>`
        SELECT
          substr(systemPrompt, 1, 100) as systemPromptPreview,
          COUNT(*) as count,
          AVG(totalCostMicros) as avgCost,
          AVG(totalTokens) as avgTokens,
          GROUP_CONCAT(DISTINCT model) as models,
          GROUP_CONCAT(DISTINCT provider) as providers,
          MIN(createdAt) as firstSeen,
          MAX(createdAt) as lastSeen
        FROM AiRequest
        WHERE systemPrompt IS NOT NULL AND systemPrompt != ''
        GROUP BY substr(systemPrompt, 1, 200)
        HAVING count > 1
        ORDER BY count DESC
        LIMIT 50
      `;

      res.json({
        templates: templates.map((t) => ({
          preview: t.systemPromptPreview + (t.systemPromptPreview.length >= 100 ? '...' : ''),
          count: Number(t.count),
          avgCostMicros: Math.round(Number(t.avgCost || 0)),
          avgTokens: Math.round(Number(t.avgTokens || 0)),
          models: t.models ? t.models.split(',') : [],
          providers: t.providers ? t.providers.split(',') : [],
          firstSeen: t.firstSeen,
          lastSeen: t.lastSeen,
        })),
      });
    } catch (error) {
      console.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  // Find similar requests (same system prompt)
  app.get('/api/ai-requests/:id/similar', async (req, res) => {
    try {
      const originalRequest = await prisma.aiRequest.findUnique({
        where: { id: req.params.id },
        select: { systemPrompt: true },
      });

      if (!originalRequest || !originalRequest.systemPrompt) {
        res.json({ similar: [], count: 0 });
        return;
      }

      // Find requests with the same system prompt (first 200 chars)
      const systemPromptPrefix = originalRequest.systemPrompt.substring(0, 200);

      const similar = await prisma.aiRequest.findMany({
        where: {
          id: { not: req.params.id },
          systemPrompt: { startsWith: systemPromptPrefix },
        },
        select: {
          id: true,
          model: true,
          provider: true,
          totalTokens: true,
          totalCostMicros: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const total = await prisma.aiRequest.count({
        where: {
          id: { not: req.params.id },
          systemPrompt: { startsWith: systemPromptPrefix },
        },
      });

      res.json({
        similar,
        count: total,
      });
    } catch (error) {
      console.error('Error fetching similar requests:', error);
      res.status(500).json({ error: 'Failed to fetch similar requests' });
    }
  });

  // ==================== STATS ====================
  // All stats endpoints accept ?from / ?to ISO timestamps and default to the
  // last 30 days. Results are TTL-cached (30–60s) to keep dashboard polling
  // off the DB during normal usage.

  app.get('/api/stats', async (req, res) => {
    try {
      const range = resolveRange(req.query.from as string, req.query.to as string);
      const summary = await getSummary(range);
      res.json(summary);
    } catch (error) {
      console.error('Error fetching stats summary:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  app.get('/api/stats/timeseries', async (req, res) => {
    try {
      const range = resolveRange(req.query.from as string, req.query.to as string);
      const rawBucket = (req.query.bucket as string) || 'day';
      const bucket: Bucket = rawBucket === 'hour' ? 'hour' : 'day';
      const points = await getTimeseries(range, bucket);
      res.json({ bucket, points, range: { from: range.from.toISOString(), to: range.to.toISOString() } });
    } catch (error) {
      console.error('Error fetching timeseries:', error);
      res.status(500).json({ error: 'Failed to fetch timeseries' });
    }
  });

  app.get('/api/stats/top-prompts', async (req, res) => {
    try {
      const range = resolveRange(req.query.from as string, req.query.to as string);
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const prompts = await getTopPrompts(range, limit);
      res.json({ prompts });
    } catch (error) {
      console.error('Error fetching top prompts:', error);
      res.status(500).json({ error: 'Failed to fetch top prompts' });
    }
  });

  app.get('/api/stats/latency', async (req, res) => {
    try {
      const range = resolveRange(req.query.from as string, req.query.to as string);
      const heavyLimit = Math.min(parseInt(req.query.heavyLimit as string) || 10, 50);
      const data = await getLatency(range, heavyLimit);
      res.json(data);
    } catch (error) {
      console.error('Error fetching latency stats:', error);
      res.status(500).json({ error: 'Failed to fetch latency stats' });
    }
  });

  app.get('/api/stats/openrouter', async (req, res) => {
    try {
      const range = resolveRange(req.query.from as string, req.query.to as string);
      const data = await getOpenRouterStats(range);
      res.json(data);
    } catch (error) {
      console.error('Error fetching openrouter stats:', error);
      res.status(500).json({ error: 'Failed to fetch openrouter stats' });
    }
  });

  // ==================== MEDIA ====================

  // Serve a stored media blob (image / audio / video / pdf etc).
  // Path: /api/media/:hash.:ext (e.g. /api/media/abcd1234...png)
  app.get('/api/media/:file', async (req, res) => {
    try {
      const file = req.params.file;
      const dot = file.lastIndexOf('.');
      if (dot < 0) {
        res.status(400).json({ error: 'Invalid media path' });
        return;
      }
      const hash = file.slice(0, dot);
      const ext = file.slice(dot + 1);
      if (!/^[a-f0-9]{64}$/.test(hash) || !/^[a-z0-9]{1,8}$/i.test(ext)) {
        res.status(400).json({ error: 'Invalid media path' });
        return;
      }
      const bytes = await readMediaFile(hash, ext);
      if (!bytes) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }
      res.setHeader('Content-Type', mimeFromExt(ext));
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.setHeader('Content-Length', bytes.length.toString());
      res.send(bytes);
    } catch (error) {
      console.error('Error serving media:', error);
      res.status(500).json({ error: 'Failed to serve media' });
    }
  });

  // ==================== ROUTING RULES ====================

  // Get all routing rules
  app.get('/api/routing-rules', async (_req, res) => {
    try {
      const rules = await prisma.routingRule.findMany({
        orderBy: { priority: 'desc' },
      });
      res.json(rules);
    } catch (error) {
      console.error('Error fetching routing rules:', error);
      res.status(500).json({ error: 'Failed to fetch routing rules' });
    }
  });

  // Create routing rule
  app.post('/api/routing-rules', async (req, res) => {
    try {
      const { name, priority, enabled, matchType, matchPattern, matchHeader, targetUrl } = req.body;

      if (!name || !matchType || !matchPattern || !targetUrl) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      // Validate regex if applicable
      if (matchType.includes('regex')) {
        try {
          new RegExp(matchPattern);
        } catch (e) {
          res.status(400).json({ error: 'Invalid regex pattern' });
          return;
        }
      }

      const rule = await prisma.routingRule.create({
        data: {
          name,
          priority: priority ?? 0,
          enabled: enabled ?? true,
          matchType,
          matchPattern,
          matchHeader: matchHeader || null,
          targetUrl,
        },
      });

      invalidateRoutingCache();
      res.status(201).json(rule);
    } catch (error) {
      console.error('Error creating routing rule:', error);
      res.status(500).json({ error: 'Failed to create routing rule' });
    }
  });

  // Update routing rule
  app.put('/api/routing-rules/:id', async (req, res) => {
    try {
      const { name, priority, enabled, matchType, matchPattern, matchHeader, targetUrl } = req.body;

      // Validate regex if applicable
      if (matchType?.includes('regex') && matchPattern) {
        try {
          new RegExp(matchPattern);
        } catch (e) {
          res.status(400).json({ error: 'Invalid regex pattern' });
          return;
        }
      }

      const rule = await prisma.routingRule.update({
        where: { id: req.params.id },
        data: {
          ...(name !== undefined && { name }),
          ...(priority !== undefined && { priority }),
          ...(enabled !== undefined && { enabled }),
          ...(matchType !== undefined && { matchType }),
          ...(matchPattern !== undefined && { matchPattern }),
          ...(matchHeader !== undefined && { matchHeader }),
          ...(targetUrl !== undefined && { targetUrl }),
        },
      });

      invalidateRoutingCache();
      res.json(rule);
    } catch (error) {
      console.error('Error updating routing rule:', error);
      res.status(500).json({ error: 'Failed to update routing rule' });
    }
  });

  // Delete routing rule
  app.delete('/api/routing-rules/:id', async (req, res) => {
    try {
      await prisma.routingRule.delete({
        where: { id: req.params.id },
      });
      invalidateRoutingCache();
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting routing rule:', error);
      res.status(500).json({ error: 'Failed to delete routing rule' });
    }
  });

  // ==================== CONFIG ====================

  // Get config
  app.get('/api/config', async (_req, res) => {
    try {
      const config = await prisma.config.findUnique({ where: { id: 'default' } });
      res.json(config);
    } catch (error) {
      console.error('Error fetching config:', error);
      res.status(500).json({ error: 'Failed to fetch config' });
    }
  });

  // Update config
  app.put('/api/config', async (req, res) => {
    try {
      const {
        defaultTargetUrl,
        logEnabled,
        maxBodySize,
        aiDetectionEnabled,
        logRetentionDays,
        credentialRetentionDays,
        mediaRetentionDays,
      } = req.body;

      const config = await prisma.config.upsert({
        where: { id: 'default' },
        update: {
          ...(defaultTargetUrl !== undefined && { defaultTargetUrl }),
          ...(logEnabled !== undefined && { logEnabled }),
          ...(maxBodySize !== undefined && { maxBodySize }),
          ...(aiDetectionEnabled !== undefined && { aiDetectionEnabled }),
          ...(logRetentionDays !== undefined && { logRetentionDays: normalizeRetentionDays(logRetentionDays, defaultLogRetentionDays()) }),
          ...(credentialRetentionDays !== undefined && { credentialRetentionDays: normalizeRetentionDays(credentialRetentionDays, defaultCredentialRetentionDays()) }),
          ...(mediaRetentionDays !== undefined && { mediaRetentionDays: normalizeRetentionDays(mediaRetentionDays, defaultMediaRetentionDays()) }),
        },
        create: {
          id: 'default',
          defaultTargetUrl: defaultTargetUrl || null,
          logEnabled: logEnabled ?? true,
          maxBodySize: maxBodySize ?? 1048576,
          aiDetectionEnabled: aiDetectionEnabled ?? true,
          logRetentionDays: logRetentionDays !== undefined ? normalizeRetentionDays(logRetentionDays, defaultLogRetentionDays()) : defaultLogRetentionDays(),
          credentialRetentionDays: credentialRetentionDays !== undefined ? normalizeRetentionDays(credentialRetentionDays, defaultCredentialRetentionDays()) : defaultCredentialRetentionDays(),
          mediaRetentionDays: mediaRetentionDays !== undefined ? normalizeRetentionDays(mediaRetentionDays, defaultMediaRetentionDays()) : defaultMediaRetentionDays(),
        },
      });

      invalidateRoutingCache();
      res.json(config);
    } catch (error) {
      console.error('Error updating config:', error);
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  // ==================== MODEL INFO ====================

  // Get model info - uses OpenRouter as primary source (no auth needed)
  // For provider-specific info, use the request-based endpoint below
  app.get('/api/models/:modelId(*)', async (req, res) => {
    try {
      const params = req.params as Record<string, string>;
      const modelId = params['modelId(*)'] || params['modelId'] || params['0'];

      if (!modelId) {
        res.status(400).json({ error: 'Model ID is required' });
        return;
      }

      // Only use OpenRouter - no provider auth issues
      const model = await getModelInfo(modelId);

      if (!model) {
        res.status(404).json({ error: 'Model not found', modelId });
        return;
      }

      res.json(model);
    } catch (error) {
      console.error('Error fetching model info:', error);
      res.status(500).json({ error: 'Failed to fetch model info' });
    }
  });

  // Get model info by replaying auth from an existing request
  // This allows fetching from providers that require authentication
  app.get('/api/models/:modelId(*)/from-request/:requestId', async (req, res) => {
    try {
      const params = req.params as Record<string, string>;
      const modelId = params['modelId(*)'] || params['modelId'] || params['0'];
      const requestId = req.params.requestId;

      if (!modelId || !requestId) {
        res.status(400).json({ error: 'Model ID and Request ID are required' });
        return;
      }

      // Get the original request to extract auth headers
      const originalRequest = await prisma.requestLog.findUnique({
        where: { id: requestId },
        select: { headers: true, targetUrl: true },
      });

      if (!originalRequest) {
        res.status(404).json({ error: 'Request not found', requestId });
        return;
      }

      // Parse headers and extract auth
      let authHeader: string | null = null;
      try {
        const headers = JSON.parse(originalRequest.headers);
        authHeader = headers['authorization'] || headers['Authorization'] || null;
      } catch {
        // Headers couldn't be parsed
      }

      if (!authHeader) {
        // Fall back to OpenRouter if no auth available
        const model = await getModelInfo(modelId);
        if (model) {
          res.json(model);
          return;
        }
        res.status(404).json({ error: 'Model not found and no auth available for provider lookup', modelId });
        return;
      }

      // Extract base URL from target
      const targetUrl = originalRequest.targetUrl;
      const baseUrl = new URL(targetUrl).origin;

      // Try to fetch from provider with auth replay
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = await response.json() as any;
          const models = data.data || data.models || (Array.isArray(data) ? data : []);

          const foundModel = models.find((m: any) => m.id === modelId || m.name === modelId);
          if (foundModel) {
            res.json({
              id: foundModel.id,
              name: foundModel.name || foundModel.id,
              context_length: foundModel.context_length || foundModel.context_window || foundModel.max_tokens || null,
              pricing: foundModel.pricing ? {
                prompt: parseFloat(foundModel.pricing.prompt) || 0,
                completion: parseFloat(foundModel.pricing.completion) || 0,
              } : undefined,
              source: 'provider',
            });
            return;
          }
        }
      } catch (fetchError) {
        console.log(`[Model Info] Auth replay to ${baseUrl} failed:`, fetchError);
      }

      // Fall back to OpenRouter
      const model = await getModelInfo(modelId);
      if (model) {
        res.json(model);
        return;
      }

      res.status(404).json({ error: 'Model not found', modelId });
    } catch (error) {
      console.error('Error fetching model info with auth replay:', error);
      res.status(500).json({ error: 'Failed to fetch model info' });
    }
  });

  // Get just context length (convenience endpoint)
  app.get('/api/models/:modelId(*)/context-length', async (req, res) => {
    try {
      const params = req.params as Record<string, string>;
      const modelId = params['modelId(*)'] || params['modelId'] || params['0'];

      if (!modelId) {
        res.status(400).json({ error: 'Model ID is required' });
        return;
      }

      const contextLength = await getContextLength(modelId);

      if (contextLength === null) {
        res.status(404).json({ error: 'Context length not found', modelId });
        return;
      }

      res.json({ modelId, context_length: contextLength });
    } catch (error) {
      console.error('Error fetching context length:', error);
      res.status(500).json({ error: 'Failed to fetch context length' });
    }
  });

  // ==================== OPENROUTER MODELS (Direct access) ====================

  // Get model info directly from OpenRouter (bypasses provider check)
  app.get('/api/openrouter/models/:modelId(*)', async (req, res) => {
    try {
      const modelId = (req.params as Record<string, string>)['modelId(*)'];
      const model = await getOpenRouterModelInfo(modelId);

      if (!model) {
        res.status(404).json({ error: 'Model not found in OpenRouter', modelId });
        return;
      }

      res.json(model);
    } catch (error) {
      console.error('Error fetching OpenRouter model info:', error);
      res.status(500).json({ error: 'Failed to fetch model info' });
    }
  });

  // Get all models from OpenRouter (for model selector, search, etc.)
  app.get('/api/openrouter/models', async (_req, res) => {
    try {
      const models = await getAllModels();
      res.json({ models, count: models.length });
    } catch (error) {
      console.error('Error fetching models:', error);
      res.status(500).json({ error: 'Failed to fetch models' });
    }
  });

  // Get cache stats (OpenRouter cache)
  app.get('/api/models/cache-stats', (_req, res) => {
    const openRouterStats = getOpenRouterCacheStats();
    res.json({
      openRouter: openRouterStats,
    });
  });

  // Force refresh OpenRouter cache
  app.post('/api/openrouter/refresh-cache', async (_req, res) => {
    try {
      await refreshOpenRouterCache();
      const stats = getOpenRouterCacheStats();
      res.json({ success: true, ...stats });
    } catch (error) {
      console.error('Error refreshing cache:', error);
      res.status(500).json({ error: 'Failed to refresh cache' });
    }
  });

  // ==================== AI MODEL PRICING ====================

  // Get all pricing
  app.get('/api/pricing', async (_req, res) => {
    try {
      const pricing = await prisma.aiModelPricing.findMany({
        orderBy: [{ provider: 'asc' }, { modelPattern: 'asc' }],
      });
      res.json(pricing);
    } catch (error) {
      console.error('Error fetching pricing:', error);
      res.status(500).json({ error: 'Failed to fetch pricing' });
    }
  });

  // Create/Update pricing
  app.post('/api/pricing', async (req, res) => {
    try {
      const { provider, modelPattern, inputPricePerMillion, outputPricePerMillion } = req.body;

      if (!provider || !modelPattern || inputPricePerMillion === undefined || outputPricePerMillion === undefined) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      // Validate regex
      try {
        new RegExp(modelPattern);
      } catch (e) {
        res.status(400).json({ error: 'Invalid model pattern regex' });
        return;
      }

      const pricing = await prisma.aiModelPricing.upsert({
        where: {
          provider_modelPattern: { provider, modelPattern },
        },
        update: { inputPricePerMillion, outputPricePerMillion },
        create: { provider, modelPattern, inputPricePerMillion, outputPricePerMillion },
      });

      res.json(pricing);
    } catch (error) {
      console.error('Error saving pricing:', error);
      res.status(500).json({ error: 'Failed to save pricing' });
    }
  });

  // Delete pricing
  app.delete('/api/pricing/:id', async (req, res) => {
    try {
      await prisma.aiModelPricing.delete({
        where: { id: req.params.id },
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting pricing:', error);
      res.status(500).json({ error: 'Failed to delete pricing' });
    }
  });

  // Serve static frontend files. In production __dirname is dist/, while tsx
  // dev runs from src/ and needs to point at the Vite build output.
  const publicPath = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
    ? path.join(__dirname, 'public')
    : path.join(__dirname, '..', 'dist', 'public');
  app.use(express.static(publicPath));

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  return app;
}
