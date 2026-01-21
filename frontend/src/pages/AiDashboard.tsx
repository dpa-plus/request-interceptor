import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface Stats {
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
    byProvider: Array<{
      provider: string;
      count: number;
      totalTokens: number;
      totalCostMicros: number;
    }>;
    byModel: Array<{
      model: string;
      count: number;
      totalTokens: number;
      totalCostMicros: number;
    }>;
  };
  openrouter?: {
    enrichedCount: number;
    totalCostUsd: number;
    totalCacheDiscountUsd: number;
    totalReasoningTokens: number;
    totalCachedTokens: number;
    byActualProvider: Array<{
      provider: string;
      count: number;
      totalTokens: number;
      totalCostUsd: number;
    }>;
  };
}

interface AiRequest {
  id: string;
  provider: string;
  endpoint: string;
  model: string | null;
  isStreaming: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  totalCostMicros: number | null;
  timeToFirstToken: number | null;
  totalDuration: number | null;
  createdAt: string;
  // OpenRouter-specific
  openrouterEnriched?: boolean;
  openrouterProviderName?: string | null;
  openrouterTotalCost?: number | null;
  openrouterCacheDiscount?: number | null;
  openrouterNativeTokensReasoning?: number | null;
  openrouterNativeTokensCached?: number | null;
}

function AiDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [aiRequests, setAiRequests] = useState<AiRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsRes, requestsRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/ai-requests?limit=50'),
      ]);

      if (!statsRes.ok || !requestsRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const [statsData, requestsData] = await Promise.all([
        statsRes.json(),
        requestsRes.json(),
      ]);

      setStats(statsData);
      setAiRequests(requestsData.aiRequests);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatCost = (micros: number | null) => {
    if (!micros) return '$0.00';
    const dollars = micros / 1_000_000;
    if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
    return `$${dollars.toFixed(2)}`;
  };

  const formatTokens = (tokens: number | null) => {
    if (!tokens) return '0';
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return tokens.toString();
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor AI API usage and costs
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm font-medium text-gray-500">AI Requests</div>
              <div className="mt-1 text-2xl font-semibold text-purple-600">
                {stats.totalAiRequests.toLocaleString()}
              </div>
              <div className="text-xs text-gray-400">
                of {stats.totalRequests.toLocaleString()} total
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm font-medium text-gray-500">Total Tokens</div>
              <div className="mt-1 text-2xl font-semibold text-blue-600">
                {formatTokens(stats.ai.totalTokens)}
              </div>
              <div className="text-xs text-gray-400">
                {formatTokens(stats.ai.totalPromptTokens)} in / {formatTokens(stats.ai.totalCompletionTokens)} out
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm font-medium text-gray-500">Total Cost</div>
              <div className="mt-1 text-2xl font-semibold text-green-600">
                {formatCost(stats.ai.totalCostMicros)}
              </div>
              <div className="text-xs text-gray-400">estimated</div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm font-medium text-gray-500">Avg Duration</div>
              <div className="mt-1 text-2xl font-semibold text-orange-600">
                {stats.ai.avgDurationMs}ms
              </div>
              <div className="text-xs text-gray-400">
                TTFT: {stats.ai.avgTimeToFirstTokenMs}ms
              </div>
            </div>
          </div>

          {/* Usage by Provider & Model */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* By Provider */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b">
                <h2 className="text-lg font-medium text-gray-900">By Provider</h2>
              </div>
              <div className="p-4">
                {stats.ai.byProvider.length === 0 ? (
                  <p className="text-gray-500 text-sm">No data yet</p>
                ) : (
                  <div className="space-y-3">
                    {stats.ai.byProvider.map((p) => (
                      <div key={p.provider} className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-gray-900 capitalize">
                            {p.provider}
                          </span>
                          <span className="ml-2 text-sm text-gray-500">
                            {p.count} requests
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-gray-900">
                            {formatCost(p.totalCostMicros)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatTokens(p.totalTokens)} tokens
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* By Model */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b">
                <h2 className="text-lg font-medium text-gray-900">By Model</h2>
              </div>
              <div className="p-4">
                {stats.ai.byModel.length === 0 ? (
                  <p className="text-gray-500 text-sm">No data yet</p>
                ) : (
                  <div className="space-y-3">
                    {stats.ai.byModel.map((m) => (
                      <div key={m.model} className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-gray-900">
                            {m.model}
                          </span>
                          <span className="ml-2 text-sm text-gray-500">
                            {m.count} requests
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-gray-900">
                            {formatCost(m.totalCostMicros)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatTokens(m.totalTokens)} tokens
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* OpenRouter Section */}
          {stats.openrouter && stats.openrouter.enrichedCount > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">
                OpenRouter Insights
                <span className="ml-2 text-sm font-normal text-gray-500">
                  (from {stats.openrouter.enrichedCount} enriched requests)
                </span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                  <div className="text-sm font-medium text-purple-700">Actual Cost</div>
                  <div className="mt-1 text-2xl font-semibold text-purple-900">
                    ${stats.openrouter.totalCostUsd.toFixed(4)}
                  </div>
                  <div className="text-xs text-purple-600">from OpenRouter API</div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                  <div className="text-sm font-medium text-green-700">Cache Savings</div>
                  <div className="mt-1 text-2xl font-semibold text-green-900">
                    ${stats.openrouter.totalCacheDiscountUsd.toFixed(4)}
                  </div>
                  <div className="text-xs text-green-600">
                    {formatTokens(stats.openrouter.totalCachedTokens)} cached tokens
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                  <div className="text-sm font-medium text-blue-700">Reasoning Tokens</div>
                  <div className="mt-1 text-2xl font-semibold text-blue-900">
                    {formatTokens(stats.openrouter.totalReasoningTokens)}
                  </div>
                  <div className="text-xs text-blue-600">for o1/thinking models</div>
                </div>

                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
                  <div className="text-sm font-medium text-orange-700">Enriched</div>
                  <div className="mt-1 text-2xl font-semibold text-orange-900">
                    {stats.openrouter.enrichedCount}
                  </div>
                  <div className="text-xs text-orange-600">requests with full data</div>
                </div>
              </div>

              {/* By Actual Provider (the provider that served via OpenRouter) */}
              {stats.openrouter.byActualProvider.length > 0 && (
                <div className="bg-white rounded-lg shadow">
                  <div className="px-4 py-3 border-b">
                    <h3 className="text-md font-medium text-gray-900">
                      By Actual Provider
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        (providers that served OpenRouter requests)
                      </span>
                    </h3>
                  </div>
                  <div className="p-4">
                    <div className="space-y-3">
                      {stats.openrouter.byActualProvider.map((p) => (
                        <div key={p.provider} className="flex items-center justify-between">
                          <div>
                            <span className="font-medium text-gray-900">
                              {p.provider}
                            </span>
                            <span className="ml-2 text-sm text-gray-500">
                              {p.count} requests
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-purple-600">
                              ${p.totalCostUsd.toFixed(4)}
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatTokens(p.totalTokens)} tokens
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Recent AI Requests */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-3 border-b">
          <h2 className="text-lg font-medium text-gray-900">Recent AI Requests</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Provider
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Model
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Tokens
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Cost
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Stream
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {aiRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    No AI requests yet
                  </td>
                </tr>
              ) : (
                aiRequests.map((req) => (
                  <tr
                    key={req.id}
                    onClick={() => navigate(`/request/${req.id}`)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 text-purple-800 capitalize">
                          {req.provider}
                        </span>
                        {req.provider === 'openrouter' && req.openrouterProviderName && (
                          <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                            via {req.openrouterProviderName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {req.model || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="text-gray-900">
                        {req.totalTokens?.toLocaleString() || '-'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {req.promptTokens?.toLocaleString() || 0} / {req.completionTokens?.toLocaleString() || 0}
                      </div>
                      {req.openrouterNativeTokensCached && req.openrouterNativeTokensCached > 0 && (
                        <div className="text-xs text-green-600">
                          +{req.openrouterNativeTokensCached.toLocaleString()} cached
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {req.openrouterEnriched && req.openrouterTotalCost != null ? (
                        <div>
                          <div className="font-medium text-purple-600">
                            ${(req.openrouterTotalCost ?? 0).toFixed(4)}
                          </div>
                          {req.openrouterCacheDiscount != null && req.openrouterCacheDiscount > 0 && (
                            <div className="text-xs text-green-600">
                              -{req.openrouterCacheDiscount.toFixed(4)} saved
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="font-medium text-green-600">
                          {formatCost(req.totalCostMicros)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {req.totalDuration ? `${req.totalDuration}ms` : '-'}
                      {req.timeToFirstToken && (
                        <div className="text-xs text-gray-400">
                          TTFT: {req.timeToFirstToken}ms
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        {req.isStreaming ? (
                          <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-800">
                            Stream
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                        {req.openrouterEnriched && (
                          <span className="px-2 py-0.5 text-xs rounded bg-purple-50 text-purple-600">
                            Enriched
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {new Date(req.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AiDashboard;
