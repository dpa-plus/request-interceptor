import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './lib/prisma.js';
import { adminAuth, rateLimiter } from './middleware/adminAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAdminApp() {
  const app = express();

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
            // OpenRouter-specific fields (cast to any for new schema fields)
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
