import { useState, useEffect, useMemo, useCallback } from 'react';
import { SmartBodyViewer } from './SmartBodyViewer';
import { HeadersTable } from './HeadersTable';
import { CopyButton, InlineCopyButton } from './CopyButton';
import { generateCurl } from '../utils/curlGenerator';
import { ContentPartsRenderer, ContentPart } from './ContentPartsRenderer';

// Unified message shape as stored by src/lib/aiDetector.ts (camelCase)
interface ToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | string;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  hasImages?: boolean;
  imageCount?: number;
  hasAudio?: boolean;
  audioCount?: number;
  contentParts?: ContentPart[];
}

// Try to JSON-parse a string; if it parses, return pretty-printed JSON. Else return original.
function prettyIfJson(value: string): { text: string; isJson: boolean } {
  const trimmed = value.trim();
  if (!trimmed) return { text: value, isJson: false };
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return { text: value, isJson: false };
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
  } catch {
    return { text: value, isJson: false };
  }
}

function contentPartsToText(parts: ContentPart[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === 'text') out.push(p.text);
    else if (p.type === 'reasoning') out.push(`[reasoning]\n${p.text}`);
    else if (p.type === 'image') out.push('[image]');
    else if (p.type === 'audio') out.push(p.transcript ? `[audio: ${p.transcript}]` : '[audio]');
    else if (p.type === 'video') out.push('[video]');
    else if (p.type === 'file') out.push(p.filename ? `[file: ${p.filename}]` : '[file]');
    else if (p.type === 'file_annotation') out.push(`[parsed file: ${p.name ?? p.hash.slice(0, 8)}]`);
  }
  return out.join('\n').trim();
}

// Render-ready text for a single message (used for per-message copy + display fallback)
function messageToText(msg: ConversationMessage): string {
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    const calls = msg.toolCalls.map((tc) => {
      const name = tc.function?.name || 'unknown';
      const args = tc.function?.arguments || '';
      const pretty = prettyIfJson(args).text;
      return `→ ${name}(${pretty})`;
    });
    const prefix = msg.content ? `${msg.content}\n\n` : '';
    return `${prefix}${calls.join('\n\n')}`;
  }
  if (msg.role === 'tool') {
    const header = msg.toolName ? `[tool: ${msg.toolName}]\n` : '';
    return header + (typeof msg.content === 'string' ? prettyIfJson(msg.content).text : '');
  }
  if (msg.contentParts && msg.contentParts.length > 0) {
    return contentPartsToText(msg.contentParts);
  }
  return typeof msg.content === 'string' ? msg.content : '';
}

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

const SPLIT_STORAGE_KEY = 'requestDetail.headerBodySplitPct';

