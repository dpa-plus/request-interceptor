import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useSocket, RequestStartEvent, RequestCompleteEvent } from '../hooks/useSocket';
import { RequestDetailPanel } from '../components/RequestDetailPanel';

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
const GROUP_TIME_WINDOW_MS = 5000; // Group requests within 5 seconds

interface RequestGroup {
  id: string;
  hostname: string;
  requests: RequestLog[];
  methods: Set<string>;
  startTime: string;
  endTime: string;
  hasErrors: boolean;
  hasAi: boolean;
}

function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Tab system - open request details as tabs below the list
  const [openTabs, setOpenTabs] = useState<{ id: string; label: string }[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const tabPanelRef = useRef<HTMLDivElement>(null);

  const openRequestTab = useCallback((id: string, label: string) => {
    setOpenTabs(prev => {
      if (prev.some(t => t.id === id)) return prev;
      return [...prev, { id, label }];
    });
    setActiveTabId(id);
    // Auto-scroll to the tab panel after React re-renders
    setTimeout(() => {
      tabPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, [activeTabId]);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Read filters from URL so they persist across navigation
  const filter = (searchParams.get('filter') as 'all' | 'ai' | 'regular') || 'all';
  const methodFilter = searchParams.get('method') || '';
  const statusFilter = searchParams.get('status') || '';
  const searchQuery = searchParams.get('q') || '';
  const groupingEnabled = searchParams.get('group') === '1';

  // Helper to update URL params (preserves other params)
  const updateParam = useCallback((key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, [setSearchParams]);

  const setFilter = (val: string) => updateParam('filter', val);
  const setMethodFilter = (val: string) => updateParam('method', val);
  const setStatusFilter = (val: string) => updateParam('status', val);
  const setSearchQuery = (val: string) => updateParam('q', val);

  // Track last-viewed request for highlighting
  const [lastViewedId, setLastViewedId] = useState<string | null>(() => {
    return sessionStorage.getItem('dashboard-last-viewed');
  });

  // Restore scroll position when returning to the dashboard
  useEffect(() => {
    const savedScroll = sessionStorage.getItem('dashboard-scroll');
    if (savedScroll) {
      const timer = setTimeout(() => {
        window.scrollTo(0, parseInt(savedScroll, 10));
        sessionStorage.removeItem('dashboard-scroll');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  // Clear last-viewed highlight after a few seconds
  useEffect(() => {
    if (lastViewedId) {
      const timer = setTimeout(() => {
        setLastViewedId(null);
        sessionStorage.removeItem('dashboard-last-viewed');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [lastViewedId]);

  // Keep the return URL in sessionStorage in sync with current params
  // (so RequestDetail's back link always has the right URL)
  useEffect(() => {
    const params = searchParams.toString();
    sessionStorage.setItem('dashboard-return-url', params ? `/?${params}` : '/');
  }, [searchParams]);

  // Save scroll position and last-viewed ID when clicking a request link
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a');
      if (link && link.getAttribute('href')?.startsWith('/request/')) {
        sessionStorage.setItem('dashboard-scroll', String(window.scrollY));
        const match = link.getAttribute('href')?.match(/\/request\/(.+)/);
        if (match) sessionStorage.setItem('dashboard-last-viewed', match[1]);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

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

  // Group filtered logs by target host + time window
  const groupedLogs = useMemo((): RequestGroup[] => {
    if (!groupingEnabled || filteredLogs.length === 0) return [];

    const groups: RequestGroup[] = [];
    let currentGroup: RequestGroup | null = null;

    for (const log of filteredLogs) {
      // Extract hostname from targetUrl
      let hostname = 'unknown';
      try {
        hostname = new URL(log.targetUrl).hostname;
      } catch {
        hostname = log.targetUrl || 'unknown';
      }

      const logTime = new Date(log.createdAt).getTime();

      // Check if this log belongs to the current group
      if (
        currentGroup &&
        currentGroup.hostname === hostname &&
        Math.abs(logTime - new Date(currentGroup.endTime).getTime()) <= GROUP_TIME_WINDOW_MS
      ) {
        currentGroup.requests.push(log);
        currentGroup.methods.add(log.method);
        currentGroup.endTime = log.createdAt;
        if (log.error || (log.statusCode && log.statusCode >= 400)) currentGroup.hasErrors = true;
        if (log.isAiRequest) currentGroup.hasAi = true;
      } else {
        // Start a new group
        currentGroup = {
          id: log.id,
          hostname,
          requests: [log],
          methods: new Set([log.method]),
          startTime: log.createdAt,
          endTime: log.createdAt,
          hasErrors: !!(log.error || (log.statusCode && log.statusCode >= 400)),
          hasAi: log.isAiRequest,
        };
        groups.push(currentGroup);
      }
    }

    return groups;
  }, [filteredLogs, groupingEnabled]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

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
            <h1 className="text-2xl font-bold text-gray-100">Request Logs</h1>
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                connected
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-400'
              }`}
              title={connected ? 'Real-time updates active' : 'Not connected to server'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {groupingEnabled && groupedLogs.length > 0 ? (
              <>{groupedLogs.length} groups ({filteredLogs.length.toLocaleString()} requests)</>
            ) : filteredLogs.length === logs.length ? (
              <>{total.toLocaleString()} total requests</>
            ) : (
              <>{filteredLogs.length.toLocaleString()} of {logs.length.toLocaleString()} requests (filtered)</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchLogs()}
            className="p-2 bg-[#21262d] border border-[#30363d] rounded-md text-gray-400 hover:bg-[#30363d] hover:text-gray-200"
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
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg mb-4 p-3">
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
                className="w-full pl-9 pr-3 py-2 border border-[#30363d] rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#1f6feb] focus:border-[#1f6feb] bg-[#0d1117] text-gray-200 placeholder-gray-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-400"
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
            className="px-3 py-2 border border-[#30363d] rounded-md text-sm bg-[#0d1117] text-gray-300"
          >
            <option value="all">All Types</option>
            <option value="ai">AI Only</option>
            <option value="regular">Regular Only</option>
          </select>

          {/* Method Filter */}
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-2 border border-[#30363d] rounded-md text-sm bg-[#0d1117] text-gray-300"
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
            className="px-3 py-2 border border-[#30363d] rounded-md text-sm bg-[#0d1117] text-gray-300"
          >
            <option value="">All Status</option>
            <option value="2xx">2xx Success</option>
            <option value="3xx">3xx Redirect</option>
            <option value="4xx">4xx Client Error</option>
            <option value="5xx">5xx Server Error</option>
          </select>

          {/* Group toggle */}
          <button
            onClick={() => updateParam('group', groupingEnabled ? '' : '1')}
            className={`px-3 py-2 border rounded-md text-sm font-medium flex items-center gap-1.5 ${
              groupingEnabled
                ? 'bg-[#1f6feb33] border-[#1f6feb] text-[#58a6ff]'
                : 'border-gray-300 text-gray-400 hover:bg-[#1c2333]'
            }`}
            title="Group related requests by target host"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Group
          </button>

          {/* Clear filters */}
          {(searchQuery || filter !== 'all' || methodFilter || statusFilter) && (
            <button
              onClick={() => setSearchParams(new URLSearchParams())}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-100"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-800/50 rounded-md text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[#21262d]">
            <thead className="bg-[#161b22]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
                  Method
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
                  Path
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
                  Target
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
                  AI
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none">
                  Timestamp
                </th>
              </tr>
            </thead>
            <tbody className="bg-[#0d1117] divide-y divide-[#21262d]">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    {logs.length === 0 ? (
                      <>
                        <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <p className="text-gray-300 font-medium mb-2">No requests logged yet</p>
                        <p className="text-gray-500 text-sm mb-4 max-w-md mx-auto">
                          Send HTTP requests through the proxy to see them here.
                          Point your app or tools at port 3101, or use a target URL:
                        </p>
                        <div className="bg-[#161b22] rounded-lg p-3 max-w-lg mx-auto text-left">
                          <p className="text-xs font-medium text-gray-500 mb-2">Quick test with curl:</p>
                          <code className="text-xs text-gray-300 font-mono block whitespace-pre-wrap">
                            curl http://localhost:3101/get?__target=https://httpbin.org
                          </code>
                        </div>
                        <p className="text-xs text-gray-400 mt-3">
                          Or run: <code className="bg-gray-100 px-1 rounded">bash scripts/seed-test-data.sh</code> to generate sample data
                        </p>
                      </>
                    ) : (
                      <>
                        <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <p className="text-gray-500">No requests match your filters</p>
                        <button
                          onClick={() => setSearchParams(new URLSearchParams())}
                          className="mt-2 text-[#58a6ff] hover:text-[#79c0ff] text-sm"
                        >
                          Clear all filters
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ) : groupingEnabled && groupedLogs.length > 0 ? (
                /* ---- Grouped view ---- */
                groupedLogs.map((group) => {
                  const isExpanded = expandedGroups.has(group.id);
                  const isSingle = group.requests.length === 1;

                  // Single-request groups render as normal rows
                  if (isSingle) {
                    const log = group.requests[0];
                    return (
                      <tr
                        key={log.id}
                        className={`relative hover:bg-[#1c2333] transition-colors ${
                          log.statusCode === null ? 'animate-pulse bg-blue-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`relative z-10 px-2 py-1 text-xs font-bold rounded ${getMethodColor(log.method)}`}>
                            {log.method}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-100 max-w-xs truncate font-mono">
                          <Link
                            to={`/request/${log.id}`}
                            className="text-[#58a6ff] hover:text-[#79c0ff] hover:underline before:absolute before:inset-0 focus:outline-none"
                            title={`${log.path} (Ctrl+click for full page)`}
                            onClick={(e) => {
                              if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
                                e.preventDefault();
                                openRequestTab(log.id, `${log.method} ${log.path}`);
                              }
                            }}
                          >
                            {log.path}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{log.targetUrl || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-sm font-bold ${getStatusColor(log.statusCode)}`}>{log.statusCode || '...'}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{log.responseTime ? `${log.responseTime}ms` : '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {log.isAiRequest ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">AI</span> : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{new Date(log.createdAt).toLocaleTimeString()}</td>
                      </tr>
                    );
                  }

                  // Multi-request groups: collapsible header + child rows
                  const methods = Array.from(group.methods);
                  return (
                    <React.Fragment key={group.id}>
                      {/* Group header */}
                      <tr
                        onClick={() => toggleGroup(group.id)}
                        className="bg-[#161b22] hover:bg-gray-100 cursor-pointer border-l-4 border-blue-400"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <div className="flex gap-1">
                              {methods.map((m) => (
                                <span key={m} className={`px-1.5 py-0.5 text-xs font-bold rounded ${getMethodColor(m)}`}>{m}</span>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td colSpan={2} className="px-4 py-2.5 text-sm">
                          <span className="font-medium text-gray-300">{group.hostname}</span>
                          <span className="ml-2 text-xs text-gray-400">
                            {group.requests.length} requests
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {group.hasErrors && (
                            <span className="text-xs text-red-500 font-medium">has errors</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500">-</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {group.hasAi && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">AI</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500">
                          {new Date(group.startTime).toLocaleTimeString()}
                        </td>
                      </tr>

                      {/* Expanded child rows */}
                      {isExpanded && group.requests.map((log) => (
                        <tr
                          key={log.id}
                          className={`relative hover:bg-blue-50 transition-colors border-l-4 border-blue-200 ${
                            log.statusCode === null ? 'animate-pulse bg-blue-50' : ''
                          } ${lastViewedId === log.id ? 'bg-yellow-900/20 ring-1 ring-yellow-700/50' : ''}`}
                        >
                          <td className="pl-10 pr-4 py-2.5 whitespace-nowrap">
                            <span className={`relative z-10 px-2 py-1 text-xs font-bold rounded ${getMethodColor(log.method)}`}>
                              {log.method}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-100 max-w-xs truncate font-mono">
                            <Link to={`/request/${log.id}`} className="text-[#58a6ff] hover:text-[#79c0ff] hover:underline before:absolute before:inset-0 focus:outline-none" title={log.path}>
                              {log.path}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-500 max-w-xs truncate">{log.targetUrl || '-'}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {log.statusCode === null ? (
                              <span className="text-sm text-blue-600">Pending</span>
                            ) : (
                              <span className={`text-sm font-bold ${getStatusColor(log.statusCode)}`}>{log.statusCode}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-sm">
                            {log.responseTime ? (
                              <span className={`font-medium ${
                                log.responseTime > 2000 ? 'text-red-600' :
                                log.responseTime > 1000 ? 'text-orange-600' :
                                log.responseTime > 500 ? 'text-yellow-600' :
                                'text-green-600'
                              }`}>{log.responseTime}ms</span>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {log.isAiRequest && log.aiRequest ? (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 truncate max-w-[150px]">
                                {log.aiRequest.model || log.aiRequest.provider || 'AI'}
                              </span>
                            ) : log.isAiRequest ? (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">AI</span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-sm text-gray-500">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })
              ) : (
                /* ---- Flat view (no grouping) ---- */
                filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className={`relative hover:bg-[#1c2333] transition-colors ${
                      log.statusCode === null ? 'animate-pulse bg-blue-50' : ''
                    } ${lastViewedId === log.id ? 'bg-yellow-900/20 ring-1 ring-yellow-700/50' : ''}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`relative z-10 px-2 py-1 text-xs font-bold rounded ${getMethodColor(log.method)}`}
                      >
                        {log.method}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-100 max-w-xs truncate font-mono">
                      <Link
                        to={`/request/${log.id}`}
                        className="text-[#58a6ff] hover:text-[#79c0ff] hover:underline before:absolute before:inset-0 focus:outline-none"
                        title={`${log.path} (Ctrl+click for full page)`}
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
                            e.preventDefault();
                            openRequestTab(log.id, `${log.method} ${log.path}`);
                          }
                        }}
                      >
                        {log.path}
                      </Link>
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
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-100">Clear All Logs</h3>
                <p className="text-sm text-gray-500">
                  Are you sure you want to delete all {total.toLocaleString()} logged requests? This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 border border-[#30363d] rounded-md text-sm font-medium text-gray-300 hover:bg-[#1c2333]"
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

      {/* ===== Tab Panel - opens below the request list ===== */}
      {openTabs.length > 0 && (
        <div ref={tabPanelRef} className="mt-4 border border-[#30363d] rounded-lg overflow-hidden bg-[#0d1117]">
          {/* Tab bar */}
          <div className="flex items-center bg-[#161b22] border-b border-[#30363d] overflow-x-auto">
            {openTabs.map((tab) => (
              <div
                key={tab.id}
                className={`group flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer border-r border-[#30363d] shrink-0 max-w-[200px] ${
                  activeTabId === tab.id
                    ? 'bg-[#0d1117] text-gray-200 border-b-2 border-b-[#58a6ff]'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-[#1c2333]'
                }`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span className="truncate">{tab.label}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="ml-1 p-0.5 rounded hover:bg-[#30363d] text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {/* Close all button */}
            {openTabs.length > 1 && (
              <button
                onClick={() => { setOpenTabs([]); setActiveTabId(null); }}
                className="ml-auto px-3 py-2 text-xs text-gray-500 hover:text-gray-300 shrink-0"
              >
                Close all
              </button>
            )}
          </div>

          {/* Active tab content */}
          <div className="h-[400px]">
            {activeTabId && <RequestDetailPanel requestId={activeTabId} />}
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
