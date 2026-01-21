import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './lib/prisma.js';
import { adminAuth, rateLimiter } from './middleware/adminAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAdminApp() {
  const app = express();

  // Trust proxy for proper client IP detection behind reverse proxies (Traefik, etc.)
  app.set('trust proxy', true);

  app.use(cors());
  app.use(express.json());
  app.use(rateLimiter);

  // Health check (no auth)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

      const where: any = {};

      if (method) where.method = method;
      if (isAiRequest !== undefined) where.isAiRequest = isAiRequest === 'true';
      if (targetUrl) where.targetUrl = { contains: targetUrl };
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
        ];
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

      const where: any = {};

      if (provider) where.provider = provider;
      if (model) where.model = { contains: model };
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }

      const [aiRequests, total] = await Promise.all([
        prisma.aiRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            provider: true,
            endpoint: true,
            model: true,
            isStreaming: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            totalCostMicros: true,
            timeToFirstToken: true,
            totalDuration: true,
            createdAt: true,
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
          } as any,
        }),
        prisma.aiRequest.count({ where }),
      ]);

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
          body: requestBody,
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

  app.get('/api/stats', async (req, res) => {
    try {
      const from = req.query.from as string;
      const to = req.query.to as string;

      const dateFilter: any = {};
      if (from || to) {
        dateFilter.createdAt = {};
        if (from) dateFilter.createdAt.gte = new Date(from);
        if (to) dateFilter.createdAt.lte = new Date(to);
      }

      const [
        totalRequests,
        totalAiRequests,
        aiStats,
        recentErrors,
        requestsByMethod,
      ] = await Promise.all([
        prisma.requestLog.count({ where: dateFilter }),
        prisma.requestLog.count({ where: { ...dateFilter, isAiRequest: true } }),
        prisma.aiRequest.aggregate({
          where: dateFilter,
          _sum: {
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            totalCostMicros: true,
          },
          _avg: {
            totalDuration: true,
            timeToFirstToken: true,
          },
        }),
        prisma.requestLog.count({
          where: {
            ...dateFilter,
            statusCode: { gte: 400 },
          },
        }),
        prisma.requestLog.groupBy({
          by: ['method'],
          where: dateFilter,
          _count: true,
        }),
      ]);

      // AI usage by provider
      const usageByProvider = await prisma.aiRequest.groupBy({
        by: ['provider'],
        where: dateFilter,
        _sum: {
          totalTokens: true,
          totalCostMicros: true,
        },
        _count: true,
      });

      // AI usage by model
      const usageByModel = await prisma.aiRequest.groupBy({
        by: ['model'],
        where: dateFilter,
        _sum: {
          totalTokens: true,
          totalCostMicros: true,
        },
        _count: true,
        orderBy: {
          _sum: {
            totalCostMicros: 'desc',
          },
        },
        take: 10,
      });

      // OpenRouter-specific stats - using raw query for new fields
      const openrouterStats = await prisma.$queryRaw<Array<{
        count: number;
        totalCost: number | null;
        cacheDiscount: number | null;
        reasoningTokens: number | null;
        cachedTokens: number | null;
      }>>`
        SELECT
          COUNT(*) as count,
          SUM(openrouterTotalCost) as totalCost,
          SUM(openrouterCacheDiscount) as cacheDiscount,
          SUM(openrouterNativeTokensReasoning) as reasoningTokens,
          SUM(openrouterNativeTokensCached) as cachedTokens
        FROM AiRequest
        WHERE provider = 'openrouter' AND openrouterEnriched = 1
      `;

      // OpenRouter usage by actual provider
      const openrouterByProvider = await prisma.$queryRaw<Array<{
        provider: string;
        count: number;
        totalTokens: number | null;
        totalCost: number | null;
      }>>`
        SELECT
          openrouterProviderName as provider,
          COUNT(*) as count,
          SUM(totalTokens) as totalTokens,
          SUM(openrouterTotalCost) as totalCost
        FROM AiRequest
        WHERE provider = 'openrouter' AND openrouterEnriched = 1 AND openrouterProviderName IS NOT NULL
        GROUP BY openrouterProviderName
        ORDER BY count DESC
        LIMIT 10
      `;

      res.json({
        totalRequests,
        totalAiRequests,
        totalErrors: recentErrors,
        requestsByMethod: requestsByMethod.reduce(
          (acc, m) => ({ ...acc, [m.method]: m._count }),
          {}
        ),
        ai: {
          totalPromptTokens: aiStats._sum.promptTokens || 0,
          totalCompletionTokens: aiStats._sum.completionTokens || 0,
          totalTokens: aiStats._sum.totalTokens || 0,
          totalCostMicros: aiStats._sum.totalCostMicros || 0,
          totalCostUsd: (aiStats._sum.totalCostMicros || 0) / 1_000_000,
          avgDurationMs: Math.round(aiStats._avg.totalDuration || 0),
          avgTimeToFirstTokenMs: Math.round(aiStats._avg.timeToFirstToken || 0),
          byProvider: usageByProvider.map((p) => ({
            provider: p.provider,
            count: p._count,
            totalTokens: p._sum.totalTokens || 0,
            totalCostMicros: p._sum.totalCostMicros || 0,
          })),
          byModel: usageByModel.map((m) => ({
            model: m.model || 'unknown',
            count: m._count,
            totalTokens: m._sum.totalTokens || 0,
            totalCostMicros: m._sum.totalCostMicros || 0,
          })),
        },
        openrouter: {
          enrichedCount: Number(openrouterStats[0]?.count ?? 0),
          totalCostUsd: openrouterStats[0]?.totalCost ?? 0,
          totalCacheDiscountUsd: openrouterStats[0]?.cacheDiscount ?? 0,
          totalReasoningTokens: Number(openrouterStats[0]?.reasoningTokens ?? 0),
          totalCachedTokens: Number(openrouterStats[0]?.cachedTokens ?? 0),
          byActualProvider: openrouterByProvider.map((p) => ({
            provider: p.provider,
            count: Number(p.count),
            totalTokens: Number(p.totalTokens ?? 0),
            totalCostUsd: p.totalCost ?? 0,
          })),
        },
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
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
      const { defaultTargetUrl, logEnabled, maxBodySize, aiDetectionEnabled } = req.body;

      const config = await prisma.config.upsert({
        where: { id: 'default' },
        update: {
          ...(defaultTargetUrl !== undefined && { defaultTargetUrl }),
          ...(logEnabled !== undefined && { logEnabled }),
          ...(maxBodySize !== undefined && { maxBodySize }),
          ...(aiDetectionEnabled !== undefined && { aiDetectionEnabled }),
        },
        create: {
          id: 'default',
          defaultTargetUrl: defaultTargetUrl || null,
          logEnabled: logEnabled ?? true,
          maxBodySize: maxBodySize ?? 1048576,
          aiDetectionEnabled: aiDetectionEnabled ?? true,
        },
      });

      res.json(config);
    } catch (error) {
      console.error('Error updating config:', error);
      res.status(500).json({ error: 'Failed to update config' });
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

  // Serve static frontend files
  const publicPath = path.join(__dirname, 'public');
  app.use(express.static(publicPath));

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  return app;
}
