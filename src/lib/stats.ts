import { prisma } from './prisma.js';
import { cached } from './statsCache.js';

const DEFAULT_RANGE_DAYS = 30;
const SUMMARY_CACHE_TTL_MS = 30_000;
const TIMESERIES_CACHE_TTL_MS = 60_000;
const TOP_PROMPTS_CACHE_TTL_MS = 60_000;
const LATENCY_CACHE_TTL_MS = 60_000;
const OPENROUTER_CACHE_TTL_MS = 60_000;

export interface StatsRange {
  from: Date;
  to: Date;
}

/**
 * Resolve a date range from query params, defaulting to the last N days
 * (instead of all-time) so a dashboard hit without filters doesn't aggregate
 * across the entire DB.
 */
export function resolveRange(fromIso?: string, toIso?: string): StatsRange {
  const to = toIso ? new Date(toIso) : new Date();
  const from = fromIso
    ? new Date(fromIso)
    : new Date(Date.now() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

function rangeKey(range: StatsRange, extra: string = ''): string {
  return `${range.from.getTime()}:${range.to.getTime()}${extra ? ':' + extra : ''}`;
}

// ---------------------------------------------------------------------------
// Summary (the cards at the top of the AI dashboard)
// ---------------------------------------------------------------------------

export interface SummaryStats {
  totalRequests: number;
  totalAiRequests: number;
  totalErrors: number;
  ai: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostMicros: number;
    totalCostUsd: number;
    avgDurationMs: number;
    avgTimeToFirstTokenMs: number;
    byProvider: Array<{ provider: string; count: number; totalTokens: number; totalCostMicros: number }>;
    byModel: Array<{ model: string; count: number; totalTokens: number; totalCostMicros: number }>;
  };
  range: { from: string; to: string };
}

export async function getSummary(range: StatsRange): Promise<SummaryStats> {
  return cached('summary', rangeKey(range), SUMMARY_CACHE_TTL_MS, async () => {
    const dateFilter = { createdAt: { gte: range.from, lte: range.to } };

    const [totalRequests, totalAiRequests, aiStats, recentErrors, usageByProvider, usageByModel] = await Promise.all([
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
      prisma.requestLog.count({ where: { ...dateFilter, statusCode: { gte: 400 } } }),
      prisma.aiRequest.groupBy({
        by: ['provider'],
        where: dateFilter,
        _sum: { totalTokens: true, totalCostMicros: true },
        _count: true,
      }),
      prisma.aiRequest.groupBy({
        by: ['model'],
        where: dateFilter,
        _sum: { totalTokens: true, totalCostMicros: true },
        _count: true,
        orderBy: { _sum: { totalCostMicros: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      totalRequests,
      totalAiRequests,
      totalErrors: recentErrors,
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
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
    };
  });
}

// ---------------------------------------------------------------------------
// Time series (cost + latency + count per bucket)
// ---------------------------------------------------------------------------

export type Bucket = 'hour' | 'day';

export interface TimeseriesPoint {
  bucket: string;          // ISO date, e.g. '2026-05-22' (day) or '2026-05-22T13' (hour)
  count: number;
  totalCostMicros: number;
  avgDurationMs: number;
}

export async function getTimeseries(range: StatsRange, bucket: Bucket): Promise<TimeseriesPoint[]> {
  return cached('timeseries', rangeKey(range, bucket), TIMESERIES_CACHE_TTL_MS, async () => {
    // Prisma stores DateTime as Unix-ms integers in SQLite. To bucket them we
    // need to divide by 1000 and apply the 'unixepoch' strftime modifier.
    const fmt = bucket === 'day' ? '%Y-%m-%d' : '%Y-%m-%dT%H';
    const rows = await prisma.$queryRawUnsafe<Array<{
      bucket: string;
      count: number;
      totalCostMicros: number | null;
      avgDuration: number | null;
    }>>(
      `SELECT strftime('${fmt}', createdAt / 1000, 'unixepoch') as bucket,
              COUNT(*) as count,
              SUM(totalCostMicros) as totalCostMicros,
              AVG(totalDuration) as avgDuration
         FROM AiRequest
        WHERE createdAt >= ? AND createdAt <= ?
        GROUP BY bucket
        ORDER BY bucket ASC`,
      range.from, range.to
    );

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count),
      totalCostMicros: Number(r.totalCostMicros || 0),
      avgDurationMs: Math.round(Number(r.avgDuration || 0)),
    }));
  });
}

// ---------------------------------------------------------------------------
// Top system-prompt clusters
// ---------------------------------------------------------------------------

export interface PromptClusterStats {
  systemPromptHash: string;
  promptPreview: string;       // first ~100 chars of the prompt
  count: number;
  totalCostMicros: number;
  totalTokens: number;
  avgDurationMs: number;
  models: string[];            // distinct models seen for this prompt
}

export async function getTopPrompts(range: StatsRange, limit: number = 10): Promise<PromptClusterStats[]> {
  return cached('top-prompts', rangeKey(range, String(limit)), TOP_PROMPTS_CACHE_TTL_MS, async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      systemPromptHash: string;
      promptPreview: string;
      count: number;
      totalCostMicros: number | null;
      totalTokens: number | null;
      avgDuration: number | null;
      models: string | null;
    }>>(
      `SELECT systemPromptHash,
              MIN(substr(systemPrompt, 1, 120)) as promptPreview,
              COUNT(*) as count,
              SUM(totalCostMicros) as totalCostMicros,
              SUM(totalTokens) as totalTokens,
              AVG(totalDuration) as avgDuration,
              GROUP_CONCAT(DISTINCT model) as models
         FROM AiRequest
        WHERE createdAt >= ? AND createdAt <= ? AND systemPromptHash IS NOT NULL
        GROUP BY systemPromptHash
        ORDER BY totalCostMicros DESC NULLS LAST
        LIMIT ?`,
      range.from, range.to, limit
    );

    return rows.map((r) => ({
      systemPromptHash: r.systemPromptHash,
      promptPreview: r.promptPreview || '',
      count: Number(r.count),
      totalCostMicros: Number(r.totalCostMicros || 0),
      totalTokens: Number(r.totalTokens || 0),
      avgDurationMs: Math.round(Number(r.avgDuration || 0)),
      models: r.models ? r.models.split(',').filter(Boolean) : [],
    }));
  });
}

