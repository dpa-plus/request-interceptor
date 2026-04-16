import { useState, useEffect, useMemo } from 'react';
import { SmartBodyViewer } from './SmartBodyViewer';
import { HeadersTable } from './HeadersTable';
import { CopyButton } from './CopyButton';
import { generateCurl } from '../utils/curlGenerator';

interface RequestLog {
  id: string;
  method: string;
  url: string;
  path: string;
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
  isAiRequest: boolean;
  createdAt: string;
  error: string | null;
  aiRequest: {
    id: string;
    provider: string;
    model: string | null;
    isStreaming: boolean;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    totalCostMicros: number | null;
    totalDuration: number | null;
    timeToFirstToken: number | null;
    systemPrompt: string | null;
    userMessages: string | null;
    assistantResponse: string | null;
    messages: string | null;
    fullRequest: string | null;
    hasToolCalls: boolean;
    toolCallCount: number | null;
    toolNames: string | null;
  } | null;
}

interface Props {
  requestId: string;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-800/40 text-green-400 border-green-700/50',
  POST: 'bg-blue-800/40 text-blue-400 border-blue-700/50',
  PUT: 'bg-yellow-800/40 text-yellow-400 border-yellow-700/50',
  PATCH: 'bg-orange-800/40 text-orange-400 border-orange-700/50',
  DELETE: 'bg-red-800/40 text-red-400 border-red-700/50',
};

function getStatusColor(status: number | null): string {
  if (!status) return 'text-gray-500';
  if (status < 300) return 'text-green-400';
  if (status < 400) return 'text-yellow-400';
  return 'text-red-400';
}

