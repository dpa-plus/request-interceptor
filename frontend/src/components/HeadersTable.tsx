import { useState, useMemo } from 'react';
import { CopyButton, InlineCopyButton } from './CopyButton';

interface HeadersTableProps {
  headers: string;
  title?: string;
}

type ViewMode = 'table' | 'json';

// Headers that are particularly important to highlight
const IMPORTANT_HEADERS = [
  'content-type',
  'authorization',
  'x-api-key',
  'accept',
  'user-agent',
  'x-request-id',
  'x-correlation-id',
];

// Headers that might contain sensitive data (show partially masked)
const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];

export function HeadersTable({ headers, title = 'Headers' }: HeadersTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [showSensitive, setShowSensitive] = useState(false);
  const [filter, setFilter] = useState('');

  const parsedHeaders = useMemo(() => {
    try {
      return JSON.parse(headers) as Record<string, string>;
    } catch {
      return {};
    }
  }, [headers]);

  const headerEntries = useMemo(() => {
    const entries = Object.entries(parsedHeaders);

    // Filter if search is active
    if (filter) {
      const lower = filter.toLowerCase();
      return entries.filter(
        ([key, value]) =>
          key.toLowerCase().includes(lower) ||
          value.toLowerCase().includes(lower)
      );
    }

    // Sort: important headers first, then alphabetically
    return entries.sort(([a], [b]) => {
      const aImportant = IMPORTANT_HEADERS.includes(a.toLowerCase());
      const bImportant = IMPORTANT_HEADERS.includes(b.toLowerCase());
      if (aImportant && !bImportant) return -1;
      if (!aImportant && bImportant) return 1;
      return a.localeCompare(b);
    });
  }, [parsedHeaders, filter]);

  const formatValue = (key: string, value: string): string => {
    if (!showSensitive && SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      if (value.length > 20) {
        return value.slice(0, 10) + '••••••••' + value.slice(-4);
      }
      return '••••••••';
    }
    return value;
  };

  const isImportant = (key: string): boolean =>
    IMPORTANT_HEADERS.includes(key.toLowerCase());

  const isSensitive = (key: string): boolean =>
    SENSITIVE_HEADERS.includes(key.toLowerCase());

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <span className="text-xs text-gray-500">
            {headerEntries.length} {headerEntries.length === 1 ? 'header' : 'headers'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <input
            type="text"
            placeholder="Filter headers..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-200 rounded w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {/* View mode toggle */}
          <div className="flex rounded-md shadow-sm">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-medium rounded-l-md border ${
                viewMode === 'table'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('json')}
              className={`px-3 py-1 text-xs font-medium rounded-r-md border -ml-px ${
                viewMode === 'json'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              JSON
            </button>
          </div>
          <CopyButton text={headers} label="Copy All" size="sm" />
        </div>
      </div>

      {/* Content */}
      {viewMode === 'table' ? (
        <div className="overflow-auto max-h-80">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {headerEntries.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-gray-500 text-sm">
                    {filter ? 'No headers match your filter' : 'No headers'}
                  </td>
                </tr>
              ) : (
                headerEntries.map(([key, value]) => (
                  <tr key={key} className="group hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm align-top">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono ${
                            isImportant(key)
                              ? 'font-medium text-blue-700'
                              : 'text-gray-700'
                          }`}
                        >
                          {key}
                        </span>
                        {isSensitive(key) && (
                          <button
                            onClick={() => setShowSensitive(!showSensitive)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                            title={showSensitive ? 'Hide sensitive value' : 'Show sensitive value'}
                          >
                            {showSensitive ? '🔓' : '🔒'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-sm font-mono text-gray-600 break-all">
                      <div className="flex items-start gap-1">
                        <span className="flex-1">{formatValue(key, value)}</span>
                        <InlineCopyButton text={value} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="p-4 text-xs font-mono bg-gray-50 overflow-auto max-h-80 whitespace-pre-wrap">
          {JSON.stringify(parsedHeaders, null, 2)}
        </pre>
      )}
    </div>
  );
}

// Compact version for smaller areas
export function CompactHeaders({ headers }: { headers: string }) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(headers) as Record<string, string>;
    } catch {
      return {};
    }
  }, [headers]);

  const importantEntries = Object.entries(parsed).filter(([key]) =>
    IMPORTANT_HEADERS.includes(key.toLowerCase())
  );

  if (importantEntries.length === 0) return null;

  return (
    <div className="text-xs space-y-1">
      {importantEntries.slice(0, 3).map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="text-gray-500 font-medium">{key}:</span>
          <span className="text-gray-700 truncate max-w-xs">{value}</span>
        </div>
      ))}
      {importantEntries.length > 3 && (
        <span className="text-gray-400">+{importantEntries.length - 3} more</span>
      )}
    </div>
  );
}
