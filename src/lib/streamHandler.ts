import { Response } from 'express';
import { IncomingMessage } from 'http';
import { Transform, TransformCallback } from 'stream';

export interface StreamResult {
  chunks: string[];
  timeToFirstToken: number | null;
}

export class SSECollector extends Transform {
  private chunks: string[] = [];
  private firstChunkTime: number | null = null;
  private startTime: number;
  private buffer: string = '';

  constructor(startTime: number) {
    super();
    this.startTime = startTime;
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    // Record time to first token
    if (this.firstChunkTime === null) {
      this.firstChunkTime = Date.now() - this.startTime;
    }

    // Pass through immediately for low latency
    this.push(chunk);

    // Buffer and parse SSE data
    this.buffer += chunk.toString();
    this.parseBuffer();

    callback();
  }

  private parseBuffer(): void {
    const lines = this.buffer.split('\n');

    // Keep incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data && data !== '[DONE]') {
          this.chunks.push(data);
        }
      }
    }
  }

  _flush(callback: TransformCallback): void {
    // Process any remaining buffer
    if (this.buffer) {
      this.parseBuffer();
    }
    callback();
  }

  getResult(): StreamResult {
    return {
      chunks: this.chunks,
      timeToFirstToken: this.firstChunkTime,
    };
  }
}

export function isStreamingResponse(response: IncomingMessage): boolean {
  const contentType = response.headers['content-type'] || '';
  return (
    contentType.includes('text/event-stream') ||
    contentType.includes('application/x-ndjson') ||
    contentType.includes('text/plain') // Some providers use this for streaming
  );
}

export function setupStreamingResponse(
  proxyRes: IncomingMessage,
  res: Response,
  startTime: number
): SSECollector {
  // Set headers for SSE
  res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Copy other relevant headers
  const headersToForward = ['x-request-id', 'openai-organization', 'openai-processing-ms'];
  for (const header of headersToForward) {
    const value = proxyRes.headers[header];
    if (value) {
      res.setHeader(header, value);
    }
  }

  res.statusCode = proxyRes.statusCode || 200;

  const collector = new SSECollector(startTime);

  // Pipe through collector to response
  proxyRes.pipe(collector).pipe(res);

  return collector;
}

export function collectStreamChunks(proxyRes: IncomingMessage): Promise<{ data: string; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    let data = '';
    const chunks: string[] = [];

    proxyRes.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      data += str;

      // Parse SSE chunks
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const chunkData = line.slice(6).trim();
          if (chunkData && chunkData !== '[DONE]') {
            chunks.push(chunkData);
          }
        }
      }
    });

    proxyRes.on('end', () => resolve({ data, chunks }));
    proxyRes.on('error', reject);
  });
}
