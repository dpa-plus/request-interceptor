interface RequestData {
  method: string;
  url: string;
  headers: string;
  body: string | null;
}

// Header values can be string | string[] | number (Node's IncomingHttpHeaders shape).
type HeaderValue = string | number | string[] | undefined | null;

// Wrap a value for bash.
// Strategy: if value contains only printable ASCII safe for single-quote context, wrap in '...'.
// If value contains a single quote, close the quote, escape with \', reopen: 'it'\''s'.
// If value contains control chars (newline, tab, CR, etc.), use ANSI-C quoting $'...' where
// escapes are interpreted. This is GNU bash / zsh compatible.
function shellQuote(raw: string): string {
  if (raw === '') return "''";
  // If the string has any control char (newline, tab, CR, null, etc.) or backslash,
  // prefer $'...' ANSI-C quoting which handles everything cleanly.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(raw)) {
    const escaped = raw
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
    return `$'${escaped}'`;
  }
  // Otherwise standard single-quote wrapping with '\'' for embedded apostrophes.
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

// Normalize a header value into an array of strings so we can emit one -H per value.
function headerValueToStrings(value: HeaderValue): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [String(value)];
}

// Headers curl adds automatically or that don't make sense to replay.
// Lowercase for case-insensitive match.
const SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'accept-encoding',
  'transfer-encoding',
]);

function buildHeaderFlags(headersJson: string): string[] {
  const flags: string[] = [];
  let headers: Record<string, HeaderValue>;
  try {
    headers = JSON.parse(headersJson) as Record<string, HeaderValue>;
  } catch {
    return flags;
  }

  for (const [key, rawValue] of Object.entries(headers)) {
    // Skip HTTP/2 pseudo-headers (:method, :path, :authority, :scheme) — they're not real HTTP/1 headers.
    if (key.startsWith(':')) continue;
    if (SKIP_HEADERS.has(key.toLowerCase())) continue;

    for (const v of headerValueToStrings(rawValue)) {
      flags.push(`-H ${shellQuote(`${key}: ${v}`)}`);
    }
  }

  return flags;
}

function buildBodyFlag(body: string | null): string | null {
  if (!body) return null;
  // Try to compact JSON bodies for readability; otherwise pass through raw.
  try {
    const parsed = JSON.parse(body);
    return `-d ${shellQuote(JSON.stringify(parsed))}`;
  } catch {
    return `-d ${shellQuote(body)}`;
  }
}

export function generateCurl(request: RequestData): string {
  const parts: string[] = ['curl'];

  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`);
  }

  parts.push(shellQuote(request.url));
  parts.push(...buildHeaderFlags(request.headers));

  const bodyFlag = buildBodyFlag(request.body);
  if (bodyFlag) parts.push(bodyFlag);

  return parts.join(' \\\n  ');
}

// Generate a one-liner curl command (single line, no backslash continuations).
export function generateCurlOneLine(request: RequestData): string {
  const parts: string[] = ['curl'];

  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`);
  }

  parts.push(shellQuote(request.url));
  parts.push(...buildHeaderFlags(request.headers));

  const bodyFlag = buildBodyFlag(request.body);
  if (bodyFlag) parts.push(bodyFlag);

  return parts.join(' ');
}
