import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useSocket, RequestStartEvent, RequestCompleteEvent } from '../hooks/useSocket';
import { RequestDetailPanel } from '../components/RequestDetailPanel';
import { colorForHash, labelForHash } from '../utils/promptColor';

interface AiRequestSummary {
  id: string;
  provider: string;
  model: string | null;
  isStreaming: boolean;
  totalTokens: number | null;
  totalCostMicros: number | null;
  systemPromptHash: string | null;
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

// --- Datetime helpers for the custom range picker ---

// Convert an ISO UTC string (what the URL stores) into the LOCAL datetime-local
// input value format `YYYY-MM-DDTHH:mm`. Returns '' if input is empty/invalid.
// Without this, the old code did iso.slice(0, 16) which showed UTC time in a
// picker that expects local time — so values appeared shifted by timezone offset.
function isoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert a local datetime-local input value to an ISO UTC string.
// Returns null if input is empty/invalid (old code crashed via toISOString on Invalid Date).
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Custom range picker with local draft state so that typing a single digit
// doesn't re-render the entire Dashboard (which was interrupting the native
// picker's editing flow and, worse, unmounting the pickers if the browser
// momentarily reported an empty value).
// Strategy: we keep draft values locally, commit to the URL only on blur.
function CustomRangePicker({
  fromIso,
  toIso,
  onCommit,
  onClear,
}: {
  fromIso: string;
  toIso: string;
  onCommit: (fromIsoNew: string, toIsoNew: string) => void;
  onClear: () => void;
}) {
  const [fromDraft, setFromDraft] = useState(() => isoToLocalInput(fromIso));
  const [toDraft, setToDraft] = useState(() => isoToLocalInput(toIso));

  // Sync drafts if the parent value changes externally (e.g. user picks a preset
  // while in custom mode — shouldn't happen with current UX, but be safe).
  useEffect(() => { setFromDraft(isoToLocalInput(fromIso)); }, [fromIso]);
  useEffect(() => { setToDraft(isoToLocalInput(toIso)); }, [toIso]);

  const commit = useCallback(() => {
    const nextFrom = localInputToIso(fromDraft);
    const nextTo = localInputToIso(toDraft);
    // Only commit when BOTH values are valid — otherwise keep the draft and
    // wait for the user to finish. Don't wipe state on a partial edit.
    if (!nextFrom || !nextTo) return;
    if (nextFrom === fromIso && nextTo === toIso) return; // no change
    onCommit(nextFrom, nextTo);
  }, [fromDraft, toDraft, fromIso, toIso, onCommit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur(); // trigger onBlur → commit
    }
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded bg-[#161b22] border border-[#30363d]">
      <label className="text-gray-500 text-xs select-none">From</label>
      <input
        type="datetime-local"
        value={fromDraft}
        onChange={(e) => setFromDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="px-1.5 py-0.5 border border-[#30363d] rounded text-xs bg-[#0d1117] text-gray-300 [color-scheme:dark]"
      />
      <label className="text-gray-500 text-xs select-none">To</label>
      <input
        type="datetime-local"
        value={toDraft}
        onChange={(e) => setToDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="px-1.5 py-0.5 border border-[#30363d] rounded text-xs bg-[#0d1117] text-gray-300 [color-scheme:dark]"
      />
      <button
        onClick={onClear}
        className="ml-1 p-0.5 text-gray-500 hover:text-gray-200 hover:bg-[#30363d] rounded"
        title="Clear custom range"
        aria-label="Clear custom range"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
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
  const [paused, setPaused] = useState(false);
  // Tab system - open request details as tabs below the list
  const [openTabs, setOpenTabs] = useState<{ id: string; label: string }[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [panelVisible, setPanelVisible] = useState(true);

  const openRequestTab = useCallback((id: string, label: string) => {
    setOpenTabs(prev => {
      if (prev.some(t => t.id === id)) return prev;
      return [...prev, { id, label }];
    });
    setActiveTabId(id);
    setPanelVisible(true);
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
  const timeRange = searchParams.get('time') || '';
  const sortBy = searchParams.get('sort') || '';
  const sortDir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  const promptHashFilter = searchParams.get('promptHash') || '';

  // Pinned requests (persisted in localStorage)
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('pinned-requests');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const togglePin = useCallback((id: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('pinned-requests', JSON.stringify([...next]));
      return next;
    });
  }, []);

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
          systemPromptHash: null,
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

      // Pass ALL filters to backend so SQL does the filtering
      if (filter === 'ai') params.set('isAiRequest', 'true');
      if (filter === 'regular') params.set('isAiRequest', 'false');
      if (methodFilter) params.set('method', methodFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (searchQuery) params.set('search', searchQuery);
      if (promptHashFilter) params.set('systemPromptHash', promptHashFilter);

      // Time range → from/to params for backend
      if (timeRange) {
        const now = new Date();
        const dayMs = 24 * 60 * 60 * 1000;
        if (timeRange === 'today') {
          const startOfDay = new Date(now);
          startOfDay.setHours(0, 0, 0, 0);
          params.set('from', startOfDay.toISOString());
        } else if (timeRange === 'yesterday') {
          const start = new Date(now);
          start.setDate(start.getDate() - 1);
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setHours(23, 59, 59, 999);
          params.set('from', start.toISOString());
          params.set('to', end.toISOString());
        } else if (timeRange === '5m') {
          params.set('from', new Date(now.getTime() - 5 * 60 * 1000).toISOString());
        } else if (timeRange === '15m') {
          params.set('from', new Date(now.getTime() - 15 * 60 * 1000).toISOString());
        } else if (timeRange === '1h') {
          params.set('from', new Date(now.getTime() - 60 * 60 * 1000).toISOString());
        } else if (timeRange === '7d') {
          params.set('from', new Date(now.getTime() - 7 * dayMs).toISOString());
        } else if (timeRange === '30d') {
          params.set('from', new Date(now.getTime() - 30 * dayMs).toISOString());
        } else if (timeRange.includes(',')) {
          // Custom range: "from,to" format. Auto-swap if user entered them in the wrong order.
          let [fromStr, toStr] = timeRange.split(',');
          if (fromStr && toStr && new Date(fromStr) > new Date(toStr)) {
            [fromStr, toStr] = [toStr, fromStr];
          }
          if (fromStr) params.set('from', fromStr);
          if (toStr) params.set('to', toStr);
        }
      }

      // Fetch filtered logs + pinned logs in parallel
      const pinnedArray = [...pinnedIds];
      const fetches: Promise<Response>[] = [fetch(`/api/logs?${params}`)];

      // Fetch each pinned request individually (so they survive filters)
      const pinnedFetches = pinnedArray.map(id =>
        fetch(`/api/logs/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)
      );

      const [response, ...pinnedResults] = await Promise.all([fetches[0], ...pinnedFetches]);
      if (!response.ok) throw new Error('Failed to fetch logs');
      const data: LogsResponse = await response.json();

      // Merge pinned requests that aren't already in the results
      const resultIds = new Set(data.logs.map(l => l.id));
      const pinnedLogs = pinnedResults
        .filter((p): p is RequestLog => p !== null && !resultIds.has(p.id))
        .map(p => ({ ...p, _pinned: true }));

      setLogs([...pinnedLogs, ...data.logs]);
      setTotal(data.total + pinnedLogs.length);
      setHasMore(data.logs.length < data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [filter, methodFilter, statusFilter, searchQuery, timeRange, pinnedIds, promptHashFilter]);

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

  // Sort and pin-prioritize logs (filtering is now server-side)
  const filteredLogs = useMemo(() => {
    let result = [...logs];

    // Sort (if a sort column is selected)
    if (sortBy) {
      result.sort((a, b) => {
        let cmp = 0;
        switch (sortBy) {
          case 'status':
            cmp = (a.statusCode || 0) - (b.statusCode || 0);
            break;
          case 'time':
            cmp = (a.responseTime || 0) - (b.responseTime || 0);
            break;
          case 'method':
            cmp = a.method.localeCompare(b.method);
            break;
          case 'path':
            cmp = a.path.localeCompare(b.path);
            break;
          case 'timestamp':
            cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            break;
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    // Pinned requests float to the top (always visible regardless of filters)
    if (pinnedIds.size > 0) {
      result.sort((a, b) => {
        const aPinned = pinnedIds.has(a.id) ? 1 : 0;
        const bPinned = pinnedIds.has(b.id) ? 1 : 0;
        return bPinned - aPinned;
      });
    }

    return result;
  }, [logs, sortBy, sortDir, pinnedIds]);

  // Assign group colors to consecutive logs that share the same host within a time window.
  // This creates subtle colored left-border stripes in the flat list - no collapsible rows.
  // Actual hex colors for group stripes (Tailwind JIT can't resolve dynamic class names)
  const GROUP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#06b6d4'];

  const logGroupColors = useMemo((): Map<string, string> => {
    if (!groupingEnabled || filteredLogs.length === 0) return new Map();

    const colors = new Map<string, string>();

    // Group by AI model name (much more useful than hostname for AI traffic)
    const modelGroups = new Map<string, string[]>();
    for (const log of filteredLogs) {
      const model = log.aiRequest?.model || '';
      if (!model) continue;
      // Strip provider prefix (e.g. "openai/gpt-4o" → "gpt-4o")
      const shortModel = model.replace(/^.*\//, '');
      if (!modelGroups.has(shortModel)) modelGroups.set(shortModel, []);
      modelGroups.get(shortModel)!.push(log.id);
    }

    // Assign colors to models with 2+ requests
    let ci = 0;
    for (const [, ids] of modelGroups) {
      if (ids.length < 2) continue;
      const color = GROUP_COLORS[ci % GROUP_COLORS.length];
      for (const id of ids) colors.set(id, color);
      ci++;
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



  // Left-right split resize
  const [sidebarWidth, setSidebarWidth] = useState(560);
  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.min(Math.max(startWidth + (moveEvent.clientX - startX), 420), window.innerWidth - 400);
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

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

  const showRightPane = openTabs.length > 0 && panelVisible;

  return (
    <div className="relative flex h-[calc(100vh-44px)] overflow-hidden">
      {/* ====== LEFT: Sidebar (Request List) ====== */}
      <div
        style={{ width: showRightPane ? sidebarWidth : undefined }}
        className={`${showRightPane ? 'flex-shrink-0' : 'flex-1'} flex flex-col border-r border-[#30363d] bg-[#0d1117]`}
      >
        {/* Toolbar: status + actions */}
        <div className="flex items-center justify-between px-2 py-1 border-b border-[#21262d]">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
            connected ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
            {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPaused(!paused)} className={`p-1 rounded ${paused ? 'text-yellow-400 bg-yellow-900/30' : 'text-gray-500 hover:text-gray-300'}`} title={paused ? 'Resume' : 'Pause'}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {paused ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />}
              </svg>
            </button>
            <button onClick={() => fetchLogs()} className="p-1 text-gray-500 hover:text-gray-300" title="Refresh">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
            <button onClick={() => setDeleteConfirm(true)} className="p-1 text-gray-500 hover:text-red-400" title="Clear all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>

        {/* Search + filter dropdowns */}
        <div className="px-2 py-1.5 border-b border-[#21262d] space-y-1.5">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search path, URL, model..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 border border-[#30363d] rounded text-xs bg-[#0d1117] text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#1f6feb]"
            />
          </div>
          <div className="flex flex-wrap gap-1 items-center">
            {/* Time Range */}
            <select
              value={timeRange.includes(',') ? 'custom' : timeRange}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  // Default custom range: last 24 hours (as ISO UTC; picker converts to local)
                  const now = new Date();
                  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                  updateParam('time', `${yesterday.toISOString()},${now.toISOString()}`);
                } else {
                  updateParam('time', e.target.value);
                }
              }}
              className="flex-1 min-w-0 pl-2 pr-7 py-1.5 border border-[#30363d] rounded text-xs bg-[#0d1117] text-gray-300 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
            >
              <option value="">All Time</option>
              <option value="5m">Last 5 min</option>
              <option value="15m">Last 15 min</option>
              <option value="1h">Last hour</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range...</option>
            </select>
            {timeRange.includes(',') && (() => {
              const [fromIso, toIso] = timeRange.split(',');
              return (
                <CustomRangePicker
                  fromIso={fromIso || ''}
                  toIso={toIso || ''}
                  onCommit={(f, t) => updateParam('time', `${f},${t}`)}
                  onClear={() => updateParam('time', '')}
                />
              );
            })()}

            {/* Type Filter */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | 'ai' | 'regular')}
              className="flex-1 min-w-0 pl-2 pr-7 py-1.5 border border-[#30363d] rounded text-xs bg-[#0d1117] text-gray-300 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
            >
              <option value="all">All Types</option>
              <option value="ai">AI Only</option>
              <option value="regular">Regular Only</option>
            </select>

            {/* Method Filter */}
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="flex-1 min-w-0 pl-2 pr-7 py-1.5 border border-[#30363d] rounded text-xs bg-[#0d1117] text-gray-300 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
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
              className="flex-1 min-w-0 pl-2 pr-7 py-1.5 border border-[#30363d] rounded text-xs bg-[#0d1117] text-gray-300 appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center]"
            >
              <option value="">All Status</option>
              <option value="2xx">2xx Success</option>
              <option value="3xx">3xx Redirect</option>
              <option value="4xx">4xx Client Error</option>
              <option value="5xx">5xx Server Error</option>
            </select>

            {/* Errors toggle */}
            <button
              onClick={() => setStatusFilter(statusFilter === 'errors' ? '' : 'errors')}
              className={`px-2 py-1.5 border rounded text-xs font-medium ${
                statusFilter === 'errors'
                  ? 'bg-red-900/30 border-red-700 text-red-400'
                  : 'border-[#30363d] text-gray-400 hover:bg-[#1c2333]'
              }`}
            >
              Errors
            </button>
            {/* Active prompt-hash filter pill */}
            {promptHashFilter && (() => {
              const c = colorForHash(promptHashFilter);
              const l = labelForHash(promptHashFilter);
              if (!c || !l) return null;
              return (
                <button
                  onClick={() => updateParam('promptHash', '')}
                  title={`Clear prompt filter (${promptHashFilter})`}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${c.chipBg} ${c.chipText} ${c.border}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                  <span className="font-mono">{l}</span>
                  <span className="text-gray-500">×</span>
                </button>
              );
            })()}
            {/* Clear */}
            {(searchQuery || filter !== 'all' || methodFilter || statusFilter || timeRange || promptHashFilter) && (
              <button
                onClick={() => setSearchParams(new URLSearchParams())}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-3 mt-2 p-3 bg-red-900/20 border border-red-800/50 rounded-md text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Column headers (only in full-width mode) */}
        {!showRightPane && (
          <div className="grid border-b border-[#30363d] text-[13px] font-bold text-gray-300 uppercase tracking-wider select-none bg-[#161b22] px-3 py-2.5"
            style={{ gridTemplateColumns: '24px 64px 60px 1fr 80px 56px 80px', gap: '0 16px' }}>
            <span />
            <span>Method</span>
            <span>Status</span>
            <span>Path</span>
            <span className="text-right">Time</span>
            <span className="text-right">AI</span>
            <span className="text-right">When</span>
          </div>
        )}

        {/* Request list */}
        <div className="flex-1 overflow-auto">
          <div className="divide-y divide-[#21262d]">
            {filteredLogs.length === 0 && !loading && (
              <div className="p-6 text-center text-gray-500 text-sm">
                {logs.length === 0 ? 'No requests logged yet' : 'No requests match your filters'}
              </div>
            )}
            {filteredLogs.map((log) => {
              const groupColor = logGroupColors.get(log.id);
              const isActive = activeTabId === log.id;
              const ts = new Date(log.createdAt);
              const isToday = ts.toDateString() === new Date().toDateString();
              const timeStr = isToday ? ts.toLocaleTimeString() : `${ts.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${ts.toLocaleTimeString()}`;
              const rowStyle: React.CSSProperties = {
                gridTemplateColumns: '24px 64px 60px 1fr 80px 56px 80px',
                columnGap: '16px',
                ...(groupColor && !isActive ? { borderLeftColor: groupColor } : {}),
              };
              return (
                <div
                  key={log.id}
                  className={`group grid items-center px-3 py-2 cursor-pointer transition-colors text-[14px] ${
                    isActive ? 'bg-[#1f6feb15] border-l-2 border-l-[#58a6ff]' : 'hover:bg-[#1c2333] border-l-2 border-l-transparent'
                  } ${pinnedIds.has(log.id) ? 'bg-[#1c2333]/30' : ''}`}
                  style={rowStyle}
                  onClick={() => openRequestTab(log.id, `${log.method} ${log.path}`)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePin(log.id); }}
                    className={`text-center ${pinnedIds.has(log.id) ? 'text-yellow-400' : 'text-gray-700 opacity-0 group-hover:opacity-100'}`}
                  >★</button>
                  <span className={`px-2 py-0.5 text-[12px] font-bold rounded text-center ${getMethodColor(log.method)}`}>
                    {log.method}
                  </span>
                  <span className={`font-bold text-[13px] ${getStatusColor(log.statusCode)}`}>
                    {log.statusCode || '...'}
                  </span>
                  <span className="text-gray-200 font-mono truncate min-w-0">{log.path}</span>
                  <span className={`text-right text-[13px] ${
                    (log.responseTime || 0) > 1000 ? 'text-orange-400' : 'text-gray-400'
                  }`}>
                    {log.responseTime ? `${log.responseTime}ms` : ''}
                  </span>
                  <span className="text-right flex items-center justify-end gap-1.5">
                    <PromptChip
                      hash={log.aiRequest?.systemPromptHash ?? null}
                      active={promptHashFilter === log.aiRequest?.systemPromptHash}
                      onToggle={(h) => updateParam('promptHash', promptHashFilter === h ? '' : h)}
                    />
                    {log.isAiRequest && log.aiRequest ? (
                      <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 text-[11px] truncate">
                        {(log.aiRequest.model || 'AI').replace(/^.*\//, '').slice(0, 8)}
                      </span>
                    ) : log.isAiRequest ? (
                      <span className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 text-[11px]">AI</span>
                    ) : null}
                  </span>
                  <span className="text-gray-500 text-[12px] text-right">{timeStr.split(' ').pop()}</span>
                </div>
              );
            })}
            <div ref={loadMoreRef} className="py-3 flex justify-center">
              {loadingMore && <span className="text-xs text-gray-500">Loading more...</span>}
              {!hasMore && logs.length > 0 && (
                <span className="text-[10px] text-gray-600">{total.toLocaleString()} requests</span>
              )}
            </div>
          </div>
        </div>

        {/* Reopen panel button - shown when tabs exist but panel is hidden */}
        {openTabs.length > 0 && !panelVisible && (
          <div className="flex-shrink-0 border-t border-[#21262d] px-3 py-2">
            <button
              onClick={() => setPanelVisible(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1f6feb] hover:bg-[#1a5fd4] rounded-md transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Show {openTabs.length} open {openTabs.length === 1 ? 'tab' : 'tabs'}
            </button>
          </div>
        )}
      </div>
      {/* end sidebar */}

      {showRightPane && (
        <>
          {/* Resize handle */}
          <div
            onMouseDown={startSidebarResize}
            className="w-1 cursor-col-resize bg-[#30363d] hover:bg-[#58a6ff] transition-colors flex-shrink-0"
          />
          <div className="flex-1 flex flex-col bg-[#0d1117] min-w-0">
            {/* Tab bar */}
            <div className="flex items-center bg-[#161b22] border-b border-[#21262d] overflow-x-auto flex-shrink-0">
              {openTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`group flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer border-r border-[#21262d] shrink-0 max-w-[220px] ${
                    activeTabId === tab.id
                      ? 'bg-[#0d1117] text-gray-200 border-b-2 border-b-[#58a6ff]'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-[#1c2333]'
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <span className="truncate">{tab.label}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    className="ml-1 p-0.5 rounded hover:bg-[#30363d] text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <div className="ml-auto flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setPanelVisible(false)}
                  className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300"
                  title="Hide panel (keep tabs)"
                >
                  Hide
                </button>
                <button
                  onClick={() => { setOpenTabs([]); setActiveTabId(null); }}
                  className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300"
                >
                  Close all
                </button>
              </div>
            </div>
            {/* Detail content */}
            <div className="flex-1 overflow-hidden">
              {activeTabId && <RequestDetailPanel requestId={activeTabId} />}
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-100">Clear All Logs</h3>
                <p className="text-sm text-gray-500">Delete all {total.toLocaleString()} requests? This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(false)} className="px-4 py-2 border border-[#30363d] rounded-md text-sm text-gray-300 hover:bg-[#1c2333]">Cancel</button>
              <button onClick={clearLogs} className="px-4 py-2 bg-red-600 rounded-md text-sm text-white hover:bg-red-700">Delete All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Color-coded chip identifying which system prompt a request belongs to.
 * Click toggles the prompt-hash filter on the dashboard URL.
 */
function PromptChip({
  hash,
  active,
  onToggle,
}: {
  hash: string | null;
  active: boolean;
  onToggle: (hash: string) => void;
}) {
  const color = colorForHash(hash);
  const label = labelForHash(hash);
  if (!color || !label || !hash) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(hash); }}
      title={active ? 'Clear prompt filter' : `Show only this prompt (${hash})`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono leading-none border transition-colors hover:brightness-125 ${
        color.chipBg
      } ${color.chipText} ${active ? color.border : 'border-transparent'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
      <span>{label}</span>
    </button>
  );
}

export default Dashboard;
/* END OF FILE - old table code removed */
