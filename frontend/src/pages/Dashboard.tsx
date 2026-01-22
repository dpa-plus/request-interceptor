import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useSocket, RequestStartEvent, RequestCompleteEvent } from '../hooks/useSocket';

interface AiRequestSummary {
  id: string;
  provider: string;
  model: string | null;
  isStreaming: boolean;
  totalTokens: number | null;
  totalCostMicros: number | null;
}

interface RequestLog {
  id: string;
  method: string;
  url: string;
  path: string;
  headers: string;
  body: string | null;
  bodyTruncated: boolean;
  statusCode: number | null;
  responseTime: number | null;
  targetUrl: string;
  routeSource: string;
  isAiRequest: boolean;
  createdAt: string;
  error: string | null;
  aiRequest: AiRequestSummary | null;
}

interface LogsResponse {
  logs: RequestLog[];
  total: number;
  limit: number;
  offset: number;
}

const LOGS_PER_PAGE = 50;

function Dashboard() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'ai' | 'regular'>('all');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Handle incoming request from Socket.IO
  const handleRequestStart = useCallback((event: RequestStartEvent) => {
    // Check if it matches current filters
    if (filter === 'ai' && !event.isAiRequest) return;
    if (filter === 'regular' && event.isAiRequest) return;
    if (methodFilter && event.method !== methodFilter) return;

    // Add to the beginning of logs
    setLogs((prev) => {
      // Check if already exists
      if (prev.some(log => log.id === event.id)) return prev;

      const newLog: RequestLog = {
        id: event.id,
        method: event.method,
        url: event.url,
        path: event.path,
        headers: '',
        body: null,
        bodyTruncated: false,
        statusCode: null, // Will be updated when complete
        responseTime: null,
        targetUrl: event.targetUrl,
        routeSource: event.routeSource,
        isAiRequest: event.isAiRequest,
        createdAt: event.createdAt,
        error: null,
        aiRequest: null,
      };

      return [newLog, ...prev.slice(0, 99)]; // Keep max 100
    });
    setTotal((prev) => prev + 1);
  }, [filter, methodFilter]);

  // Handle request completion from Socket.IO
  const handleRequestComplete = useCallback((event: RequestCompleteEvent) => {
    setLogs((prev) => prev.map((log) => {
      if (log.id !== event.id) return log;

      return {
        ...log,
        statusCode: event.statusCode,
        responseTime: event.responseTime,
        error: event.error,
        aiRequest: event.aiRequestId ? {
          id: event.aiRequestId,
          provider: '',
          model: event.model ?? null,
          isStreaming: false,
          totalTokens: event.totalTokens ?? null,
          totalCostMicros: event.totalCostMicros ?? null,
        } : log.aiRequest,
      };
    }));
  }, []);

  // Connect to Socket.IO
  const { connected } = useSocket({
    onRequestStart: handleRequestStart,
    onRequestComplete: handleRequestComplete,
  });

  const fetchLogs = useCallback(async (reset = true) => {
    try {
      if (reset) {
        setLoading(true);
      }
      const params = new URLSearchParams({ limit: String(LOGS_PER_PAGE) });
      if (filter === 'ai') params.set('isAiRequest', 'true');
      if (filter === 'regular') params.set('isAiRequest', 'false');
      if (methodFilter) params.set('method', methodFilter);

      const response = await fetch(`/api/logs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch logs');
      const data: LogsResponse = await response.json();
      setLogs(data.logs);
      setTotal(data.total);
      setHasMore(data.logs.length < data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [filter, methodFilter]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    try {
      setLoadingMore(true);
      const params = new URLSearchParams({
        limit: String(LOGS_PER_PAGE),
        offset: String(logs.length),
      });
      if (filter === 'ai') params.set('isAiRequest', 'true');
      if (filter === 'regular') params.set('isAiRequest', 'false');
      if (methodFilter) params.set('method', methodFilter);

      const response = await fetch(`/api/logs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch more logs');
      const data: LogsResponse = await response.json();

      setLogs((prev) => {
        // Avoid duplicates
        const existingIds = new Set(prev.map((l) => l.id));
        const newLogs = data.logs.filter((l) => !existingIds.has(l.id));
        return [...prev, ...newLogs];
      });
      setHasMore(logs.length + data.logs.length < data.total);
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, logs.length, filter, methodFilter]);

  useEffect(() => {
    fetchLogs();
    // Fallback polling every 30s (in case socket connection fails)
    const interval = setInterval(() => fetchLogs(false), 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Infinite scroll with Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMore, loadingMore, loading, loadMore]);

  const clearLogs = async () => {
    try {
      await fetch('/api/logs', { method: 'DELETE' });
      toast.success('All logs cleared');
      setDeleteConfirm(false);
      fetchLogs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete logs');
    }
  };

  // Filter logs client-side for search and status
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Status filter
      if (statusFilter) {
        const status = log.statusCode;
        if (!status) return false;
        if (statusFilter === '2xx' && (status < 200 || status >= 300)) return false;
        if (statusFilter === '3xx' && (status < 300 || status >= 400)) return false;
        if (statusFilter === '4xx' && (status < 400 || status >= 500)) return false;
        if (statusFilter === '5xx' && status < 500) return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          log.path.toLowerCase().includes(query) ||
          log.url.toLowerCase().includes(query) ||
          log.targetUrl?.toLowerCase().includes(query) ||
          log.aiRequest?.model?.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [logs, statusFilter, searchQuery]);

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-green-100 text-green-800',
      POST: 'bg-blue-100 text-blue-800',
      PUT: 'bg-yellow-100 text-yellow-800',
      PATCH: 'bg-orange-100 text-orange-800',
      DELETE: 'bg-red-100 text-red-800',
    };
    return colors[method] || 'bg-gray-100 text-gray-800';
  };

  const getStatusColor = (status: number | null) => {
    if (!status) return 'text-gray-500';
    if (status < 300) return 'text-green-600';
    if (status < 400) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatCost = (micros: number | null) => {
    if (!micros) return '-';
    const dollars = micros / 1_000_000;
    if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
    return `$${dollars.toFixed(2)}`;
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-gray-500">Loading requests...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Request Logs</h1>
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                connected
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-600'
              }`}
              title={connected ? 'Real-time updates active' : 'Not connected to server'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {filteredLogs.length === logs.length ? (
              <>{total.toLocaleString()} total requests</>
            ) : (
              <>{filteredLogs.length.toLocaleString()} of {logs.length.toLocaleString()} requests (filtered)</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchLogs()}
            className="p-2 bg-white border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            title="Refresh"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="px-3 py-2 bg-red-600 rounded-md text-sm font-medium text-white hover:bg-red-700 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow mb-4 p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search path, URL, model..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Type Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'ai' | 'regular')}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
          >
            <option value="all">All Types</option>
            <option value="ai">AI Only</option>
            <option value="regular">Regular Only</option>
          </select>

          {/* Method Filter */}
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
          >
            <option value="">All Methods</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
          >
            <option value="">All Status</option>
            <option value="2xx">2xx Success</option>
            <option value="3xx">3xx Redirect</option>
            <option value="4xx">4xx Client Error</option>
            <option value="5xx">5xx Server Error</option>
          </select>

          {/* Clear filters */}
          {(searchQuery || filter !== 'all' || methodFilter || statusFilter) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setFilter('all');
                setMethodFilter('');
                setStatusFilter('');
              }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Method
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Path
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Target
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  AI
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-gray-500">
                      {logs.length === 0 ? 'No requests logged yet' : 'No requests match your filters'}
                    </p>
                    {(searchQuery || statusFilter) && (
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setStatusFilter('');
                        }}
                        className="mt-2 text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => navigate(`/request/${log.id}`)}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                      log.statusCode === null ? 'animate-pulse bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-bold rounded ${getMethodColor(log.method)}`}
                      >
                        {log.method}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate font-mono">
                      {log.path}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                      {log.targetUrl || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.statusCode === null ? (
                        <span className="inline-flex items-center gap-1 text-sm text-blue-600">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Pending
                        </span>
                      ) : (
                        <span className={`text-sm font-bold ${getStatusColor(log.statusCode)}`}>
                          {log.statusCode}
                        </span>
                      )}
                      {log.error && (
                        <span className="ml-1 text-red-500" title={log.error}>
                          <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {log.responseTime ? (
                        <span className={`font-medium ${
                          log.responseTime > 2000 ? 'text-red-600' :
                          log.responseTime > 1000 ? 'text-orange-600' :
                          log.responseTime > 500 ? 'text-yellow-600' :
                          'text-green-600'
                        }`}>
                          {log.responseTime}ms
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {log.isAiRequest && log.aiRequest ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 truncate max-w-[150px]">
                            {log.aiRequest.model || log.aiRequest.provider || 'AI'}
                          </span>
                          {(log.aiRequest.totalTokens || log.aiRequest.totalCostMicros) && (
                            <span className="text-xs text-gray-500">
                              {log.aiRequest.totalTokens?.toLocaleString() || '?'} tokens
                              {log.aiRequest.totalCostMicros ? ` · ${formatCost(log.aiRequest.totalCostMicros)}` : ''}
                            </span>
                          )}
                        </div>
                      ) : log.isAiRequest ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                          AI
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Infinite scroll trigger */}
          <div ref={loadMoreRef} className="py-4 flex justify-center">
            {loadingMore && (
              <div className="flex items-center gap-2 text-gray-500">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Loading more...</span>
              </div>
            )}
            {!hasMore && logs.length > 0 && (
              <span className="text-sm text-gray-400">All {total.toLocaleString()} requests loaded</span>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">Clear All Logs</h3>
                <p className="text-sm text-gray-500">
                  Are you sure you want to delete all {total.toLocaleString()} logged requests? This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={clearLogs}
                className="px-4 py-2 bg-red-600 rounded-md text-sm font-medium text-white hover:bg-red-700"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
