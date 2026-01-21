const DEFAULT_MAX_BODY_SIZE = 1048576; // 1MB

export interface BodyInfo {
  body: string | null;
  truncated: boolean;
  size: number;
}

export function processBody(
  rawBody: Buffer | string | object | null | undefined,
  maxSize: number = DEFAULT_MAX_BODY_SIZE
): BodyInfo {
  if (!rawBody) {
    return { body: null, truncated: false, size: 0 };
  }

  // Handle different body types
  let bodyBuffer: Buffer;
  if (Buffer.isBuffer(rawBody)) {
    bodyBuffer = rawBody;
  } else if (typeof rawBody === 'string') {
    bodyBuffer = Buffer.from(rawBody);
  } else if (typeof rawBody === 'object') {
    // Body might be a parsed object (e.g., from express.json())
    const jsonString = JSON.stringify(rawBody);
    bodyBuffer = Buffer.from(jsonString);
  } else {
    return { body: null, truncated: false, size: 0 };
  }
  const size = bodyBuffer.length;

  if (size > maxSize) {
    return {
      body: `[Body truncated: ${formatBytes(size)} exceeds limit of ${formatBytes(maxSize)}]`,
      truncated: true,
      size,
    };
  }

  // Try to convert to string
  const bodyString = bodyBuffer.toString('utf-8');

  return {
    body: bodyString,
    truncated: false,
    size,
  };
}

export function shouldLogBody(contentType: string | undefined, size: number, maxSize: number): boolean {
  if (size > maxSize) {
    return false;
  }

  // Skip binary content types
  if (contentType) {
    const binaryTypes = [
      'image/',
      'video/',
      'audio/',
      'application/octet-stream',
      'application/pdf',
      'application/zip',
      'application/gzip',
      'application/x-tar',
    ];

    for (const type of binaryTypes) {
      if (contentType.includes(type)) {
        return false;
      }
    }
  }

  return true;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function safeJsonStringify(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

export function safeJsonParse<T = any>(str: string | null | undefined): T | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}
