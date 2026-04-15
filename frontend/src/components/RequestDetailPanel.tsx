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
    systemPrompt: string | null;
    userMessages: string | null;
    assistantResponse: string | null;
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

        {activeTab === 'ai' && log.aiRequest && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-[#1c2333] rounded p-2">
                <div className="text-xs text-gray-500">Provider</div>
                <div className="text-sm text-gray-200 capitalize">{log.aiRequest.provider}</div>
              </div>
              <div className="bg-[#1c2333] rounded p-2">
                <div className="text-xs text-gray-500">Model</div>
                <div className="text-sm text-gray-200">{log.aiRequest.model || '-'}</div>
              </div>
              <div className="bg-[#1c2333] rounded p-2">
                <div className="text-xs text-gray-500">Tokens</div>
                <div className="text-sm text-gray-200">{log.aiRequest.totalTokens?.toLocaleString() || '-'}</div>
              </div>
              <div className="bg-[#1c2333] rounded p-2">
                <div className="text-xs text-gray-500">Cost</div>
                <div className="text-sm text-gray-200">
                  {log.aiRequest.totalCostMicros ? `$${(log.aiRequest.totalCostMicros / 1_000_000).toFixed(4)}` : '-'}
                </div>
              </div>
            </div>
            {log.aiRequest.systemPrompt && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">System Prompt</h4>
                <pre className="text-xs text-gray-300 bg-[#1c2333] rounded p-3 whitespace-pre-wrap overflow-auto max-h-40">
                  {log.aiRequest.systemPrompt}
                </pre>
              </div>
            )}
            {log.aiRequest.assistantResponse && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Response</h4>
                <pre className="text-xs text-gray-300 bg-[#1c2333] rounded p-3 whitespace-pre-wrap overflow-auto max-h-60">
                  {log.aiRequest.assistantResponse}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
