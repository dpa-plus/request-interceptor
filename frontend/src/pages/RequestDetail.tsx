import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CopyButton } from '../components/CopyButton';
import { SmartBodyViewer } from '../components/SmartBodyViewer';
import { HeadersTable } from '../components/HeadersTable';
import { generateCurl } from '../utils/curlGenerator';

interface AiRequest {
  id: string;
  provider: string;
  endpoint: string;
  model: string | null;
  isStreaming: boolean;
  systemPrompt: string | null;
  userMessages: string | null;
  assistantResponse: string | null;
  fullRequest: string | null;
  fullResponse: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  inputCostMicros: number | null;
  outputCostMicros: number | null;
  totalCostMicros: number | null;
  timeToFirstToken: number | null;
  totalDuration: number | null;
  createdAt: string;
  // OpenRouter-specific fields
  openrouterEnriched?: boolean;
  openrouterEnrichedAt?: string | null;
  openrouterGenerationId?: string | null;
  openrouterProviderName?: string | null;
  openrouterUpstreamId?: string | null;
  openrouterTotalCost?: number | null;
  openrouterCacheDiscount?: number | null;
  openrouterLatency?: number | null;
  openrouterGenerationTime?: number | null;
  openrouterModerationLatency?: number | null;
  openrouterNativeTokensPrompt?: number | null;
  openrouterNativeTokensCompletion?: number | null;
  openrouterNativeTokensReasoning?: number | null;
  openrouterNativeTokensCached?: number | null;
  openrouterFinishReason?: string | null;
  openrouterIsByok?: boolean | null;
  openrouterRawResponse?: string | null;
}

interface RequestLog {
  id: string;
  method: string;
  url: string;
  path: string;
  queryParams: string | null;
  headers: string;
  body: string | null;
  bodyTruncated: boolean;
  bodySize: number;
  statusCode: number | null;
  responseHeaders: string | null;
  responseBody: string | null;
  responseTruncated: boolean;
  responseSize: number;
  responseTime: number | null;
  targetUrl: string;
  routeSource: string;
  routeRuleId: string | null;
  isAiRequest: boolean;
  createdAt: string;
  error: string | null;
  aiRequest: AiRequest | null;
}

