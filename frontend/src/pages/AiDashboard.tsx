import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { StatCard } from '../components/StatCard';
import { LineChart } from '../components/LineChart';
import { colorForHash, labelForHash } from '../utils/promptColor';
import { apiFetch } from '../utils/apiFetch';

interface Summary {
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

interface TimeseriesResponse {
  bucket: 'day' | 'hour';
  points: Array<{ bucket: string; count: number; totalCostMicros: number; avgDurationMs: number }>;
  range: { from: string; to: string };
}

interface TopPrompt {
  systemPromptHash: string;
  promptPreview: string;
  count: number;
  totalCostMicros: number;
  totalTokens: number;
  avgDurationMs: number;
  models: string[];
}

interface LatencyStats {
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

interface OpenRouterStats {
  enrichedCount: number;
  totalCostUsd: number;
  totalCacheDiscountUsd: number;
  cacheDiscountRatio: number;
  totalReasoningTokens: number;
  totalCompletionTokens: number;
  reasoningTokenShare: number;
  totalCachedTokens: number;
  totalPromptTokens: number;
  cachedPromptRatio: number;
  byActualProvider: Array<{ provider: string; count: number; totalTokens: number; totalCostUsd: number }>;
}

function formatCost(micros: number | null) {
  if (!micros) return '$0';
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 100) return `$${dollars.toFixed(2)}`;
  return `$${Math.round(dollars).toLocaleString()}`;
}
function formatTokens(tokens: number | null) {
  if (!tokens) return '0';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}
function formatMs(ms: number) {
  if (!ms) return '0ms';
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}
function formatPct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}
function formatBucketLabel(bucket: string): string {
  // 'YYYY-MM-DD' → 'MM-DD', 'YYYY-MM-DDTHH' → 'DD HH:00'
  if (bucket.length === 10) return bucket.slice(5);
  if (bucket.length === 13) return `${bucket.slice(8, 10)} ${bucket.slice(11, 13)}:00`;
  return bucket;
}

const RANGE_PRESETS: Array<{ label: string; days: number }> = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
];

function AiDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);
  const [topPrompts, setTopPrompts] = useState<TopPrompt[]>([]);
  const [latency, setLatency] = useState<LatencyStats | null>(null);
  const [openrouter, setOpenrouter] = useState<OpenRouterStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<number>(7);

  const queryString = useMemo(() => {
    const from = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
    return `?from=${encodeURIComponent(from)}`;
  }, [rangeDays]);

  const bucket: 'hour' | 'day' = rangeDays <= 2 ? 'hour' : 'day';

  const fetchData = useCallback(async () => {
    try {
      const [summaryR, tsR, promptsR, latR, orR] = await Promise.all([
        apiFetch(`/api/stats${queryString}`),
        apiFetch(`/api/stats/timeseries${queryString}&bucket=${bucket}`),
        apiFetch(`/api/stats/top-prompts${queryString}&limit=8`),
        apiFetch(`/api/stats/latency${queryString}&heavyLimit=10`),
        apiFetch(`/api/stats/openrouter${queryString}`),
      ]);
      if (!summaryR.ok || !tsR.ok || !promptsR.ok || !latR.ok || !orR.ok) {
        throw new Error('Failed to fetch stats');
      }
      const [s, t, p, l, o] = await Promise.all([summaryR.json(), tsR.json(), promptsR.json(), latR.json(), orR.json()]);
      setSummary(s);
      setTimeseries(t);
      setTopPrompts(p.prompts);
      setLatency(l);
      setOpenrouter(o);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [queryString, bucket]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Poll every 30s, but only while the tab is visible — saves DB load when the
  // dashboard is left open in a background tab.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(fetchData, 30_000);
    };
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    if (document.visibilityState === 'visible') start();
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [fetchData]);

  if (loading && !summary) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-4 overflow-auto h-[calc(100vh-44px)]">
      <header className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-100">AI Dashboard</h1>
          <p className="text-xs text-gray-500">
            {summary && `Window: ${summary.range.from.slice(0, 10)} → ${summary.range.to.slice(0, 10)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border border-[#30363d]">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setRangeDays(p.days)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  rangeDays === p.days
                    ? 'bg-[#1f6feb33] text-[#58a6ff]'
                    : 'bg-[#0d1117] text-gray-400 hover:bg-[#1c2333]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1 bg-[#161b22] border border-[#30363d] rounded-md text-xs font-medium text-gray-300 hover:bg-[#1c2333]"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-900/40 border border-red-800 rounded-md text-red-400 text-sm">
          {error}
        </div>
      )}

      {summary && (
        <>
          {/* Top cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard
              label="AI Requests"
              value={summary.totalAiRequests.toLocaleString()}
              subtitle={`of ${summary.totalRequests.toLocaleString()} total`}
              accent="purple"
            />
            <StatCard
              label="Total Cost"
              value={formatCost(summary.ai.totalCostMicros)}
              subtitle="estimated"
              accent="green"
            />
            <StatCard
              label="Total Tokens"
              value={formatTokens(summary.ai.totalTokens)}
              subtitle={`${formatTokens(summary.ai.totalPromptTokens)} in / ${formatTokens(summary.ai.totalCompletionTokens)} out`}
              accent="blue"
            />
            <StatCard
              label="Avg Duration"
              value={formatMs(summary.ai.avgDurationMs)}
              subtitle={`TTFT: ${formatMs(summary.ai.avgTimeToFirstTokenMs)}`}
              accent="orange"
            />
          </div>

          {/* Time series chart */}
          {timeseries && timeseries.points.length > 0 && (
            <section className="bg-[#161b22] rounded-lg border border-[#30363d] p-4 mb-4">
              <h2 className="text-sm font-medium text-gray-300 mb-2">
                Activity over time
                <span className="ml-2 text-xs text-gray-500">per {timeseries.bucket}</span>
              </h2>
              <LineChart
                labels={timeseries.points.map((p) => formatBucketLabel(p.bucket))}
                series={[
                  {
                    label: 'Cost ($)',
                    color: '#3fb950',
                    values: timeseries.points.map((p) => p.totalCostMicros / 1_000_000),
                    format: (v) => `$${v.toFixed(2)}`,
                  },
                  {
                    label: 'Requests',
                    color: '#58a6ff',
                    values: timeseries.points.map((p) => p.count),
                  },
                  {
                    label: 'Avg latency (s)',
                    color: '#d29922',
                    values: timeseries.points.map((p) => p.avgDurationMs / 1000),
                    format: (v) => `${v.toFixed(2)}s`,
                  },
                ]}
              />
            </section>
          )}

          {/* Latency percentiles */}
          {latency && latency.count > 0 && (
            <section className="bg-[#161b22] rounded-lg border border-[#30363d] p-4 mb-4">
              <h2 className="text-sm font-medium text-gray-300 mb-3">Latency distribution</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <PercentileChip label="p50" ms={latency.p50} />
                <PercentileChip label="p95" ms={latency.p95} />
                <PercentileChip label="p99" ms={latency.p99} accent />
                <PercentileChip label="max" ms={latency.max} />
                <PercentileChip label="n" raw={latency.count.toLocaleString()} />
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <ModeRow label="Streaming" data={latency.byMode.streaming} />
                <ModeRow label="Non-streaming" data={latency.byMode.nonStreaming} />
              </div>
            </section>
          )}

          {/* Top system prompts */}
          {topPrompts.length > 0 && (
            <section className="bg-[#161b22] rounded-lg border border-[#30363d] p-4 mb-4">
              <h2 className="text-sm font-medium text-gray-300 mb-3">Top system prompts</h2>
              <div className="space-y-2">
                {topPrompts.map((p) => {
                  const c = colorForHash(p.systemPromptHash);
                  const l = labelForHash(p.systemPromptHash);
                  const topCost = topPrompts[0].totalCostMicros || 1;
                  const widthPct = (p.totalCostMicros / topCost) * 100;
                  return (
                    <Link
                      key={p.systemPromptHash}
                      to={`/?promptHash=${p.systemPromptHash}`}
                      className="block p-2 rounded hover:bg-[#1c2333] transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {c && l && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${c.chipBg} ${c.chipText} border ${c.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                            {l}
                          </span>
                        )}
                        <span className="text-xs text-gray-200 truncate flex-1">{p.promptPreview || '(empty)'}</span>
                        <span className="text-xs text-green-400 font-mono whitespace-nowrap">{formatCost(p.totalCostMicros)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500">
                        <span>{p.count.toLocaleString()} req</span>
                        <span>•</span>
                        <span>{formatTokens(p.totalTokens)} tok</span>
                        <span>•</span>
                        <span>{formatMs(p.avgDurationMs)} avg</span>
                        <span>•</span>
                        <span className="truncate">{p.models.slice(0, 3).join(', ')}{p.models.length > 3 ? '…' : ''}</span>
                      </div>
                      <div className="mt-1 h-0.5 bg-[#21262d] rounded-full overflow-hidden">
                        <div className={`${c?.dot ?? 'bg-gray-600'} h-full`} style={{ width: `${widthPct}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Heavy hitters */}
          {latency && latency.heavyHitters.length > 0 && (
            <section className="bg-[#161b22] rounded-lg border border-[#30363d] p-4 mb-4">
              <h2 className="text-sm font-medium text-gray-300 mb-3">Most expensive single requests</h2>
              <div className="divide-y divide-[#21262d] text-xs">
                {latency.heavyHitters.map((h) => {
                  const c = colorForHash(h.systemPromptHash);
                  const l = labelForHash(h.systemPromptHash);
                  return (
                    <div key={h.id} className="flex items-center gap-2 py-1.5">
                      {c && l ? (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${c.chipBg} ${c.chipText} border ${c.border}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                          {l}
                        </span>
                      ) : (
                        <span className="inline-block w-4 h-4 rounded bg-[#21262d]" />
                      )}
                      <span className="text-gray-400 capitalize w-16 truncate">{h.provider}</span>
                      <span className="text-gray-200 font-mono truncate flex-1">{h.model || '-'}</span>
                      <span className="text-gray-500 w-14 text-right">{formatTokens(h.totalTokens)}</span>
                      <span className="text-gray-400 w-16 text-right">{formatMs(h.totalDurationMs || 0)}</span>
                      <span className="text-green-400 font-mono w-20 text-right">{formatCost(h.totalCostMicros)}</span>
                      {h.requestLogId && (
                        <Link to={`/request/${h.requestLogId}`} className="text-[#58a6ff] hover:underline text-[11px] ml-1">view</Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* By provider + model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <section className="bg-[#161b22] rounded-lg border border-[#30363d] p-4">
              <h2 className="text-sm font-medium text-gray-300 mb-2">By provider</h2>
              <UsageBars items={summary.ai.byProvider.map((p) => ({
                key: p.provider, label: p.provider, count: p.count, cost: p.totalCostMicros, tokens: p.totalTokens,
              }))} />
            </section>
            <section className="bg-[#161b22] rounded-lg border border-[#30363d] p-4">
              <h2 className="text-sm font-medium text-gray-300 mb-2">By model (top 10 by cost)</h2>
              <UsageBars items={summary.ai.byModel.map((m) => ({
                key: m.model, label: m.model, count: m.count, cost: m.totalCostMicros, tokens: m.totalTokens,
              }))} />
            </section>
          </div>

          {/* OpenRouter extras */}
          {openrouter && openrouter.enrichedCount > 0 && (
            <section className="bg-[#161b22] rounded-lg border border-[#30363d] p-4 mb-4">
              <h2 className="text-sm font-medium text-gray-300 mb-3">
                OpenRouter insights
                <span className="ml-2 text-xs text-gray-500">{openrouter.enrichedCount.toLocaleString()} enriched</span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <StatCard label="Actual cost" value={`$${openrouter.totalCostUsd.toFixed(2)}`} accent="green" />
                <StatCard
                  label="Cache savings"
                  value={`$${openrouter.totalCacheDiscountUsd.toFixed(2)}`}
                  subtitle={`${formatPct(openrouter.cacheDiscountRatio)} of spend`}
                  accent="cyan"
                />
                <StatCard
                  label="Reasoning share"
                  value={formatPct(openrouter.reasoningTokenShare)}
                  subtitle={`${formatTokens(openrouter.totalReasoningTokens)} reasoning tokens`}
                  accent="purple"
                />
                <StatCard
                  label="Prompt cache ratio"
                  value={formatPct(openrouter.cachedPromptRatio)}
                  subtitle={`${formatTokens(openrouter.totalCachedTokens)} cached`}
                  accent="pink"
                />
              </div>
              {openrouter.byActualProvider.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Top upstream providers</div>
                  <UsageBars items={openrouter.byActualProvider.map((p) => ({
                    key: p.provider, label: p.provider, count: p.count, cost: Math.round(p.totalCostUsd * 1_000_000), tokens: p.totalTokens,
                  }))} />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PercentileChip({ label, ms, raw, accent }: { label: string; ms?: number; raw?: string; accent?: boolean }) {
  return (
    <div className={`bg-[#0d1117] rounded border ${accent ? 'border-orange-700/50' : 'border-[#30363d]'} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-mono ${accent ? 'text-orange-400' : 'text-gray-200'}`}>
        {raw ?? formatMs(ms || 0)}
      </div>
    </div>
  );
}

function ModeRow({ label, data }: { label: string; data: { count: number; p50: number; p95: number; p99: number } }) {
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 flex items-center gap-3">
      <span className="text-gray-400 w-28">{label}</span>
      <span className="text-gray-500 text-[11px]">{data.count.toLocaleString()} req</span>
      <span className="flex-1" />
      <span className="text-gray-500 text-[11px]">p50</span><span className="text-gray-200 font-mono">{formatMs(data.p50)}</span>
      <span className="text-gray-500 text-[11px]">p95</span><span className="text-gray-200 font-mono">{formatMs(data.p95)}</span>
      <span className="text-gray-500 text-[11px]">p99</span><span className="text-gray-200 font-mono">{formatMs(data.p99)}</span>
    </div>
  );
}

interface UsageItem { key: string; label: string; count: number; cost: number; tokens: number }

function UsageBars({ items }: { items: UsageItem[] }) {
  const top = Math.max(1, ...items.map((i) => i.cost));
  if (items.length === 0) return <p className="text-xs text-gray-500">No data yet.</p>;
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.key}>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-gray-200 truncate flex-1">{it.label}</span>
            <span className="text-gray-500">{it.count.toLocaleString()}</span>
            <span className="text-gray-500">{formatTokens(it.tokens)}</span>
            <span className="text-green-400 font-mono w-16 text-right">{formatCost(it.cost)}</span>
          </div>
          <div className="mt-0.5 h-0.5 bg-[#21262d] rounded-full overflow-hidden">
            <div className="bg-[#58a6ff] h-full" style={{ width: `${(it.cost / top) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default AiDashboard;
