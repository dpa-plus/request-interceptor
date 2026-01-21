interface RequestData {
  method: string;
  url: string;
  headers: string;
  body: string | null;
}

export function generateCurl(request: RequestData): string {
  const parts: string[] = ['curl'];

  // Method (skip for GET as it's default)
  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`);
  }

  // URL
  parts.push(`'${request.url}'`);

  // Parse and add headers
  try {
    const headers = JSON.parse(request.headers) as Record<string, string>;

    // Skip certain headers that curl handles automatically
    const skipHeaders = ['content-length', 'host', 'connection', 'accept-encoding'];

    for (const [key, value] of Object.entries(headers)) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        // Escape single quotes in header values
        const escapedValue = value.replace(/'/g, "'\\''");
        parts.push(`-H '${key}: ${escapedValue}'`);
      }
    }
  } catch {
    // If headers aren't valid JSON, skip them
  }

  // Add body if present
  if (request.body) {
    try {
      // Try to parse and re-stringify to remove whitespace
      const parsed = JSON.parse(request.body);
      const compactBody = JSON.stringify(parsed);
      // Escape single quotes
      const escapedBody = compactBody.replace(/'/g, "'\\''");
      parts.push(`-d '${escapedBody}'`);
    } catch {
      // If not JSON, add as-is with escaped quotes
      const escapedBody = request.body.replace(/'/g, "'\\''");
      parts.push(`-d '${escapedBody}'`);
    }
  }

  // Join with backslash-newline for readability
  return parts.join(' \\\n  ');
}

// Generate a one-liner curl command
export function generateCurlOneLine(request: RequestData): string {
  const parts: string[] = ['curl'];

  if (request.method !== 'GET') {
    parts.push(`-X ${request.method}`);
  }

  parts.push(`'${request.url}'`);

  try {
    const headers = JSON.parse(request.headers) as Record<string, string>;
    const skipHeaders = ['content-length', 'host', 'connection', 'accept-encoding'];

    for (const [key, value] of Object.entries(headers)) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        const escapedValue = value.replace(/'/g, "'\\''");
        parts.push(`-H '${key}: ${escapedValue}'`);
      }
    }
  } catch {
    // Skip invalid headers
  }

  if (request.body) {
    try {
      const parsed = JSON.parse(request.body);
      const compactBody = JSON.stringify(parsed);
      const escapedBody = compactBody.replace(/'/g, "'\\''");
      parts.push(`-d '${escapedBody}'`);
    } catch {
      const escapedBody = request.body.replace(/'/g, "'\\''");
      parts.push(`-d '${escapedBody}'`);
    }
  }

  return parts.join(' ');
}