export function RequestDetailPanel({ requestId }: Props) {
  const [log, setLog] = useState<RequestLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response' | 'ai'>('request');

  useEffect(() => {
    let cancelled = false;
    const fetchLog = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/logs/${requestId}`);
        if (!response.ok) throw new Error('Failed to load');
        const data = await response.json();
        if (!cancelled) {
          setLog(data);
          setError(null);
          if (data.aiRequest) setActiveTab('ai');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchLog();
    return () => { cancelled = true; };
  }, [requestId]);

  const curlCommand = useMemo(() => {
    if (!log) return '';
    return generateCurl({ method: log.method, url: log.url, headers: log.headers, body: log.body });
  }, [log]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading...
      </div>
    );
  }

  if (error || !log) {
    return (
      <div className="flex items-center justify-center h-48 text-red-400">
        {error || 'Not found'}
      </div>
    );
  }

  const methodColor = METHOD_COLORS[log.method] || 'bg-gray-700/40 text-gray-400 border-gray-600/50';

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Compact header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#30363d] bg-[#161b22]">
        <span className={`px-2 py-0.5 text-xs font-bold rounded border ${methodColor}`}>
          {log.method}
        </span>
        <span className={`font-bold ${getStatusColor(log.statusCode)}`}>
          {log.statusCode || '...'}
        </span>
        <span className="text-gray-300 font-mono truncate flex-1">{log.path}</span>
        <span className="text-gray-500 text-xs">
          {log.responseTime ? `${log.responseTime}ms` : ''}
        </span>
        <span className="text-gray-600 text-xs">
          {log.targetUrl}
        </span>
        <CopyButton text={curlCommand} label="cURL" />
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#30363d] bg-[#0d1117]">
        <button
          onClick={() => setActiveTab('request')}
          className={`px-4 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'request'
              ? 'border-[#58a6ff] text-[#58a6ff]'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Request
        </button>
        <button
          onClick={() => setActiveTab('response')}
          className={`px-4 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'response'
              ? 'border-[#58a6ff] text-[#58a6ff]'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          Response
        </button>
        {log.aiRequest && (
          <button
            onClick={() => setActiveTab('ai')}
            className={`px-4 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'ai'
                ? 'border-purple-400 text-purple-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            AI Details
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'request' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Headers</h4>
              <HeadersTable headers={log.headers} />
            </div>
            {log.body && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Body</h4>
                <SmartBodyViewer content={log.body} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'response' && (
          <div className="space-y-4">
            {log.responseHeaders && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Response Headers</h4>
                <HeadersTable headers={log.responseHeaders} />
              </div>
            )}
            {log.responseBody && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Response Body</h4>
                <SmartBodyViewer content={log.responseBody} />
              </div>
            )}
            {!log.responseBody && !log.responseHeaders && (
              <p className="text-gray-500">No response data available</p>
            )}
          </div>
        )}

        {activeTab === 'ai' && log.aiRequest && (() => {
          const ai = log.aiRequest;
          const promptPct = ai.totalTokens ? Math.round(((ai.promptTokens || 0) / ai.totalTokens) * 100) : 0;
          const completionPct = 100 - promptPct;
          const tokPerSec = ai.totalDuration && ai.completionTokens
            ? ((ai.completionTokens / ai.totalDuration) * 1000).toFixed(1)
            : null;

          // Parse conversation messages
          let messages: { role: string; content: string }[] = [];
          try {
            if (ai.messages) messages = JSON.parse(ai.messages);
          } catch {}
          // Fallback to legacy fields
          if (messages.length === 0) {
            if (ai.systemPrompt) messages.push({ role: 'system', content: ai.systemPrompt });
            if (ai.userMessages) {
              try {
                const parsed = JSON.parse(ai.userMessages);
                if (Array.isArray(parsed)) parsed.forEach((m: string) => messages.push({ role: 'user', content: m }));
                else messages.push({ role: 'user', content: String(parsed) });
              } catch { messages.push({ role: 'user', content: ai.userMessages }); }
            }
            if (ai.assistantResponse) messages.push({ role: 'assistant', content: ai.assistantResponse });
          }

          // Parse request params from fullRequest
          let reqParams: Record<string, any> = {};
          try {
            if (ai.fullRequest) {
              const parsed = JSON.parse(ai.fullRequest);
              if (parsed.temperature !== undefined) reqParams.temperature = parsed.temperature;
              if (parsed.max_tokens !== undefined) reqParams.max_tokens = parsed.max_tokens;
              if (parsed.top_p !== undefined) reqParams.top_p = parsed.top_p;
              if (parsed.response_format) reqParams.response_format = parsed.response_format.type || JSON.stringify(parsed.response_format);
            }
          } catch {}

          const roleColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
            system: { bg: 'bg-gray-800/50', border: 'border-gray-700', text: 'text-gray-400', icon: '⚙' },
            user: { bg: 'bg-[#1f6feb15]', border: 'border-[#1f6feb33]', text: 'text-[#58a6ff]', icon: '👤' },
            assistant: { bg: 'bg-green-900/20', border: 'border-green-800/30', text: 'text-green-400', icon: '🤖' },
            tool: { bg: 'bg-amber-900/20', border: 'border-amber-800/30', text: 'text-amber-400', icon: '🔧' },
          };

          return (
            <div className="space-y-4">
              {/* AI Summary bar */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-900/40 text-purple-300 capitalize">{ai.provider}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Model:</span>
                    <span className="text-sm font-medium text-gray-200">{ai.model || '-'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Tokens:</span>
                    <span className="text-sm font-medium text-gray-200">{ai.totalTokens?.toLocaleString() || '-'}</span>
                    {ai.promptTokens != null && ai.completionTokens != null && (
                      <span className="text-xs text-gray-500">({ai.promptTokens.toLocaleString()}↑ {ai.completionTokens.toLocaleString()}↓)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Cost:</span>
                    <span className="text-sm font-bold text-green-400">
                      {ai.totalCostMicros ? `$${(ai.totalCostMicros / 1_000_000).toFixed(ai.totalCostMicros > 100000 ? 2 : 4)}` : '-'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">Duration:</span>
                    <span className="text-sm font-medium text-gray-200">{ai.totalDuration || log.responseTime || '-'}ms</span>
                    {tokPerSec && <span className="text-xs text-[#58a6ff]">{tokPerSec} tok/s</span>}
                  </div>
                </div>

                {/* Token usage bar */}
                {ai.totalTokens && ai.totalTokens > 0 && (
                  <div className="mt-2 pt-2 border-t border-[#21262d]">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 flex rounded-full overflow-hidden h-1.5 bg-[#21262d]">
                        <div className="bg-blue-500" style={{ width: `${promptPct}%` }} />
                        <div className="bg-green-500 flex-1" />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-blue-500" />
                          Prompt: {promptPct}%
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          Completion: {completionPct}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Request Parameters */}
              {Object.keys(reqParams).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Request Parameters</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(reqParams).map(([key, value]) => (
                      <div key={key} className="bg-[#1c2333] rounded p-2">
                        <div className="text-xs text-gray-500">{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                        <div className="text-sm font-medium text-gray-200">
                          {typeof value === 'number' ? (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4)) : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Conversation */}
              {messages.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-gray-500 uppercase">Conversation</h4>
                    <div className="flex gap-1">
                      {ai.userMessages && <CopyButton text={ai.userMessages} label="Copy Prompt" />}
                      {ai.assistantResponse && <CopyButton text={ai.assistantResponse} label="Copy Response" />}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {messages.map((msg, i) => {
                      const colors = roleColors[msg.role] || roleColors.user;
                      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                      return (
                        <div key={i} className="flex gap-2">
                          <div className={`flex-shrink-0 w-6 h-6 rounded-full ${colors.bg} flex items-center justify-center text-xs`}>
                            {colors.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-medium ${colors.text} mb-0.5 capitalize`}>{msg.role}</div>
                            <div className={`${colors.bg} border ${colors.border} rounded-lg p-2.5 text-xs text-gray-300 whitespace-pre-wrap break-words overflow-auto max-h-60`}>
                              {content}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