// ---------------------------------------------------------------------------
// Latency percentiles + heavy-hitters
// ---------------------------------------------------------------------------

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  byMode: {
    streaming: { count: number; p50: number; p95: number; p99: number };
    nonStreaming: { count: number; p50: number; p95: number; p99: number };
  };
  heavyHitters: Array<{
    id: string;
    requestLogId: string | null;
    provider: string;
    model: string | null;
    totalCostMicros: number | null;
    totalTokens: number | null;
    totalDurationMs: number | null;
    createdAt: string;
    systemPromptHash: string | null;
  }>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Clamp index inclusive of bounds.
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function getLatency(range: StatsRange, heavyLimit: number = 10): Promise<LatencyStats> {
  return cached('latency', rangeKey(range, String(heavyLimit)), LATENCY_CACHE_TTL_MS, async () => {
    // Pull the (small) numeric column only — avoids loading large JSON bodies.
    const rows = await prisma.aiRequest.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        totalDuration: { not: null },
      },
      select: { totalDuration: true, isStreaming: true },
    });

    const all: number[] = [];
    const streaming: number[] = [];
    const nonStreaming: number[] = [];
    for (const r of rows) {
      const d = r.totalDuration as number | null;
      if (d == null) continue;
      all.push(d);
      (r.isStreaming ? streaming : nonStreaming).push(d);
    }
    all.sort((a, b) => a - b);
    streaming.sort((a, b) => a - b);
    nonStreaming.sort((a, b) => a - b);

    const heavy = await prisma.aiRequest.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        totalCostMicros: { not: null, gt: 0 },
      },
      orderBy: { totalCostMicros: 'desc' },
      take: heavyLimit,
      select: {
        id: true,
        provider: true,
        model: true,
        totalCostMicros: true,
        totalTokens: true,
        totalDuration: true,
        createdAt: true,
        systemPromptHash: true,
        requestLog: { select: { id: true } },
      },
    });

    return {
      count: all.length,
      p50: percentile(all, 50),
      p95: percentile(all, 95),
      p99: percentile(all, 99),
      max: all[all.length - 1] || 0,
      byMode: {
        streaming: {
          count: streaming.length,
          p50: percentile(streaming, 50),
          p95: percentile(streaming, 95),
          p99: percentile(streaming, 99),
        },
        nonStreaming: {
          count: nonStreaming.length,
          p50: percentile(nonStreaming, 50),
          p95: percentile(nonStreaming, 95),
          p99: percentile(nonStreaming, 99),
        },
      },
      heavyHitters: heavy.map((h) => ({
        id: h.id,
        requestLogId: h.requestLog?.id ?? null,
        provider: h.provider,
        model: h.model,
        totalCostMicros: h.totalCostMicros,
        totalTokens: h.totalTokens,
        totalDurationMs: h.totalDuration,
        createdAt: h.createdAt.toISOString(),
        systemPromptHash: h.systemPromptHash,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// OpenRouter-specific cache + reasoning insights
// ---------------------------------------------------------------------------

export interface OpenRouterStats {
  enrichedCount: number;
  totalCostUsd: number;
  totalCacheDiscountUsd: number;
  cacheDiscountRatio: number;          // discount / cost
  totalReasoningTokens: number;
  totalCompletionTokens: number;
  reasoningTokenShare: number;         // reasoning / (reasoning + completion)
  totalCachedTokens: number;
  totalPromptTokens: number;
  cachedPromptRatio: number;           // cached / prompt
  byActualProvider: Array<{ provider: string; count: number; totalTokens: number; totalCostUsd: number }>;
}

export async function getOpenRouterStats(range: StatsRange): Promise<OpenRouterStats> {
  return cached('openrouter', rangeKey(range), OPENROUTER_CACHE_TTL_MS, async () => {
    const [totals, byProvider] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{
        count: number;
        totalCost: number | null;
        cacheDiscount: number | null;
        reasoningTokens: number | null;
        cachedTokens: number | null;
        completionTokens: number | null;
        promptTokens: number | null;
      }>>(
        `SELECT COUNT(*) as count,
                SUM(openrouterTotalCost) as totalCost,
                SUM(openrouterCacheDiscount) as cacheDiscount,
                SUM(openrouterNativeTokensReasoning) as reasoningTokens,
                SUM(openrouterNativeTokensCached) as cachedTokens,
                SUM(openrouterNativeTokensCompletion) as completionTokens,
                SUM(openrouterNativeTokensPrompt) as promptTokens
           FROM AiRequest
          WHERE provider = 'openrouter' AND openrouterEnriched = 1
            AND createdAt >= ? AND createdAt <= ?`,
        range.from, range.to
      ),
      prisma.$queryRawUnsafe<Array<{
        provider: string;
        count: number;
        totalTokens: number | null;
        totalCost: number | null;
      }>>(
        `SELECT openrouterProviderName as provider,
                COUNT(*) as count,
                SUM(totalTokens) as totalTokens,
                SUM(openrouterTotalCost) as totalCost
           FROM AiRequest
          WHERE provider = 'openrouter' AND openrouterEnriched = 1
            AND openrouterProviderName IS NOT NULL
            AND createdAt >= ? AND createdAt <= ?
          GROUP BY openrouterProviderName
          ORDER BY count DESC
          LIMIT 10`,
        range.from, range.to
      ),
    ]);

    const t = totals[0] ?? ({} as Record<string, never>);
    const totalCost = Number(t.totalCost || 0);
    const cacheDiscount = Number(t.cacheDiscount || 0);
    const reasoning = Number(t.reasoningTokens || 0);
    const completion = Number(t.completionTokens || 0);
    const cached_ = Number(t.cachedTokens || 0);
    const prompt = Number(t.promptTokens || 0);

    return {
      enrichedCount: Number(t.count || 0),
      totalCostUsd: totalCost,
      totalCacheDiscountUsd: cacheDiscount,
      cacheDiscountRatio: totalCost + cacheDiscount > 0 ? cacheDiscount / (totalCost + cacheDiscount) : 0,
      totalReasoningTokens: reasoning,
      totalCompletionTokens: completion,
      reasoningTokenShare: reasoning + completion > 0 ? reasoning / (reasoning + completion) : 0,
      totalCachedTokens: cached_,
      totalPromptTokens: prompt,
      cachedPromptRatio: prompt > 0 ? cached_ / prompt : 0,
      byActualProvider: byProvider.map((p) => ({
        provider: p.provider,
        count: Number(p.count),
        totalTokens: Number(p.totalTokens || 0),
        totalCostUsd: Number(p.totalCost || 0),
      })),
    };
  });
}