function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<RequestLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response' | 'ai'>('request');

  useEffect(() => {
    const fetchLog = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/logs/${id}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Request not found');
          }
          throw new Error('Failed to fetch request details');
        }
        const data = await response.json();
        setLog(data);
        setError(null);
        if (data.aiRequest) {
          setActiveTab('ai');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchLog();
  }, [id]);

  const curlCommand = useMemo(() => {
    if (!log) return '';
    return generateCurl({
      method: log.method,
      url: log.url,
      headers: log.headers,
      body: log.body,
    });
  }, [log]);

  const responseContentType = useMemo(() => {
    if (!log?.responseHeaders) return undefined;
    try {
      const headers = JSON.parse(log.responseHeaders) as Record<string, string>;
      return headers['content-type'] || headers['Content-Type'];
    } catch {
      return undefined;
    }
  }, [log]);

  const requestContentType = useMemo(() => {
    if (!log?.headers) return undefined;
    try {
      const headers = JSON.parse(log.headers) as Record<string, string>;
      return headers['content-type'] || headers['Content-Type'];
    } catch {
      return undefined;
    }
  }, [log]);

  const formatCost = (micros: number | null) => {
    if (!micros) return '$0.00';
    const dollars = micros / 1_000_000;
    if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
    return `$${dollars.toFixed(2)}`;
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-green-100 text-green-800 border-green-200',
      POST: 'bg-blue-100 text-blue-800 border-blue-200',
      PUT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      PATCH: 'bg-orange-100 text-orange-800 border-orange-200',
      DELETE: 'bg-red-100 text-red-800 border-red-200',
    };
    return colors[method] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusColor = (status: number | null) => {
    if (!status) return 'text-gray-500';
    if (status < 300) return 'text-green-600';
    if (status < 400) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusBg = (status: number | null) => {
    if (!status) return 'bg-gray-100';
    if (status < 300) return 'bg-green-50';
    if (status < 400) return 'bg-yellow-50';
    return 'bg-red-50';
  };

  const handleCopyCurl = () => {
    navigator.clipboard.writeText(curlCommand);
    toast.success('cURL command copied!');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-gray-500">Loading request details...</span>
        </div>
      </div>
    );
  }

  if (error || !log) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="text-red-600 mb-4 font-medium">{error || 'Request not found'}</div>
        <button
          onClick={() => navigate('/')}
          className="text-blue-600 hover:text-blue-800 font-medium"
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate(-1)}
              className="mt-1 p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
              title="Go back"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-3 py-1 text-sm font-bold rounded border ${getMethodColor(log.method)}`}>
                  {log.method}
                </span>
                <span className={`px-3 py-1 text-lg font-bold rounded ${getStatusBg(log.statusCode)} ${getStatusColor(log.statusCode)}`}>
                  {log.statusCode || 'Pending'}
                </span>
                {log.isAiRequest && (
                  <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 text-purple-800 border border-purple-200">
                    AI Request
                  </span>
                )}
                {log.aiRequest?.isStreaming && (
                  <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800 border border-blue-200">
                    Streaming
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm text-gray-600 font-mono break-all bg-gray-50 rounded px-2 py-1">
                {log.url}
              </div>
              <div className="mt-2 text-xs text-gray-400">
                {new Date(log.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Actions Toolbar */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleCopyCurl}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors"
              title="Copy as cURL command"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy as cURL
            </button>
            <CopyButton text={log.url} label="Copy URL" size="sm" />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Target
          </div>
          <div className="text-sm font-medium text-gray-900 truncate" title={log.targetUrl}>
            {log.targetUrl || '-'}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            via {log.routeSource}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Response Time
          </div>
          <div className="text-sm font-medium text-gray-900">
            {log.responseTime ? (
              <span className={log.responseTime > 1000 ? 'text-orange-600' : log.responseTime > 500 ? 'text-yellow-600' : 'text-green-600'}>
                {log.responseTime}ms
              </span>
            ) : '-'}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Request Size
          </div>
          <div className="text-sm font-medium text-gray-900">
            {log.bodySize > 0 ? `${(log.bodySize / 1024).toFixed(1)} KB` : '-'}
          </div>
          {log.bodyTruncated && (
            <div className="text-xs text-orange-500 mt-1">Truncated</div>
          )}
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            Response Size
          </div>
          <div className="text-sm font-medium text-gray-900">
            {log.responseSize > 0 ? `${(log.responseSize / 1024).toFixed(1)} KB` : '-'}
          </div>
          {log.responseTruncated && (
            <div className="text-xs text-orange-500 mt-1">Truncated</div>
          )}
        </div>
      </div>

      {log.error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm font-medium text-red-800 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Error
          </div>
          <div className="text-sm text-red-700">{log.error}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('request')}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'request'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Request
            </span>
          </button>
          <button
            onClick={() => setActiveTab('response')}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'response'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
              Response
            </span>
          </button>
          {log.aiRequest && (
            <button
              onClick={() => setActiveTab('ai')}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === 'ai'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                AI Details
              </span>
            </button>
          )}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'request' && (
          <>
            <HeadersTable headers={log.headers} title="Request Headers" />

            {log.queryParams && (
              <SmartBodyViewer
                content={log.queryParams}
                title="Query Parameters"
                maxHeight="max-h-48"
              />
            )}

            {log.body && (
              <SmartBodyViewer
                content={log.body}
                contentTypeHeader={requestContentType}
                title="Request Body"
                truncated={log.bodyTruncated}
              />
            )}
          </>
        )}

        {activeTab === 'response' && (
          <>
            {log.responseHeaders && (
              <HeadersTable headers={log.responseHeaders} title="Response Headers" />
            )}

            {log.responseBody && (
              <SmartBodyViewer
                content={log.responseBody}
                contentTypeHeader={responseContentType}
                title="Response Body"
                truncated={log.responseTruncated}
                maxHeight="max-h-[600px]"
              />
            )}

            {!log.responseHeaders && !log.responseBody && (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                No response data available
              </div>
            )}
          </>
        )}

        {activeTab === 'ai' && log.aiRequest && (
          <AiDetailsTab aiRequest={log.aiRequest} formatCost={formatCost} />
        )}
      </div>
    </div>
  );
}

// OpenRouter Details Panel
function OpenRouterPanel({ aiRequest }: { aiRequest: AiRequest }) {
  const hasTimingData = aiRequest.openrouterLatency || aiRequest.openrouterGenerationTime || aiRequest.openrouterModerationLatency;
  const hasTokenData = aiRequest.openrouterNativeTokensPrompt || aiRequest.openrouterNativeTokensCompletion ||
                       aiRequest.openrouterNativeTokensReasoning || aiRequest.openrouterNativeTokensCached;

  if (!aiRequest.openrouterEnriched) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
        <div className="flex items-center gap-2 text-purple-700">
          <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">OpenRouter data pending enrichment...</span>
        </div>
        {aiRequest.openrouterGenerationId && (
          <div className="mt-2 text-xs text-purple-600">
            Generation ID: <code className="bg-purple-200 px-1 rounded">{aiRequest.openrouterGenerationId}</code>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b bg-gradient-to-r from-purple-500 to-purple-600">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            OpenRouter Insights
          </h3>
          {aiRequest.openrouterEnrichedAt && (
            <span className="text-xs text-purple-200">
              Enriched {new Date(aiRequest.openrouterEnrichedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Provider & IDs */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {aiRequest.openrouterProviderName && (
            <div>
              <div className="text-xs text-gray-500">Actual Provider</div>
              <div className="font-medium text-gray-900">{aiRequest.openrouterProviderName}</div>
            </div>
          )}
          {aiRequest.openrouterGenerationId && (
            <div>
              <div className="text-xs text-gray-500">Generation ID</div>
              <div className="font-mono text-xs text-gray-700 truncate" title={aiRequest.openrouterGenerationId}>
                {aiRequest.openrouterGenerationId}
              </div>
            </div>
          )}
          {aiRequest.openrouterUpstreamId && (
            <div>
              <div className="text-xs text-gray-500">Upstream ID</div>
              <div className="font-mono text-xs text-gray-700 truncate" title={aiRequest.openrouterUpstreamId}>
                {aiRequest.openrouterUpstreamId}
              </div>
            </div>
          )}
          {aiRequest.openrouterFinishReason && (
            <div>
              <div className="text-xs text-gray-500">Finish Reason</div>
              <div className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                aiRequest.openrouterFinishReason === 'stop' ? 'bg-green-100 text-green-800' :
                aiRequest.openrouterFinishReason === 'length' ? 'bg-yellow-100 text-yellow-800' :
                aiRequest.openrouterFinishReason === 'content_filter' ? 'bg-red-100 text-red-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {aiRequest.openrouterFinishReason}
              </div>
            </div>
          )}
          {aiRequest.openrouterIsByok !== null && aiRequest.openrouterIsByok !== undefined && (
            <div>
              <div className="text-xs text-gray-500">BYOK</div>
              <div className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                aiRequest.openrouterIsByok ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
              }`}>
                {aiRequest.openrouterIsByok ? 'Yes' : 'No'}
              </div>
            </div>
          )}
        </div>

        {/* Cost Details */}
        {(aiRequest.openrouterTotalCost !== null || aiRequest.openrouterCacheDiscount !== null) && (
          <div className="border-t pt-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Cost Details</h4>
            <div className="grid grid-cols-2 gap-4">
              {aiRequest.openrouterTotalCost != null && (
                <div className="bg-purple-50 rounded-lg p-3">
                  <div className="text-xs text-purple-600">Actual Cost</div>
                  <div className="text-lg font-bold text-purple-900">
                    ${(aiRequest.openrouterTotalCost ?? 0).toFixed(6)}
                  </div>
                </div>
              )}
              {aiRequest.openrouterCacheDiscount != null && aiRequest.openrouterCacheDiscount > 0 && (
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-xs text-green-600">Cache Savings</div>
                  <div className="text-lg font-bold text-green-900">
                    -${(aiRequest.openrouterCacheDiscount ?? 0).toFixed(6)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Timing Details */}
        {hasTimingData && (
          <div className="border-t pt-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Timing Breakdown</h4>
            <div className="space-y-2">
              {aiRequest.openrouterLatency && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Total Latency</span>
                  <span className="font-medium">{aiRequest.openrouterLatency}ms</span>
                </div>
              )}
              {aiRequest.openrouterGenerationTime && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Generation Time</span>
                  <span className="font-medium text-blue-600">{aiRequest.openrouterGenerationTime}ms</span>
                </div>
              )}
              {aiRequest.openrouterModerationLatency && aiRequest.openrouterModerationLatency > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Moderation Latency</span>
                  <span className="font-medium text-orange-600">{aiRequest.openrouterModerationLatency}ms</span>
                </div>
              )}
              {/* Timing Waterfall */}
              {aiRequest.openrouterLatency && aiRequest.openrouterGenerationTime && (
                <div className="mt-2">
                  <div className="flex rounded-full overflow-hidden h-3 bg-gray-100">
                    {aiRequest.openrouterModerationLatency && aiRequest.openrouterModerationLatency > 0 && (
                      <div
                        className="bg-orange-400"
                        style={{ width: `${(aiRequest.openrouterModerationLatency / aiRequest.openrouterLatency) * 100}%` }}
                        title={`Moderation: ${aiRequest.openrouterModerationLatency}ms`}
                      />
                    )}
                    <div
                      className="bg-blue-500"
                      style={{ width: `${(aiRequest.openrouterGenerationTime / aiRequest.openrouterLatency) * 100}%` }}
                      title={`Generation: ${aiRequest.openrouterGenerationTime}ms`}
                    />
                    <div className="bg-gray-300 flex-1" title="Network/Other" />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-gray-400">
                    <span>Moderation</span>
                    <span>Generation</span>
                    <span>Network</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Token Details */}
        {hasTokenData && (
          <div className="border-t pt-4">
            <h4 className="text-xs font-medium text-gray-500 mb-2">Native Token Details</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {aiRequest.openrouterNativeTokensPrompt != null && (
                <div className="bg-blue-50 rounded p-2">
                  <div className="text-xs text-blue-600">Prompt</div>
                  <div className="font-bold text-blue-900">
                    {(aiRequest.openrouterNativeTokensPrompt ?? 0).toLocaleString()}
                  </div>
                </div>
              )}
              {aiRequest.openrouterNativeTokensCompletion != null && (
                <div className="bg-green-50 rounded p-2">
                  <div className="text-xs text-green-600">Completion</div>
                  <div className="font-bold text-green-900">
                    {(aiRequest.openrouterNativeTokensCompletion ?? 0).toLocaleString()}
                  </div>
                </div>
              )}
              {aiRequest.openrouterNativeTokensCached != null && aiRequest.openrouterNativeTokensCached > 0 && (
                <div className="bg-amber-50 rounded p-2">
                  <div className="text-xs text-amber-600">Cached</div>
                  <div className="font-bold text-amber-900">
                    {(aiRequest.openrouterNativeTokensCached ?? 0).toLocaleString()}
                  </div>
                </div>
              )}
              {aiRequest.openrouterNativeTokensReasoning != null && aiRequest.openrouterNativeTokensReasoning > 0 && (
                <div className="bg-purple-50 rounded p-2">
                  <div className="text-xs text-purple-600">Reasoning</div>
                  <div className="font-bold text-purple-900">
                    {(aiRequest.openrouterNativeTokensReasoning ?? 0).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Raw Response (collapsible) */}
        {aiRequest.openrouterRawResponse && (
          <details className="border-t pt-4">
            <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
              View Raw OpenRouter Response
            </summary>
            <div className="mt-2">
              <SmartBodyViewer content={aiRequest.openrouterRawResponse} maxHeight="max-h-64" />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// Request Parameters Panel - extracts parameters from fullRequest
function RequestParametersPanel({ fullRequest }: { fullRequest: string | null }) {
  const params = useMemo(() => {
    if (!fullRequest) return null;
    try {
      const parsed = JSON.parse(fullRequest);
      return {
        temperature: parsed.temperature,
        maxTokens: parsed.max_tokens ?? parsed.max_completion_tokens,
        topP: parsed.top_p,
        topK: parsed.top_k,
        frequencyPenalty: parsed.frequency_penalty,
        presencePenalty: parsed.presence_penalty,
        seed: parsed.seed,
        responseFormat: parsed.response_format,
        stream: parsed.stream,
        tools: parsed.tools,
        toolChoice: parsed.tool_choice,
        stop: parsed.stop,
        logprobs: parsed.logprobs,
        n: parsed.n,
      };
    } catch {
      return null;
    }
  }, [fullRequest]);

  if (!params) return null;

  const hasParams = Object.values(params).some(v => v !== undefined && v !== null);
  if (!hasParams) return null;

  const toolCount = params.tools?.length || 0;
  const toolNames = params.tools?.map((t: any) => t.function?.name || t.name).filter(Boolean) || [];

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        Request Parameters
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {params.temperature !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Temperature</div>
            <div className="font-medium text-gray-900 flex items-center gap-2">
              {params.temperature}
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${params.temperature <= 0.3 ? 'bg-blue-500' : params.temperature <= 0.7 ? 'bg-green-500' : params.temperature <= 1.2 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(params.temperature / 2 * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
        {params.maxTokens !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Max Tokens</div>
            <div className="font-medium text-gray-900">{params.maxTokens.toLocaleString()}</div>
          </div>
        )}
        {params.topP !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Top P</div>
            <div className="font-medium text-gray-900">{params.topP}</div>
          </div>
        )}
        {params.topK !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Top K</div>
            <div className="font-medium text-gray-900">{params.topK}</div>
          </div>
        )}
        {params.frequencyPenalty !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Frequency Penalty</div>
            <div className="font-medium text-gray-900">{params.frequencyPenalty}</div>
          </div>
        )}
        {params.presencePenalty !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Presence Penalty</div>
            <div className="font-medium text-gray-900">{params.presencePenalty}</div>
          </div>
        )}
        {params.seed !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Seed</div>
            <div className="font-mono text-sm text-gray-900">{params.seed}</div>
          </div>
        )}
        {params.n !== undefined && params.n > 1 && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">N (choices)</div>
            <div className="font-medium text-gray-900">{params.n}</div>
          </div>
        )}
        {params.stream !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Streaming</div>
            <div className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
              params.stream ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
            }`}>
              {params.stream ? 'Yes' : 'No'}
            </div>
          </div>
        )}
        {params.responseFormat && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Response Format</div>
            <div className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
              params.responseFormat.type === 'json_object' ? 'bg-purple-100 text-purple-800' :
              params.responseFormat.type === 'json_schema' ? 'bg-indigo-100 text-indigo-800' :
              'bg-gray-100 text-gray-600'
            }`}>
              {params.responseFormat.type || 'text'}
            </div>
          </div>
        )}
        {params.logprobs !== undefined && (
          <div className="bg-gray-50 rounded p-2">
            <div className="text-xs text-gray-500">Logprobs</div>
            <div className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
              params.logprobs ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
            }`}>
              {params.logprobs ? 'Yes' : 'No'}
            </div>
          </div>
        )}
      </div>

      {/* Tools Section */}
      {toolCount > 0 && (
        <div className="mt-4 border-t pt-4">
          <h4 className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Tools ({toolCount})
          </h4>
          <div className="flex flex-wrap gap-2">
            {toolNames.map((name: string, i: number) => (
              <span key={i} className="px-2 py-1 bg-yellow-50 text-yellow-800 text-xs rounded border border-yellow-200 font-mono">
                {name}()
              </span>
            ))}
          </div>
          {params.toolChoice && (
            <div className="mt-2 text-xs text-gray-500">
              Tool Choice: <code className="bg-gray-100 px-1 rounded">
                {typeof params.toolChoice === 'string' ? params.toolChoice : JSON.stringify(params.toolChoice)}
              </code>
            </div>
          )}
        </div>
      )}

      {/* Stop Sequences */}
      {params.stop && (
        <div className="mt-4 border-t pt-4">
          <h4 className="text-xs font-medium text-gray-500 mb-2">Stop Sequences</h4>
          <div className="flex flex-wrap gap-2">
            {(Array.isArray(params.stop) ? params.stop : [params.stop]).map((s: string, i: number) => (
              <code key={i} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                {JSON.stringify(s)}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Separate component for AI Details to keep code organized
function AiDetailsTab({
  aiRequest,
  formatCost,
}: {
  aiRequest: AiRequest;
  formatCost: (micros: number | null) => string;
}) {
  const totalTokens = aiRequest.totalTokens || 0;
  const promptTokens = aiRequest.promptTokens || 0;
  const completionTokens = aiRequest.completionTokens || 0;
  const promptPercent = totalTokens > 0 ? (promptTokens / totalTokens) * 100 : 0;
  const completionPercent = totalTokens > 0 ? (completionTokens / totalTokens) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* AI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
          <div className="text-xs text-purple-600 font-medium">Provider</div>
          <div className="text-lg font-bold text-purple-900 capitalize mt-1">
            {aiRequest.provider}
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
          <div className="text-xs text-blue-600 font-medium">Model</div>
          <div className="text-lg font-bold text-blue-900 mt-1 truncate" title={aiRequest.model || undefined}>
            {aiRequest.model || '-'}
          </div>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
          <div className="text-xs text-green-600 font-medium">Total Tokens</div>
          <div className="text-lg font-bold text-green-900 mt-1">
            {aiRequest.totalTokens?.toLocaleString() || '-'}
          </div>
          <div className="text-xs text-green-600 mt-1">
            {promptTokens.toLocaleString()} in / {completionTokens.toLocaleString()} out
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-4 border border-amber-200">
          <div className="text-xs text-amber-600 font-medium">Total Cost</div>
          <div className="text-lg font-bold text-amber-900 mt-1">
            {formatCost(aiRequest.totalCostMicros)}
          </div>
          <div className="text-xs text-amber-600 mt-1">
            {formatCost(aiRequest.inputCostMicros)} / {formatCost(aiRequest.outputCostMicros)}
          </div>
        </div>
      </div>

      {/* Token Usage Bar */}
      {totalTokens > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Token Usage</h3>
          <div className="flex rounded-full overflow-hidden h-4 bg-gray-100">
            <div
              className="bg-blue-500 transition-all"
              style={{ width: `${promptPercent}%` }}
              title={`Prompt: ${promptTokens.toLocaleString()} tokens`}
            />
            <div
              className="bg-green-500 transition-all"
              style={{ width: `${completionPercent}%` }}
              title={`Completion: ${completionTokens.toLocaleString()} tokens`}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Prompt: {promptTokens.toLocaleString()} ({promptPercent.toFixed(1)}%)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Completion: {completionTokens.toLocaleString()} ({completionPercent.toFixed(1)}%)
            </span>
          </div>
        </div>
      )}

      {/* Timing */}
      {aiRequest.isStreaming && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Timing</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-gray-500">Time to First Token</div>
              <div className="text-xl font-bold text-gray-900">
                {aiRequest.timeToFirstToken ? `${aiRequest.timeToFirstToken}ms` : '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Total Duration</div>
              <div className="text-xl font-bold text-gray-900">
                {aiRequest.totalDuration ? `${aiRequest.totalDuration}ms` : '-'}
              </div>
            </div>
          </div>
          {aiRequest.timeToFirstToken && aiRequest.totalDuration && (
            <div className="mt-3">
              <div className="flex rounded-full overflow-hidden h-2 bg-gray-100">
                <div
                  className="bg-purple-500"
                  style={{ width: `${(aiRequest.timeToFirstToken / aiRequest.totalDuration) * 100}%` }}
                  title="Time to first token"
                />
                <div className="bg-blue-400 flex-1" title="Streaming duration" />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-400">
                <span>TTFT</span>
                <span>Streaming</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* OpenRouter Details Panel */}
      {aiRequest.provider === 'openrouter' && (
        <OpenRouterPanel aiRequest={aiRequest} />
      )}

      {/* Request Parameters Panel */}
      <RequestParametersPanel fullRequest={aiRequest.fullRequest} />

      {/* Conversation View */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">Conversation</h3>
          <div className="flex gap-2">
            {(aiRequest.systemPrompt || aiRequest.userMessages) && (
              <CopyButton
                text={[
                  aiRequest.systemPrompt ? `[System]\n${aiRequest.systemPrompt}` : '',
                  aiRequest.userMessages
                    ? JSON.parse(aiRequest.userMessages).map((m: string) => `[User]\n${m}`).join('\n\n')
                    : ''
                ].filter(Boolean).join('\n\n')}
                label="Copy Prompt"
                size="sm"
                variant="ghost"
              />
            )}
            {aiRequest.assistantResponse && (
              <CopyButton
                text={aiRequest.assistantResponse}
                label="Copy Response"
                size="sm"
                variant="ghost"
              />
            )}
          </div>
        </div>
        <div className="p-4 space-y-4">
          {/* System Prompt */}
          {aiRequest.systemPrompt && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-xs font-medium text-gray-500 mb-1">System</div>
                <div className="bg-gray-100 rounded-lg p-3 text-sm whitespace-pre-wrap">
                  {aiRequest.systemPrompt}
                </div>
              </div>
            </div>
          )}

          {/* User Messages */}
          {aiRequest.userMessages && (
            <>
              {JSON.parse(aiRequest.userMessages).map((msg: string, i: number) => (
                <div key={i} className="flex gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-blue-600 mb-1">User</div>
                    <div className="bg-blue-50 rounded-lg p-3 text-sm whitespace-pre-wrap border border-blue-100">
                      {msg}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Assistant Response */}
          {aiRequest.assistantResponse && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-xs font-medium text-green-600 mb-1">Assistant</div>
                <div className="bg-green-50 rounded-lg p-3 text-sm whitespace-pre-wrap border border-green-100">
                  {aiRequest.assistantResponse}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full Request/Response JSON */}
      <details className="bg-white rounded-lg shadow group">
        <summary className="p-4 cursor-pointer text-sm font-medium text-gray-900 flex items-center justify-between hover:bg-gray-50">
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Full Request JSON
          </span>
          {aiRequest.fullRequest && (
            <CopyButton text={aiRequest.fullRequest} label="Copy" showLabel={false} variant="ghost" />
          )}
        </summary>
        <div className="px-4 pb-4">
          <SmartBodyViewer content={aiRequest.fullRequest} maxHeight="max-h-96" />
        </div>
      </details>

      <details className="bg-white rounded-lg shadow group">
        <summary className="p-4 cursor-pointer text-sm font-medium text-gray-900 flex items-center justify-between hover:bg-gray-50">
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Full Response JSON
          </span>
          {aiRequest.fullResponse && (
            <CopyButton text={aiRequest.fullResponse} label="Copy" showLabel={false} variant="ghost" />
          )}
        </summary>
        <div className="px-4 pb-4">
          <SmartBodyViewer content={aiRequest.fullResponse} maxHeight="max-h-96" />
        </div>
      </details>
    </div>
  );
}

export default RequestDetail;
