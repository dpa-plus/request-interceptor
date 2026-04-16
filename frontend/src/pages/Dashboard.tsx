import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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


function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [paused, setPaused] = useState(false);
  // Tab system - open request details as tabs below the list
  const [openTabs, setOpenTabs] = useState<{ id: string; label: string }[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const tabPanelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(350);
  const [panelVisible, setPanelVisible] = useState(true);
  const isDragging = useRef(false);

  // Drag-to-resize the bottom panel
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startY = e.clientY;
    const startHeight = panelHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.min(Math.max(startHeight + delta, 150), window.innerHeight - 100);
      setPanelHeight(newHeight);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelHeight]);

  const openRequestTab = useCallback((id: string, label: string) => {
    setOpenTabs(prev => {
      if (prev.some(t => t.id === id)) return prev;
      return [...prev, { id, label }];
    });
    setActiveTabId(id);
    setPanelVisible(true); // Always show panel when opening a tab
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
    if (paused) return; // Don't add new requests while paused
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
  }, [filter, methodFilter, paused]);

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
        if (statusFilter === 'errors' && status < 400) return false;
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

  // Assign group colors to consecutive logs that share the same host within a time window.
  // This creates subtle colored left-border stripes in the flat list - no collapsible rows.
  // Actual hex colors for group stripes (Tailwind JIT can't resolve dynamic class names)
  const GROUP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#06b6d4'];

  const logGroupColors = useMemo((): Map<string, string> => {
    if (!groupingEnabled || filteredLogs.length === 0) return new Map();

    const colors = new Map<string, string>();
    let currentHost = '';
    let currentEnd = 0;
    let groupSize = 0;

    // First pass: assign group IDs
    const groupIds: number[] = [];
    let groupId = 0;
    for (const log of filteredLogs) {
      let hostname = '';
      try { hostname = new URL(log.targetUrl).hostname; } catch { hostname = log.targetUrl || ''; }
      const logTime = new Date(log.createdAt).getTime();

      if (hostname === currentHost && Math.abs(logTime - currentEnd) <= GROUP_TIME_WINDOW_MS) {
        groupSize++;
      } else {
        if (groupSize > 1) groupId++; // only increment for multi-request groups
        else if (groupSize === 1) groupId++;
        currentHost = hostname;
        groupSize = 1;
      }
      currentEnd = logTime;
      groupIds.push(groupId);
    }

    // Second pass: assign colors (only to groups with 2+ requests)
    const groupCounts = new Map<number, number>();
    for (const gid of groupIds) {
      groupCounts.set(gid, (groupCounts.get(gid) || 0) + 1);
    }

    const groupColorMap = new Map<number, string>();
    let ci = 0;
    for (let i = 0; i < filteredLogs.length; i++) {
      const gid = groupIds[i];
      if ((groupCounts.get(gid) || 0) >= 2) {
        if (!groupColorMap.has(gid)) {
          groupColorMap.set(gid, GROUP_COLORS[ci % GROUP_COLORS.length]);
          ci++;
        }
        colors.set(filteredLogs[i].id, groupColorMap.get(gid)!);
      }
    }

    return colors;
  }, [filteredLogs, groupingEnabled]);

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
            {groupingEnabled && logGroupColors.size > 0 ? (
              <>{filteredLogs.length.toLocaleString()} requests &middot; grouped by host</>
            ) : filteredLogs.length === logs.length ? (
              <>{total.toLocaleString()} total requests</>
            ) : (
              <>{filteredLogs.length.toLocaleString()} of {logs.length.toLocaleString()} requests (filtered)</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Pause/Resume live updates */}
          <button
            onClick={() => setPaused(!paused)}
            className={`p-2 border rounded-md ${
              paused
                ? 'bg-yellow-900/30 border-yellow-700 text-yellow-400'
                : 'bg-[#21262d] border-[#30363d] text-gray-400 hover:bg-[#30363d] hover:text-gray-200'
            }`}
            title={paused ? 'Resume live updates' : 'Pause live updates'}
          >
            {paused ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
              </svg>
            )}
          </button>
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

          {/* Errors only toggle */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'errors' ? '' : 'errors')}
            className={`px-3 py-2 border rounded-md text-sm font-medium ${
              statusFilter === 'errors'
                ? 'bg-red-900/30 border-red-700 text-red-400'
                : 'border-[#30363d] text-gray-400 hover:bg-[#1c2333]'
            }`}
            title="Show only 4xx and 5xx errors"
          >
            Errors
          </button>

          {/* Group toggle */}
          <button
            onClick={() => updateParam('group', groupingEnabled ? '' : '1')}
            className={`px-3 py-2 border rounded-md text-sm font-medium flex items-center gap-1.5 ${
              groupingEnabled
                ? 'bg-[#1f6feb33] border-[#1f6feb] text-[#58a6ff]'
                : 'border-[#30363d] text-gray-400 hover:bg-[#1c2333]'
            }`}
            title="Group related requests by target host"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            {groupingEnabled ? 'Grouped by host' : 'Group by host'}
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
              ) : (
                filteredLogs.map((log) => {
                  const groupColor = logGroupColors.get(log.id);
                  return (
                    <tr
                      key={log.id}
                      className={`relative hover:bg-[#1c2333] transition-colors ${
                        log.statusCode === null ? 'animate-pulse bg-[#1c2333]' : ''
                      } ${lastViewedId === log.id ? 'bg-yellow-900/20 ring-1 ring-yellow-700/50' : ''} ${activeTabId === log.id ? 'bg-[#1c2333]' : ''}`}
                      style={groupColor ? { borderLeft: `3px solid ${groupColor}` } : undefined}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`relative z-10 px-2 py-1 text-xs font-bold rounded ${getMethodColor(log.method)}`}
                        >
                          {log.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-200 max-w-xs truncate font-mono">
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
                          <span className="text-sm text-gray-500">...</span>
                        ) : (
                          <span className={`text-sm font-bold ${getStatusColor(log.statusCode)}`}>
                            {log.statusCode}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {log.responseTime ? (
                          <span className={`font-medium ${
                            log.responseTime > 2000 ? 'text-red-400' :
                            log.responseTime > 1000 ? 'text-orange-400' :
                            log.responseTime > 500 ? 'text-yellow-400' :
                            'text-green-400'
                          }`}>
                            {log.responseTime}ms
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.isAiRequest && log.aiRequest ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-900/40 text-purple-300">
                            {log.aiRequest.model || log.aiRequest.provider || 'AI'}
                          </span>
                        ) : log.isAiRequest ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-900/40 text-purple-300">
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
                  );
                })
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

      {/* Spacer so content doesn't hide behind the fixed panel */}
      {openTabs.length > 0 && panelVisible && <div style={{ height: panelHeight + 10 }} />}

      {/* Reopen panel button (shown when panel is hidden but tabs exist) */}
      {openTabs.length > 0 && !panelVisible && (
        <button
          onClick={() => setPanelVisible(true)}
          className="fixed bottom-4 right-4 z-40 px-4 py-2 bg-[#1f6feb] text-white text-sm font-medium rounded-lg shadow-lg hover:bg-[#1a5fd4] flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
          Show panel ({openTabs.length} {openTabs.length === 1 ? 'tab' : 'tabs'})
        </button>
      )}

      {/* ===== Fixed Bottom Panel (like DevTools) ===== */}
      {openTabs.length > 0 && panelVisible && (
        <div ref={tabPanelRef} className="fixed bottom-0 left-0 right-0 z-40 bg-[#0d1117] shadow-[0_-4px_20px_rgba(0,0,0,0.4)]" style={{ height: panelHeight }}>
          {/* Drag handle */}
          <div
            onMouseDown={startResize}
            className="h-1.5 cursor-row-resize bg-[#30363d] hover:bg-[#58a6ff] transition-colors group flex items-center justify-center"
          >
            <div className="w-10 h-0.5 rounded bg-gray-600 group-hover:bg-white" />
          </div>
          {/* Tab bar */}
          <div className="flex items-center bg-[#161b22] border-b border-[#21262d] overflow-x-auto">
            {openTabs.map((tab) => (
              <div
                key={tab.id}
                className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer border-r border-[#21262d] shrink-0 max-w-[200px] ${
                  activeTabId === tab.id
                    ? 'bg-[#0d1117] text-gray-200'
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
                  className="ml-1 p-0.5 rounded hover:bg-[#30363d] text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              onClick={() => setPanelVisible(false)}
              className="ml-auto px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 shrink-0"
              title="Hide panel (tabs are kept)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Active tab content - fills remaining height */}
          <div className="flex-1 overflow-hidden" style={{ height: 'calc(100% - 40px)' }}>
            {activeTabId && <RequestDetailPanel requestId={activeTabId} />}
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
