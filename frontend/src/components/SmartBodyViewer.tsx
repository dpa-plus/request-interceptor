import { useState, useMemo } from 'react';
import { JsonView, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { CopyButton } from './CopyButton';
import {
  detectContentType,
  tryParseJson,
  getContentTypeLabel,
  getContentTypeColor,
} from '../utils/contentTypeDetector';

interface SmartBodyViewerProps {
  content: string | null;
  contentTypeHeader?: string;
  title?: string;
  maxHeight?: string;
  truncated?: boolean;
}

type ViewMode = 'formatted' | 'raw' | 'preview';

export function SmartBodyViewer({
  content,
  contentTypeHeader,
  title,
  maxHeight = 'max-h-96',
  truncated = false,
}: SmartBodyViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('formatted');
  const [expanded, setExpanded] = useState(true);

  const contentType = useMemo(
    () => detectContentType(content, contentTypeHeader),
    [content, contentTypeHeader]
  );

  const parsedJson = useMemo(() => {
    if (contentType === 'json') {
      return tryParseJson(content);
    }
    return null;
  }, [content, contentType]);

  if (!content) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        {title && <h3 className="text-sm font-medium text-gray-900 mb-2">{title}</h3>}
        <div className="text-sm text-gray-500 italic">No content</div>
      </div>
    );
  }

  const availableModes: ViewMode[] = ['formatted', 'raw'];
  if (contentType === 'html') {
    availableModes.push('preview');
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {title && <h3 className="text-sm font-medium text-gray-900">{title}</h3>}
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getContentTypeColor(contentType)}`}>
            {getContentTypeLabel(contentType)}
          </span>
          {truncated && (
            <span className="px-2 py-0.5 text-xs font-medium rounded bg-orange-100 text-orange-700">
              Truncated
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View mode tabs */}
          <div className="flex rounded-md shadow-sm">
            {availableModes.map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs font-medium first:rounded-l-md last:rounded-r-md border ${
                  viewMode === mode
                    ? 'bg-blue-50 border-blue-200 text-blue-700 z-10'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                } ${mode !== availableModes[0] ? '-ml-px' : ''}`}
              >
                {mode === 'formatted' ? 'Formatted' : mode === 'raw' ? 'Raw' : 'Preview'}
              </button>
            ))}
          </div>
          {contentType === 'json' && viewMode === 'formatted' && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="px-2 py-1 text-xs font-medium rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
            >
              {expanded ? 'Collapse All' : 'Expand All'}
            </button>
          )}
          <CopyButton text={content} label="Copy" size="sm" />
        </div>
      </div>

      {/* Content */}
      <div className={`${maxHeight} overflow-auto`}>
        {viewMode === 'formatted' && contentType === 'json' && parsedJson !== null ? (
          <div className="p-4 text-sm">
            <JsonView
              data={parsedJson as object}
              shouldExpandNode={expanded ? () => true : (level) => level < 1}
              style={{
                ...defaultStyles,
                container: 'json-view-container',
                basicChildStyle: 'ml-4',
                label: 'text-purple-700 font-medium',
                nullValue: 'text-gray-400 italic',
                undefinedValue: 'text-gray-400 italic',
                numberValue: 'text-blue-600',
                stringValue: 'text-green-700',
                booleanValue: 'text-orange-600',
                punctuation: 'text-gray-500',
                collapseIcon: 'cursor-pointer text-gray-400 hover:text-gray-600 select-none',
                expandIcon: 'cursor-pointer text-gray-400 hover:text-gray-600 select-none',
              }}
            />
          </div>
        ) : viewMode === 'preview' && contentType === 'html' ? (
          <HtmlPreview html={content} />
        ) : (
          <pre className="p-4 text-xs font-mono bg-gray-50 whitespace-pre-wrap break-all">
            {contentType === 'json' ? formatJsonString(content) : content}
          </pre>
        )}
      </div>
    </div>
  );
}

// HTML Preview component with sandboxed iframe
function HtmlPreview({ html }: { html: string }) {
  const [showSource, setShowSource] = useState(false);

  return (
    <div>
      <div className="border-b bg-gray-100 px-3 py-1.5 flex items-center justify-between">
        <span className="text-xs text-gray-500">HTML Preview (sandboxed)</span>
        <button
          onClick={() => setShowSource(!showSource)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          {showSource ? 'Hide Source' : 'Show Source'}
        </button>
      </div>
      {showSource && (
        <pre className="p-3 text-xs font-mono bg-gray-900 text-gray-100 overflow-auto max-h-48 whitespace-pre-wrap">
          {html}
        </pre>
      )}
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        className="w-full h-96 border-0 bg-white"
        title="HTML Preview"
      />
    </div>
  );
}

function formatJsonString(str: string | null): string {
  if (!str) return '';
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

// Compact JSON viewer for smaller areas
export function CompactJsonViewer({
  data,
  maxLines = 5,
}: {
  data: unknown;
  maxLines?: number;
}) {
  const formatted = useMemo(() => {
    try {
      const str = JSON.stringify(data, null, 2);
      const lines = str.split('\n');
      if (lines.length > maxLines) {
        return lines.slice(0, maxLines).join('\n') + '\n...';
      }
      return str;
    } catch {
      return String(data);
    }
  }, [data, maxLines]);

  return (
    <pre className="text-xs font-mono bg-gray-50 p-2 rounded overflow-auto">
      {formatted}
    </pre>
  );
}
