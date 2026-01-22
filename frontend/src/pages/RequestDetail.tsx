import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CopyButton } from '../components/CopyButton';
import { SmartBodyViewer } from '../components/SmartBodyViewer';
import { HeadersTable } from '../components/HeadersTable';
import { generateCurl } from '../utils/curlGenerator';

// Tool call structure
interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Conversation message structure
interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  hasImages?: boolean;
  imageCount?: number;
}

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
  // Full conversation with all message types
  messages?: string | null;
  // Tool-call metadata
  hasToolCalls?: boolean;
  toolCallCount?: number | null;
  toolNames?: string | null;
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
    <div className="space-y-4">
      {/* Compact Header with inline stats */}
      <div className="bg-white rounded-lg shadow px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Back + Method + Status + URL */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => navigate(-1)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 flex-shrink-0"
              title="Go back"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <span className={`px-2 py-0.5 text-xs font-bold rounded border flex-shrink-0 ${getMethodColor(log.method)}`}>
              {log.method}
            </span>
            <span className={`px-2 py-0.5 text-sm font-bold rounded flex-shrink-0 ${getStatusBg(log.statusCode)} ${getStatusColor(log.statusCode)}`}>
              {log.statusCode || '...'}
            </span>
            {log.isAiRequest && (
              <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-800 flex-shrink-0">
                AI
              </span>
            )}
            {log.aiRequest?.isStreaming && (
              <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-800 flex-shrink-0">
                Stream
              </span>
            )}
            <span className="text-sm text-gray-600 font-mono truncate" title={log.url}>
              {log.path}
            </span>
          </div>

          {/* Right: Stats + Actions */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Inline Stats */}
            <div className="hidden md:flex items-center gap-4 text-xs text-gray-500">
              <span title={log.targetUrl} className="truncate max-w-[150px]">
                → {log.targetUrl ? new URL(log.targetUrl).host : '-'}
              </span>
              <span className={log.responseTime && log.responseTime > 1000 ? 'text-orange-600' : log.responseTime && log.responseTime > 500 ? 'text-yellow-600' : ''}>
                {log.responseTime ? `${log.responseTime}ms` : '-'}
              </span>
              <span>{log.bodySize > 0 ? `↑${(log.bodySize / 1024).toFixed(1)}KB` : ''}</span>
              <span>{log.responseSize > 0 ? `↓${(log.responseSize / 1024).toFixed(1)}KB` : ''}</span>
              <span className="text-gray-400">{new Date(log.createdAt).toLocaleTimeString()}</span>
            </div>
            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyCurl}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded bg-gray-900 text-white hover:bg-gray-800 transition-colors"
                title="Copy as cURL command"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                cURL
              </button>
              <CopyButton text={log.url} label="URL" size="sm" />
            </div>
          </div>
        </div>
        {/* Mobile stats row */}
        <div className="md:hidden flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
          <span>→ {log.targetUrl ? new URL(log.targetUrl).host : '-'}</span>
          <span>{log.responseTime ? `${log.responseTime}ms` : '-'}</span>
          <span>{log.bodySize > 0 ? `↑${(log.bodySize / 1024).toFixed(1)}KB` : ''}</span>
          <span>{log.responseSize > 0 ? `↓${(log.responseSize / 1024).toFixed(1)}KB` : ''}</span>
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
          <AiDetailsTab aiRequest={log.aiRequest} formatCost={formatCost} requestId={log.id} />
        )}
      </div>
    </div>
  );
}

