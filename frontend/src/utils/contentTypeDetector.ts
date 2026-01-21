export type ContentType = 'json' | 'html' | 'xml' | 'text' | 'unknown';

export function detectContentType(
  content: string | null,
  contentTypeHeader?: string
): ContentType {
  if (!content) return 'unknown';

  // First check the Content-Type header if provided
  if (contentTypeHeader) {
    const lower = contentTypeHeader.toLowerCase();
    if (lower.includes('application/json') || lower.includes('+json')) {
      return 'json';
    }
    if (lower.includes('text/html')) {
      return 'html';
    }
    if (lower.includes('text/xml') || lower.includes('application/xml') || lower.includes('+xml')) {
      return 'xml';
    }
    if (lower.includes('text/')) {
      return 'text';
    }
  }

  // Try to detect from content
  const trimmed = content.trim();

  // JSON detection
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON, continue checking
    }
  }

  // HTML detection
  if (
    trimmed.toLowerCase().startsWith('<!doctype html') ||
    trimmed.toLowerCase().startsWith('<html') ||
    (trimmed.startsWith('<') && trimmed.includes('</') && /<\w+[^>]*>.*<\/\w+>/s.test(trimmed))
  ) {
    // Check if it looks more like HTML than XML
    if (/<(html|head|body|div|span|p|a|script|style|meta|link)\b/i.test(trimmed)) {
      return 'html';
    }
  }

  // XML detection
  if (
    trimmed.startsWith('<?xml') ||
    (trimmed.startsWith('<') && trimmed.includes('</'))
  ) {
    return 'xml';
  }

  return 'text';
}

export function tryParseJson(content: string | null): unknown | null {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function formatJson(content: string | null): string | null {
  if (!content) return null;
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function getContentTypeLabel(type: ContentType): string {
  switch (type) {
    case 'json':
      return 'JSON';
    case 'html':
      return 'HTML';
    case 'xml':
      return 'XML';
    case 'text':
      return 'Text';
    default:
      return 'Raw';
  }
}

export function getContentTypeColor(type: ContentType): string {
  switch (type) {
    case 'json':
      return 'bg-yellow-100 text-yellow-800';
    case 'html':
      return 'bg-orange-100 text-orange-800';
    case 'xml':
      return 'bg-purple-100 text-purple-800';
    case 'text':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}