export function RequestDetailPanel({ requestId }: Props) {
  const [log, setLog] = useState<RequestLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response' | 'ai'>('request');

  // Vertical split between Headers (top) and Body (bottom) pane, as percent of container.
  // Shared by Request and Response tabs, persisted in localStorage.
  const [splitPct, setSplitPct] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SPLIT_STORAGE_KEY) : null;
    const n = saved ? Number(saved) : NaN;
    return Number.isFinite(n) && n >= 15 && n <= 85 ? n : 35;
  });

  useEffect(() => {
    try { window.localStorage.setItem(SPLIT_STORAGE_KEY, String(splitPct)); } catch {}
  }, [splitPct]);

  // Drag handler for the vertical splitter. Uses getBoundingClientRect of the container
  // so the split stays accurate regardless of scroll / flex sibling sizing.
  const startVerticalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMouseMove = (moveEvent: MouseEvent) => {
      const rel = moveEvent.clientY - rect.top;
      const pct = Math.min(85, Math.max(15, (rel / rect.height) * 100));
      setSplitPct(pct);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

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
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'request' && (
          <SplitPanes
            splitPct={splitPct}
            onResizeStart={startVerticalResize}
            top={
              <section>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Request Headers</h4>
                <HeadersTable headers={log.headers} />
              </section>
            }
            bottom={
              log.body ? (
                <section>
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Request Body</h4>
                  <SmartBodyViewer content={log.body} />
                </section>
              ) : (
                <p className="text-gray-500 text-xs">No request body</p>
              )
            }
          />
        )}

        {activeTab === 'response' && (
          log.responseHeaders || log.responseBody ? (
            <SplitPanes
              splitPct={splitPct}
              onResizeStart={startVerticalResize}
              top={
                log.responseHeaders ? (
                  <section>
                    <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Response Headers</h4>
                    <HeadersTable headers={log.responseHeaders} />
                  </section>
                ) : (
                  <p className="text-gray-500 text-xs">No response headers</p>
                )
              }
              bottom={
                log.responseBody ? (
                  <section>
                    <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Response Body</h4>
                    <SmartBodyViewer content={log.responseBody} />
                  </section>
                ) : (
                  <p className="text-gray-500 text-xs">No response body</p>
                )
              }
            />
          ) : (
            <div className="p-4"><p className="text-gray-500">No response data available</p></div>
          )
        )}

        {activeTab === 'ai' && log.aiRequest && (() => {
          const ai = log.aiRequest;
          const promptPct = ai.totalTokens ? Math.round(((ai.promptTokens || 0) / ai.totalTokens) * 100) : 0;
          const completionPct = 100 - promptPct;
          const tokPerSec = ai.totalDuration && ai.completionTokens
            ? ((ai.completionTokens / ai.totalDuration) * 1000).toFixed(1)
            : null;

          // Parse conversation messages — preserve tool_calls / tool_name / content=null
          let messages: ConversationMessage[] = [];
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

          // Full conversation (user + assistant + tool + system) for the top-level copy button
          const allMessagesText = messages
            .map((m) => `[${m.role}]\n${messageToText(m)}`)
            .join('\n\n---\n\n');

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
            <div className="space-y-4 overflow-auto p-4">
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
                      {messages.length > 0 && <CopyButton text={allMessagesText} label="Copy Full Conversation" />}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {messages.map((msg, i) => {
                      const colors = roleColors[msg.role] || roleColors.user;
                      const copyText = messageToText(msg);
                      return (
                        <div key={i} className="flex gap-2 group">
                          <div className={`flex-shrink-0 w-6 h-6 rounded-full ${colors.bg} flex items-center justify-center text-xs`}>
                            {colors.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`flex items-center gap-1 text-xs font-medium ${colors.text} mb-0.5 capitalize`}>
                              <span>{msg.role}</span>
                              {msg.role === 'tool' && msg.toolName && (
                                <span className="text-gray-500 normal-case">
                                  ← <span className="text-amber-300 font-mono">{msg.toolName}</span>
                                </span>
                              )}
                              {msg.imageCount && msg.imageCount > 0 ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-900/40 text-blue-300 normal-case">
                                  {msg.imageCount} image{msg.imageCount > 1 ? 's' : ''}
                                </span>
                              ) : null}
                              {msg.audioCount && msg.audioCount > 0 ? (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-900/40 text-amber-300 normal-case">
                                  {msg.audioCount} audio
                                </span>
                              ) : null}
                              {copyText && <InlineCopyButton text={copyText} alwaysVisible />}
                            </div>
                            <MessageBubble msg={msg} colors={colors} />
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

// --- Helper components ---

interface SplitPanesProps {
  splitPct: number; // percent of the container's height allocated to the top pane
  onResizeStart: (e: React.MouseEvent) => void;
  top: React.ReactNode;
  bottom: React.ReactNode;
}

// Two stacked, independently-scrollable panes with a draggable divider between them.
function SplitPanes({ splitPct, onResizeStart, top, bottom }: SplitPanesProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className="overflow-auto p-4 min-h-0"
        style={{ flex: `0 0 ${splitPct}%` }}
      >
        {top}
      </div>
      <div
        onMouseDown={onResizeStart}
        className="h-1.5 bg-[#21262d] hover:bg-[#30363d] active:bg-[#58a6ff] cursor-row-resize flex-shrink-0 transition-colors"
        title="Drag to resize"
      />
      <div
        className="overflow-auto p-4 min-h-0 flex-1"
      >
        {bottom}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  msg: ConversationMessage;
  colors: { bg: string; border: string; text: string; icon: string };
}

// Renders a single message bubble with role-specific formatting:
// - assistant + tool_calls: shows each tool call as "→ tool_name(...pretty args...)"
// - tool: shows "← tool_name → <pretty JSON of content>"
// - multimodal (contentParts): images/audio/video/file/reasoning inline
// - others: plain content, whitespace preserved
function MessageBubble({ msg, colors }: MessageBubbleProps) {
  // Outer bubble — overflow is hidden so big children clip cleanly; inner content scrolls.
  const bubbleCls = `${colors.bg} border ${colors.border} rounded-lg p-2.5 text-xs text-gray-300 break-words overflow-auto max-h-[32rem]`;

  // Structured multimodal content takes precedence when present
  const hasParts = !!(msg.contentParts && msg.contentParts.length > 0);

  // Assistant with tool calls — render call(s) AND any multimodal parts
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    return (
      <div className={bubbleCls}>
        {hasParts ? (
          <div className="mb-2">
            <ContentPartsRenderer parts={msg.contentParts!} />
          </div>
        ) : msg.content && msg.content.trim() !== '' ? (
          <div className="mb-2 whitespace-pre-wrap">{msg.content}</div>
        ) : null}
        <div className="space-y-1.5">
          {msg.toolCalls.map((tc, idx) => {
            const name = tc.function?.name || 'unknown';
            const argsRaw = tc.function?.arguments || '';
            const pretty = prettyIfJson(argsRaw);
            return (
              <div key={tc.id || idx} className="font-mono">
                <div className="text-amber-300">
                  <span className="text-gray-500">→ calling tool </span>
                  <span className="font-bold">{name}</span>
                </div>
                {argsRaw && (
                  <pre className="mt-1 pl-3 border-l-2 border-amber-800/40 text-gray-300 whitespace-pre-wrap break-words">
                    {pretty.text}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Tool result — pretty-print JSON content, fall back to raw text
  if (msg.role === 'tool') {
    const raw = typeof msg.content === 'string' ? msg.content : '';
    const pretty = prettyIfJson(raw);
    return (
      <div className={bubbleCls}>
        {raw ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-300">
            {pretty.text}
          </pre>
        ) : (
          <span className="text-gray-500 italic">(empty result)</span>
        )}
      </div>
    );
  }

  // Default (system/user/assistant-with-text or multimodal)
  if (hasParts) {
    return (
      <div className={bubbleCls}>
        <ContentPartsRenderer parts={msg.contentParts!} />
      </div>
    );
  }
  const content = typeof msg.content === 'string' ? msg.content : '';
  return (
    <div className={`${bubbleCls} whitespace-pre-wrap`}>
      {content || <span className="text-gray-500 italic">(no content)</span>}
    </div>
  );
}