// OpenRouter Details Panel - Compact version
function OpenRouterPanel({ aiRequest }: { aiRequest: AiRequest }) {
  const hasTimingData = aiRequest.openrouterLatency || aiRequest.openrouterGenerationTime || aiRequest.openrouterModerationLatency;
  const hasTokenData = aiRequest.openrouterNativeTokensPrompt || aiRequest.openrouterNativeTokensCompletion ||
                       aiRequest.openrouterNativeTokensReasoning || aiRequest.openrouterNativeTokensCached;

  if (!aiRequest.openrouterEnriched) {
    return (
      <div className="bg-purple-50 rounded-lg px-3 py-2 border border-purple-200">
        <div className="flex items-center gap-2 text-purple-700 text-sm">
          <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Pending enrichment...</span>
          {aiRequest.openrouterGenerationId && (
            <code className="bg-purple-200 px-1 rounded text-xs ml-auto">{aiRequest.openrouterGenerationId.slice(0, 20)}...</code>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-3 space-y-3">
        {/* Compact header row with key info */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {aiRequest.openrouterFinishReason && (
            <span className={`px-1.5 py-0.5 rounded font-medium ${
              aiRequest.openrouterFinishReason === 'stop' ? 'bg-green-100 text-green-700' :
              aiRequest.openrouterFinishReason === 'length' ? 'bg-yellow-100 text-yellow-700' :
              'bg-gray-100 text-gray-700'
            }`}>
              {aiRequest.openrouterFinishReason}
            </span>
          )}
          {aiRequest.openrouterIsByok && (
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">BYOK</span>
          )}
          {aiRequest.openrouterGenerationId && (
            <span className="text-gray-400 font-mono truncate max-w-[180px]" title={aiRequest.openrouterGenerationId}>
              {aiRequest.openrouterGenerationId}
            </span>
          )}
          {aiRequest.openrouterEnrichedAt && (
            <span className="text-gray-400 ml-auto">
              {new Date(aiRequest.openrouterEnrichedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Compact metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {/* Cost */}
          {aiRequest.openrouterTotalCost != null && (
            <div className="bg-purple-50 rounded px-2 py-1.5">
              <div className="text-[10px] text-purple-600 uppercase">Cost</div>
              <div className="text-sm font-bold text-purple-900">${aiRequest.openrouterTotalCost.toFixed(6)}</div>
            </div>
          )}
          {/* Cache Savings */}
          {aiRequest.openrouterCacheDiscount != null && aiRequest.openrouterCacheDiscount > 0 && (
            <div className="bg-green-50 rounded px-2 py-1.5">
              <div className="text-[10px] text-green-600 uppercase">Saved</div>
              <div className="text-sm font-bold text-green-900">-${aiRequest.openrouterCacheDiscount.toFixed(6)}</div>
            </div>
          )}
          {/* Latency */}
          {aiRequest.openrouterLatency && (
            <div className="bg-gray-50 rounded px-2 py-1.5">
              <div className="text-[10px] text-gray-500 uppercase">Latency</div>
              <div className="text-sm font-bold text-gray-900">{aiRequest.openrouterLatency}ms</div>
            </div>
          )}
          {/* Generation Time */}
          {aiRequest.openrouterGenerationTime && (
            <div className="bg-blue-50 rounded px-2 py-1.5">
              <div className="text-[10px] text-blue-600 uppercase">Generation</div>
              <div className="text-sm font-bold text-blue-900">{aiRequest.openrouterGenerationTime}ms</div>
            </div>
          )}
        </div>

        {/* Timing Waterfall - Compact */}
        {hasTimingData && aiRequest.openrouterLatency && aiRequest.openrouterGenerationTime && (
          <div>
            <div className="flex rounded-full overflow-hidden h-2 bg-gray-100">
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
          </div>
        )}

        {/* Native Token Details - Compact inline */}
        {hasTokenData && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">Native:</span>
            {aiRequest.openrouterNativeTokensPrompt != null && (
              <span className="text-blue-700">{aiRequest.openrouterNativeTokensPrompt.toLocaleString()}↑</span>
            )}
            {aiRequest.openrouterNativeTokensCompletion != null && (
              <span className="text-green-700">{aiRequest.openrouterNativeTokensCompletion.toLocaleString()}↓</span>
            )}
            {aiRequest.openrouterNativeTokensCached != null && aiRequest.openrouterNativeTokensCached > 0 && (
              <span className="text-amber-700">{aiRequest.openrouterNativeTokensCached.toLocaleString()} cached</span>
            )}
            {aiRequest.openrouterNativeTokensReasoning != null && aiRequest.openrouterNativeTokensReasoning > 0 && (
              <span className="text-purple-700">{aiRequest.openrouterNativeTokensReasoning.toLocaleString()} reasoning</span>
            )}
          </div>
        )}

        {/* Raw Response - Compact collapsible */}
        {aiRequest.openrouterRawResponse && (
          <details className="border-t pt-2">
            <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
              Raw Response
            </summary>
            <div className="mt-2">
              <SmartBodyViewer content={aiRequest.openrouterRawResponse} maxHeight="max-h-48" />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

// Conversation View with Tool-Call Support
function ConversationView({ aiRequest }: { aiRequest: AiRequest }) {
  // Try to parse the new messages format first, fall back to legacy
  const messages: ConversationMessage[] = useMemo(() => {
    if (aiRequest.messages) {
      try {
        return JSON.parse(aiRequest.messages);
      } catch {
        // Fall through to legacy
      }
    }

    // Legacy format: construct from systemPrompt, userMessages, assistantResponse
    const legacyMessages: ConversationMessage[] = [];

    if (aiRequest.systemPrompt) {
      legacyMessages.push({
        role: 'system',
        content: aiRequest.systemPrompt,
      });
    }

    if (aiRequest.userMessages) {
      try {
        const userMsgs = JSON.parse(aiRequest.userMessages) as string[];
        for (const msg of userMsgs) {
          legacyMessages.push({
            role: 'user',
            content: msg,
          });
        }
      } catch {
        // Invalid JSON
      }
    }

    if (aiRequest.assistantResponse) {
      legacyMessages.push({
        role: 'assistant',
        content: aiRequest.assistantResponse,
      });
    }

    return legacyMessages;
  }, [aiRequest.messages, aiRequest.systemPrompt, aiRequest.userMessages, aiRequest.assistantResponse]);

  const copyText = useMemo(() => {
    return messages
      .map((m) => {
        const roleLabel = m.role.charAt(0).toUpperCase() + m.role.slice(1);
        if (m.toolCalls && m.toolCalls.length > 0) {
          const toolCallText = m.toolCalls
            .map((tc) => `[Tool Call: ${tc.function.name}]\n${tc.function.arguments}`)
            .join('\n\n');
          return `[${roleLabel}]\n${m.content || ''}\n${toolCallText}`;
        }
        if (m.role === 'tool') {
          return `[Tool Result: ${m.toolName || 'unknown'}]\n${m.content}`;
        }
        return `[${roleLabel}]\n${m.content}`;
      })
      .join('\n\n');
  }, [messages]);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'system':
        return (
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'user':
        return (
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case 'assistant':
        return (
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        );
      case 'tool':
        return (
          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getRoleStyles = (role: string) => {
    switch (role) {
      case 'system':
        return {
          avatar: 'bg-gray-200',
          label: 'text-gray-500',
          bubble: 'bg-gray-100',
        };
      case 'user':
        return {
          avatar: 'bg-blue-100',
          label: 'text-blue-600',
          bubble: 'bg-blue-50 border border-blue-100',
        };
      case 'assistant':
        return {
          avatar: 'bg-green-100',
          label: 'text-green-600',
          bubble: 'bg-green-50 border border-green-100',
        };
      case 'tool':
        return {
          avatar: 'bg-amber-100',
          label: 'text-amber-600',
          bubble: 'bg-amber-50 border border-amber-200',
        };
      default:
        return {
          avatar: 'bg-gray-200',
          label: 'text-gray-500',
          bubble: 'bg-gray-100',
        };
    }
  };

  if (messages.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        No conversation data available
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-900">Conversation</h3>
          {aiRequest.hasToolCalls && (
            <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-200">
              {aiRequest.toolCallCount || 0} Tool Call{(aiRequest.toolCallCount || 0) !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <CopyButton
            text={copyText}
            label="Copy Prompt"
            size="sm"
            variant="ghost"
          />
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
        {messages.map((msg, i) => {
          const styles = getRoleStyles(msg.role);
          return (
            <div key={i} className="flex gap-3">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full ${styles.avatar} flex items-center justify-center`}>
                {getRoleIcon(msg.role)}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${styles.label} mb-1 flex items-center gap-2`}>
                  <span className="capitalize">{msg.role}</span>
                  {msg.hasImages && msg.imageCount && msg.imageCount > 0 && (
                    <span className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                      {msg.imageCount} image{msg.imageCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {msg.role === 'tool' && msg.toolName && (
                    <code className="px-1.5 py-0.5 text-xs bg-amber-200 text-amber-800 rounded font-mono">
                      {msg.toolName}
                    </code>
                  )}
                </div>

                {/* Content */}
                {msg.content && (
                  <div className={`${styles.bubble} rounded-lg p-3 text-sm whitespace-pre-wrap break-words`}>
                    {msg.content}
                  </div>
                )}

                {/* Tool Calls for Assistant messages */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className={msg.content ? 'mt-2 space-y-2' : 'space-y-2'}>
                    {msg.toolCalls.map((tc, tcIndex) => (
                      <ToolCallBlock key={tcIndex} toolCall={tc} />
                    ))}
                  </div>
                )}

                {/* Show placeholder when assistant has no content and no tool calls */}
                {msg.role === 'assistant' && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                  <div className="text-sm text-gray-400 italic">
                    (No response content)
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Tool Call Block Component
function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [isExpanded, setIsExpanded] = useState(false);

  let parsedArgs: any = null;
  try {
    parsedArgs = JSON.parse(toolCall.function.arguments);
  } catch {
    // Keep as string
  }

  return (
    <div className="border border-amber-300 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-amber-100/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-medium text-amber-900">Tool Call:</span>
          <code className="px-2 py-0.5 bg-amber-200 text-amber-900 rounded text-sm font-mono">
            {toolCall.function.name}()
          </code>
        </div>
        <svg
          className={`w-4 h-4 text-amber-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-amber-200">
          <div className="mt-2">
            <div className="text-xs font-medium text-amber-700 mb-1">Arguments:</div>
            <pre className="bg-white rounded p-2 text-xs overflow-x-auto border border-amber-200">
              {parsedArgs ? JSON.stringify(parsedArgs, null, 2) : toolCall.function.arguments}
            </pre>
          </div>
          {toolCall.id && toolCall.id !== 'legacy' && (
            <div className="mt-2 text-xs text-amber-600">
              ID: <code className="bg-amber-100 px-1 rounded">{toolCall.id}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Quick Replay Panel with copy options
function QuickReplayPanel({ aiRequest }: { aiRequest: AiRequest }) {
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  const generatePythonCode = useMemo(() => {
    if (!aiRequest.fullRequest) return '';
    try {
      const req = JSON.parse(aiRequest.fullRequest);
      const provider = aiRequest.provider;

      let code = '';
      if (provider === 'openai' || provider === 'openrouter') {
        code = `from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",${provider === 'openrouter' ? '\n    base_url="https://openrouter.ai/api/v1",' : ''}
)

response = client.chat.completions.create(
    model="${req.model || 'gpt-4o'}",
    messages=${JSON.stringify(req.messages || [], null, 4).split('\n').join('\n    ')},${req.temperature !== undefined ? `\n    temperature=${req.temperature},` : ''}${req.max_tokens !== undefined ? `\n    max_tokens=${req.max_tokens},` : ''}
)

print(response.choices[0].message.content)`;
      } else if (provider === 'anthropic') {
        code = `import anthropic

client = anthropic.Anthropic(api_key="YOUR_API_KEY")

response = client.messages.create(
    model="${req.model || 'claude-3-sonnet-20240229'}",${req.system ? `\n    system="${req.system.replace(/"/g, '\\"').substring(0, 100)}...",` : ''}
    messages=${JSON.stringify(req.messages || [], null, 4).split('\n').join('\n    ')},${req.max_tokens !== undefined ? `\n    max_tokens=${req.max_tokens},` : '\n    max_tokens=1024,'}
)

print(response.content[0].text)`;
      } else {
        // Generic REST
        code = `import requests

response = requests.post(
    "YOUR_API_ENDPOINT",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json",
    },
    json=${JSON.stringify(req, null, 4).split('\n').join('\n    ')},
)

print(response.json())`;
      }
      return code;
    } catch {
      return '';
    }
  }, [aiRequest.fullRequest, aiRequest.provider]);

  const generateTypeScriptCode = useMemo(() => {
    if (!aiRequest.fullRequest) return '';
    try {
      const req = JSON.parse(aiRequest.fullRequest);
      const provider = aiRequest.provider;

      let code = '';
      if (provider === 'openai' || provider === 'openrouter') {
        code = `import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,${provider === 'openrouter' ? "\n  baseURL: 'https://openrouter.ai/api/v1'," : ''}
});

const response = await client.chat.completions.create({
  model: '${req.model || 'gpt-4o'}',
  messages: ${JSON.stringify(req.messages || [], null, 2).split('\n').join('\n  ')},${req.temperature !== undefined ? `\n  temperature: ${req.temperature},` : ''}${req.max_tokens !== undefined ? `\n  max_tokens: ${req.max_tokens},` : ''}
});

console.log(response.choices[0].message.content);`;
      } else if (provider === 'anthropic') {
        code = `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const response = await client.messages.create({
  model: '${req.model || 'claude-3-sonnet-20240229'}',${req.system ? `\n  system: '${req.system.replace(/'/g, "\\'")}',` : ''}
  messages: ${JSON.stringify(req.messages || [], null, 2).split('\n').join('\n  ')},${req.max_tokens !== undefined ? `\n  max_tokens: ${req.max_tokens},` : '\n  max_tokens: 1024,'}
});

console.log(response.content[0].text);`;
      } else {
        code = `const response = await fetch('YOUR_API_ENDPOINT', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${JSON.stringify(req, null, 2).split('\n').join('\n  ')}),
});

const data = await response.json();
console.log(data);`;
      }
      return code;
    } catch {
      return '';
    }
  }, [aiRequest.fullRequest, aiRequest.provider]);

  const handleCopy = async (format: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedFormat(format);
    toast.success(`${format} code copied!`);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  if (!aiRequest.fullRequest) return null;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Replay Request
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Copy this request as code to replay or modify it in your preferred environment.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleCopy('Python', generatePythonCode)}
          className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
            copiedFormat === 'Python'
              ? 'bg-green-50 border-green-300 text-green-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05zm-6.3 1.98l-.23.33-.08.41.08.41.23.34.33.22.41.09.41-.09.33-.22.23-.34.08-.41-.08-.41-.23-.33-.33-.22-.41-.09-.41.09zm13.09 3.95l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01zm-6.47 14.25l-.23.33-.08.41.08.41.23.33.33.23.41.08.41-.08.33-.23.23-.33.08-.41-.08-.41-.23-.33-.33-.23-.41-.08-.41.08z"/>
          </svg>
          {copiedFormat === 'Python' ? 'Copied!' : 'Copy as Python'}
        </button>
        <button
          onClick={() => handleCopy('TypeScript', generateTypeScriptCode)}
          className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
            copiedFormat === 'TypeScript'
              ? 'bg-green-50 border-green-300 text-green-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z"/>
          </svg>
          {copiedFormat === 'TypeScript' ? 'Copied!' : 'Copy as TypeScript'}
        </button>
        <CopyButton
          text={aiRequest.fullRequest}
          label="Copy JSON Body"
          size="sm"
          variant="ghost"
        />
      </div>
    </div>
  );
}

// Enhanced Timing Waterfall Visualization - Compact
function TimingWaterfall({ aiRequest }: { aiRequest: AiRequest }) {
  const totalDuration = aiRequest.totalDuration || 0;
  const ttft = aiRequest.timeToFirstToken || 0;
  const completionTokens = aiRequest.completionTokens || 0;

  // Calculate tokens per second (for streaming)
  const streamingTime = totalDuration - ttft;
  const tokensPerSecond = streamingTime > 0 && completionTokens > 0
    ? (completionTokens / (streamingTime / 1000)).toFixed(1)
    : null;

  if (!totalDuration) return null;

  // For non-streaming requests, show simple timing
  if (!aiRequest.isStreaming) {
    return (
      <div className="bg-white rounded-lg shadow p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Request Timing
          </h3>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-bold text-gray-900">{totalDuration}ms</span>
            {completionTokens > 0 && (
              <span className="text-blue-600 font-medium">
                {(completionTokens / (totalDuration / 1000)).toFixed(1)} tok/s
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // For streaming requests, show detailed waterfall
  const ttftPercent = totalDuration > 0 ? (ttft / totalDuration) * 100 : 0;

  return (
    <div className="bg-white rounded-lg shadow p-3">
      {/* Header with inline stats */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-gray-500 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Streaming Timeline
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span><span className="text-purple-600 font-medium">TTFT:</span> {ttft}ms</span>
          <span><span className="text-blue-600 font-medium">Total:</span> {totalDuration}ms</span>
          {tokensPerSecond && <span className="text-green-600 font-bold">{tokensPerSecond} tok/s</span>}
        </div>
      </div>

      {/* Waterfall Visualization - Compact */}
      <div className="relative">
        <div className="flex rounded-lg overflow-hidden h-5 bg-gray-100">
          <div
            className="bg-gradient-to-r from-purple-400 to-purple-500 flex items-center justify-center transition-all"
            style={{ width: `${ttftPercent}%` }}
            title={`Time to First Token: ${ttft}ms`}
          >
            {ttftPercent > 20 && <span className="text-[10px] text-white font-medium">TTFT</span>}
          </div>
          <div
            className="bg-gradient-to-r from-blue-400 to-blue-500 flex items-center justify-center flex-1"
            title={`Streaming: ${streamingTime}ms`}
          >
            {(100 - ttftPercent) > 20 && <span className="text-[10px] text-white font-medium">Streaming</span>}
          </div>
        </div>
      </div>

      {/* Timeline labels */}
      <div className="flex justify-between mt-1 text-[10px] text-gray-400">
        <span>0ms</span>
        <span>{ttft}ms</span>
        <span>{totalDuration}ms</span>
      </div>
    </div>
  );
}

// Context Window Visualization - Compact
// Uses OpenRouter for model info, or auth-replay via requestId for provider-specific lookups
function ContextWindowBar({ model, promptTokens, requestId }: { model: string | null; promptTokens: number | null; requestId?: string }) {
  const [contextLimit, setContextLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  // Fetch context limit from OpenRouter (or via auth-replay if requestId provided)
  useEffect(() => {
    if (!model) {
      setContextLimit(null);
      setSource(null);
      return;
    }

    const fetchContextLimit = async () => {
      setLoading(true);
      try {
        // If we have a requestId, use auth-replay endpoint for provider-specific lookup
        // Otherwise use the standard OpenRouter-based endpoint
        const url = requestId
          ? `/api/models/${encodeURIComponent(model)}/from-request/${encodeURIComponent(requestId)}`
          : `/api/models/${encodeURIComponent(model)}`;

        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setContextLimit(data.context_length || null);
          setSource(data.source || null);
        } else {
          setContextLimit(null);
          setSource(null);
        }
      } catch {
        setContextLimit(null);
        setSource(null);
      } finally {
        setLoading(false);
      }
    };

    fetchContextLimit();
  }, [model, requestId]);

  if (!promptTokens || promptTokens === 0) return null;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-3">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="animate-spin h-3 w-3 border border-gray-300 border-t-gray-600 rounded-full"></div>
          Loading context info...
        </div>
      </div>
    );
  }

  // Don't show if we couldn't find context limit
  if (!contextLimit) return null;

  const usagePercent = Math.min((promptTokens / contextLimit) * 100, 100);
  const isWarning = usagePercent > 80;
  const isCritical = usagePercent > 95;

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  return (
    <div className="bg-white rounded-lg shadow p-3">
      {/* Header with inline stats */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-gray-500 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
          Context Window
        </h3>
        <span className={`text-xs font-medium ${
          isCritical ? 'text-red-600' : isWarning ? 'text-yellow-600' : 'text-green-600'
        }`}>
          {usagePercent.toFixed(1)}% used
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative">
        <div className="flex rounded-full overflow-hidden h-2 bg-gray-100">
          <div
            className={`transition-all ${isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-blue-500'}`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <div className="absolute top-0 h-2 w-0.5 bg-yellow-600 opacity-40" style={{ left: '80%' }} title="80% warning" />
      </div>

      {/* Labels */}
      <div className="flex justify-between mt-1 text-[10px] text-gray-400">
        <span>{formatTokens(promptTokens)} tokens used</span>
        <span>
          {formatTokens(contextLimit)} limit
          {source && <span className="ml-1 opacity-60">({source})</span>}
        </span>
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
  requestId,
}: {
  aiRequest: AiRequest;
  formatCost: (micros: number | null) => string;
  requestId: string;
}) {
  const totalTokens = aiRequest.totalTokens || 0;
  const promptTokens = aiRequest.promptTokens || 0;
  const completionTokens = aiRequest.completionTokens || 0;
  const promptPercent = totalTokens > 0 ? (promptTokens / totalTokens) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Compact AI Summary Header */}
      <div className="bg-white rounded-lg shadow px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* Provider */}
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-100 text-purple-800 capitalize">
              {aiRequest.provider}
            </span>
            {aiRequest.provider === 'openrouter' && aiRequest.openrouterProviderName && (
              <span className="text-xs text-gray-500">via {aiRequest.openrouterProviderName}</span>
            )}
          </div>
          {/* Model */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Model:</span>
            <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]" title={aiRequest.model || undefined}>
              {aiRequest.model || '-'}
            </span>
          </div>
          {/* Tokens */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Tokens:</span>
            <span className="text-sm font-medium text-gray-900">
              {totalTokens.toLocaleString()}
            </span>
            <span className="text-xs text-gray-400">
              ({promptTokens.toLocaleString()}↑ {completionTokens.toLocaleString()}↓)
            </span>
          </div>
          {/* Cost */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Cost:</span>
            <span className="text-sm font-bold text-green-700">
              {formatCost(aiRequest.totalCostMicros)}
            </span>
          </div>
          {/* Timing */}
          {aiRequest.totalDuration && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Duration:</span>
              <span className="text-sm font-medium text-gray-900">{aiRequest.totalDuration}ms</span>
              {aiRequest.isStreaming && aiRequest.timeToFirstToken && (
                <span className="text-xs text-gray-400">(TTFT: {aiRequest.timeToFirstToken}ms)</span>
              )}
            </div>
          )}
        </div>

        {/* Token Usage Bar - Compact inline */}
        {totalTokens > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-3">
              <div className="flex-1 flex rounded-full overflow-hidden h-2 bg-gray-100">
                <div
                  className="bg-blue-500"
                  style={{ width: `${promptPercent}%` }}
                  title={`Prompt: ${promptTokens.toLocaleString()} (${promptPercent.toFixed(1)}%)`}
                />
                <div
                  className="bg-green-500 flex-1"
                  title={`Completion: ${completionTokens.toLocaleString()}`}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Prompt: {promptTokens.toLocaleString()} ({promptPercent.toFixed(1)}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Completion: {completionTokens.toLocaleString()} ({(100 - promptPercent).toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Streaming Timeline + Context Window - Combined compact row */}
      {(aiRequest.isStreaming || aiRequest.promptTokens) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TimingWaterfall aiRequest={aiRequest} />
          <ContextWindowBar model={aiRequest.model} promptTokens={aiRequest.promptTokens} requestId={requestId} />
        </div>
      )}

      {/* OpenRouter Details Panel - Collapsible */}
      {aiRequest.provider === 'openrouter' && (
        <details className="group">
          <summary className="cursor-pointer list-none">
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg px-4 py-3 flex items-center justify-between hover:from-purple-600 hover:to-purple-700 transition-colors">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                OpenRouter Insights
                {aiRequest.openrouterProviderName && (
                  <span className="text-purple-200 font-normal">
                    via {aiRequest.openrouterProviderName}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-3">
                {aiRequest.openrouterTotalCost != null && (
                  <span className="text-white text-sm font-medium">
                    ${aiRequest.openrouterTotalCost.toFixed(6)}
                  </span>
                )}
                <svg
                  className="w-4 h-4 text-white transition-transform group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </summary>
          <div className="mt-1">
            <OpenRouterPanel aiRequest={aiRequest} />
          </div>
        </details>
      )}

      {/* Request Parameters Panel */}
      <RequestParametersPanel fullRequest={aiRequest.fullRequest} />

      {/* Conversation View with Tool-Call Support */}
      <ConversationView aiRequest={aiRequest} />

      {/* Quick Replay Actions */}
      <QuickReplayPanel aiRequest={aiRequest} />

      {/* Full Request/Response JSON - Combined in one row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <details className="bg-white rounded-lg shadow group">
          <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-gray-900 flex items-center justify-between hover:bg-gray-50">
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
            <SmartBodyViewer content={aiRequest.fullRequest} maxHeight="max-h-64" />
          </div>
        </details>

        <details className="bg-white rounded-lg shadow group">
          <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-gray-900 flex items-center justify-between hover:bg-gray-50">
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
            <SmartBodyViewer content={aiRequest.fullResponse} maxHeight="max-h-64" />
          </div>
        </details>
      </div>
    </div>
  );
}

export default RequestDetail;
