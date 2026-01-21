import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import zlib from 'zlib';

const gunzipAsync = zlib.gunzip.__promisify__ ? zlib.gunzip.__promisify__ :
  (buf: Buffer) => new Promise<Buffer>((resolve, reject) => {
    zlib.gunzip(buf, (err, result) => err ? reject(err) : resolve(result));
  });

const brotliDecompressAsync = zlib.brotliDecompress.__promisify__ ? zlib.brotliDecompress.__promisify__ :
  (buf: Buffer) => new Promise<Buffer>((resolve, reject) => {
    zlib.brotliDecompress(buf, (err, result) => err ? reject(err) : resolve(result));
  });

const inflateAsync = zlib.inflate.__promisify__ ? zlib.inflate.__promisify__ :
  (buf: Buffer) => new Promise<Buffer>((resolve, reject) => {
    zlib.inflate(buf, (err, result) => err ? reject(err) : resolve(result));
  });

/**
 * Decompress response buffer based on Content-Encoding header.
 * Returns the original buffer if not compressed or decompression fails.
 */
async function decompressBuffer(buffer: Buffer, contentEncoding: string | undefined): Promise<Buffer> {
  if (!contentEncoding || contentEncoding === 'identity') {
    return buffer;
  }

  try {
    const encoding = contentEncoding.toLowerCase();
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      return await gunzipAsync(buffer);
    } else if (encoding === 'br') {
      return await brotliDecompressAsync(buffer);
    } else if (encoding === 'deflate') {
      return await inflateAsync(buffer);
    }
  } catch (err) {
    // Decompression failed, return original buffer
    console.error('Decompression failed:', err);
  }

  return buffer;
}
import { prisma } from './lib/prisma.js';
import { resolveTarget, extractTargetFromQuery, buildTargetUrl } from './lib/routing.js';
import { processBody, safeJsonStringify, safeJsonParse } from './lib/bodyHandler.js';
import {
  isAiEndpoint,
  parseAiRequest,
  parseAiResponse,
  parseStreamedResponse,
  calculateCost,
  isOpenRouter,
  extractOpenRouterGenerationId,
  extractOpenRouterGenerationIdFromChunks,
} from './lib/aiDetector.js';
import { SSECollector, isStreamingResponse } from './lib/streamHandler.js';
import { scheduleOpenRouterEnrichment } from './lib/openRouterEnricher.js';
import { emitRequestStart, emitRequestComplete } from './lib/socketServer.js';

export function createProxyApp() {
  const app = express();

  // Collect raw body
  app.use(express.raw({ type: '*/*', limit: '50mb' }));

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    try {
      // Get config
      const config = await prisma.config.findUnique({ where: { id: 'default' } });
      const maxBodySize = config?.maxBodySize ?? 1048576;
      const logEnabled = config?.logEnabled ?? true;
      const aiDetectionEnabled = config?.aiDetectionEnabled ?? true;

      // Resolve target
      const targetResult = await resolveTarget(req);

      if ('error' in targetResult) {
        // Log failed request
        if (logEnabled) {
          const { body, truncated, size } = processBody(req.body, maxBodySize);
          await prisma.requestLog.create({
            data: {
              method: req.method,
              url: req.originalUrl,
              path: req.path,
              queryParams: safeJsonStringify(req.query),
              headers: safeJsonStringify(req.headers),
              body,
              bodyTruncated: truncated,
              bodySize: size,
              targetUrl: '',
              routeSource: 'default',
              statusCode: 400,
              responseTime: Date.now() - startTime,
              error: targetResult.message,
            },
          });
        }

        res.status(400).json({
          error: targetResult.code,
          message: targetResult.message,
        });
        return;
      }

      const { targetUrl, source, ruleId } = targetResult;
      const { cleanQuery } = extractTargetFromQuery(req);

      // Build full target URL
      const fullTargetUrl = buildTargetUrl(targetUrl, req.path, cleanQuery);
      const parsedTarget = new URL(fullTargetUrl);

      // Check if this is an AI request
      const isAi = aiDetectionEnabled && isAiEndpoint(req.path);
      let parsedAiReq: ReturnType<typeof parseAiRequest> | null = null;
      let requestBodyParsed: any = null;

      if (isAi && req.body) {
        try {
          requestBodyParsed = JSON.parse(req.body.toString());
          parsedAiReq = parseAiRequest(requestBodyParsed, req.path, targetUrl, req.headers as Record<string, any>);
        } catch {
          // Not valid JSON, treat as regular request
        }
      }

      // Prepare request body info for logging
      const { body: logBody, truncated: bodyTruncated, size: bodySize } = processBody(req.body, maxBodySize);

      // Create initial log entry
      let logId: string | null = null;
      if (logEnabled) {
        const log = await prisma.requestLog.create({
          data: {
            method: req.method,
            url: req.originalUrl,
            path: req.path,
            queryParams: safeJsonStringify(cleanQuery),
            headers: safeJsonStringify(req.headers),
            body: logBody,
            bodyTruncated,
            bodySize,
            targetUrl,
            routeSource: source,
            routeRuleId: ruleId,
            isAiRequest: isAi,
          },
        });
        logId = log.id;

        // Emit socket event for request start
        emitRequestStart({
          id: log.id,
          method: req.method,
          url: req.originalUrl,
          path: req.path,
          targetUrl,
          routeSource: source,
          isAiRequest: isAi,
          createdAt: log.createdAt.toISOString(),
        });
      }

      // Prepare headers for proxy request
      const proxyHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.toLowerCase() === 'host') {
          proxyHeaders[key] = parsedTarget.host;
        } else if (key.toLowerCase() !== 'connection' && key.toLowerCase() !== 'content-length') {
          proxyHeaders[key] = Array.isArray(value) ? value.join(', ') : (value as string);
        }
      }

      // Set content-length if we have a body
      if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
        proxyHeaders['content-length'] = req.body.length.toString();
      }

      // Make proxy request
      const protocol = parsedTarget.protocol === 'https:' ? https : http;

      const proxyReq = protocol.request(
        {
          hostname: parsedTarget.hostname,
          port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
          path: parsedTarget.pathname + parsedTarget.search,
          method: req.method,
          headers: proxyHeaders,
        },
        async (proxyRes) => {
          const isStreaming = parsedAiReq?.isStreaming && isStreamingResponse(proxyRes);

          // Extract auth header for OpenRouter enrichment
          const authHeader = req.headers['authorization'] as string | undefined;

          if (isStreaming) {
            // Handle streaming response
            await handleStreamingResponse(
              proxyRes,
              res,
              startTime,
              logId,
              logEnabled,
              parsedAiReq!,
              maxBodySize,
              authHeader
            );
          } else {
            // Handle regular response
            await handleRegularResponse(
              proxyRes,
              res,
              startTime,
              logId,
              logEnabled,
              isAi,
              parsedAiReq,
              maxBodySize,
              authHeader
            );
          }
        }
      );

      proxyReq.on('error', async (err) => {
        console.error('Proxy request error:', err);

        if (logId && logEnabled) {
          await prisma.requestLog.update({
            where: { id: logId },
            data: {
              statusCode: 502,
              responseTime: Date.now() - startTime,
              error: err.message,
            },
          });

          // Emit socket event for failed request
          emitRequestComplete({
            id: logId,
            statusCode: 502,
            responseTime: Date.now() - startTime,
            responseSize: null,
            error: err.message,
          });
        }

        if (!res.headersSent) {
          res.status(502).json({ error: 'Proxy error', message: err.message });
        }
      });

      // Send request body
      if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
        proxyReq.write(req.body);
      }

      proxyReq.end();
    } catch (err) {
      console.error('Proxy handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal proxy error' });
      }
    }
  });

  return app;
}

async function handleStreamingResponse(
  proxyRes: http.IncomingMessage,
  res: Response,
  startTime: number,
  logId: string | null,
  logEnabled: boolean,
  parsedAiReq: ReturnType<typeof parseAiRequest>,
  maxBodySize: number,
  authHeader?: string
): Promise<void> {
  // Set headers for SSE
  res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Forward other headers
  for (const [key, value] of Object.entries(proxyRes.headers)) {
    if (!['content-type', 'transfer-encoding', 'connection'].includes(key.toLowerCase()) && value) {
      res.setHeader(key, value);
    }
  }

  res.statusCode = proxyRes.statusCode || 200;

  // Collect chunks while streaming
  const collector = new SSECollector(startTime);

  proxyRes.pipe(collector).pipe(res);

  // Wait for stream to complete
  await new Promise<void>((resolve) => {
    collector.on('finish', resolve);
    collector.on('error', resolve);
  });

  const { chunks, timeToFirstToken } = collector.getResult();
  const responseTime = Date.now() - startTime;

  // Parse streamed response
  const parsedResponse = parseStreamedResponse(chunks);

  // Calculate cost
  const cost = await calculateCost(
    parsedResponse.model || parsedAiReq.model,
    parsedResponse.promptTokens,
    parsedResponse.completionTokens,
    parsedAiReq.provider
  );

  // Update log with response data
  if (logId && logEnabled) {
    // Extract OpenRouter generation ID if applicable
    const openrouterGenerationId = isOpenRouter(parsedAiReq.provider)
      ? extractOpenRouterGenerationIdFromChunks(parsedResponse.fullResponse)
      : null;

    // Create AI request record
    const aiRequest = await prisma.aiRequest.create({
      data: {
        provider: parsedAiReq.provider,
        endpoint: parsedAiReq.endpoint,
        model: parsedResponse.model || parsedAiReq.model,
        isStreaming: true,
        systemPrompt: parsedAiReq.systemPrompt,
        userMessages: safeJsonStringify(parsedAiReq.userMessages),
        assistantResponse: parsedResponse.assistantResponse,
        fullRequest: safeJsonStringify(parsedAiReq.fullRequest),
        fullResponse: safeJsonStringify(parsedResponse.fullResponse),
        // Full conversation with all message types
        messages: safeJsonStringify(parsedAiReq.messages),
        hasToolCalls: parsedAiReq.hasToolCalls,
        toolCallCount: parsedAiReq.toolCallCount > 0 ? parsedAiReq.toolCallCount : null,
        toolNames: parsedAiReq.toolNames.length > 0 ? safeJsonStringify(parsedAiReq.toolNames) : null,
        promptTokens: parsedResponse.promptTokens,
        completionTokens: parsedResponse.completionTokens,
        totalTokens: parsedResponse.totalTokens,
        inputCostMicros: cost.inputCostMicros,
        outputCostMicros: cost.outputCostMicros,
        totalCostMicros: cost.totalCostMicros,
        timeToFirstToken,
        totalDuration: responseTime,
        // OpenRouter-specific (field added in migration)
        ...(openrouterGenerationId && { openrouterGenerationId }),
      } as any,
    });

    await prisma.requestLog.update({
      where: { id: logId },
      data: {
        statusCode: proxyRes.statusCode,
        responseHeaders: safeJsonStringify(proxyRes.headers),
        responseBody: '[Streaming response - see AI request details]',
        responseSize: chunks.join('').length,
        responseTime,
        aiRequestId: aiRequest.id,
      },
    });

    // Emit socket event for request completion
    emitRequestComplete({
      id: logId,
      statusCode: proxyRes.statusCode ?? null,
      responseTime,
      responseSize: chunks.join('').length,
      error: null,
      aiRequestId: aiRequest.id,
      model: parsedResponse.model || parsedAiReq.model,
      totalTokens: parsedResponse.totalTokens,
      totalCostMicros: cost.totalCostMicros,
    });

    // Schedule OpenRouter enrichment in background (non-blocking)
    if (openrouterGenerationId && authHeader) {
      scheduleOpenRouterEnrichment(aiRequest.id, openrouterGenerationId, authHeader);
    }
  }
}

async function handleRegularResponse(
  proxyRes: http.IncomingMessage,
  res: Response,
  startTime: number,
  logId: string | null,
  logEnabled: boolean,
  isAi: boolean,
  parsedAiReq: ReturnType<typeof parseAiRequest> | null,
  maxBodySize: number,
  authHeader?: string
): Promise<void> {
  // Collect response body
  const chunks: Buffer[] = [];

  proxyRes.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    proxyRes.on('end', resolve);
    proxyRes.on('error', reject);
  });

  const responseBuffer = Buffer.concat(chunks);
  const responseTime = Date.now() - startTime;

  // Forward response headers
  for (const [key, value] of Object.entries(proxyRes.headers)) {
    if (value && key.toLowerCase() !== 'transfer-encoding') {
      res.setHeader(key, value);
    }
  }

  res.status(proxyRes.statusCode || 200);
  res.send(responseBuffer);

  // Decompress for logging/parsing (original buffer already sent to client)
  const contentEncoding = proxyRes.headers['content-encoding'] as string | undefined;
  const decompressedBuffer = await decompressBuffer(responseBuffer, contentEncoding);

  // Process response for logging
  const { body: responseBody, truncated: responseTruncated, size: responseSize } = processBody(
    decompressedBuffer,
    maxBodySize
  );

  // Parse AI response if applicable
  let aiRequestId: string | null = null;

  if (isAi && parsedAiReq && logEnabled) {
    let parsedBody: any = null;
    try {
      parsedBody = JSON.parse(decompressedBuffer.toString());
    } catch {
      // Not valid JSON
    }

    if (parsedBody) {
      const parsedResponse = parseAiResponse(parsedBody, false);
      const cost = await calculateCost(
        parsedResponse.model || parsedAiReq.model,
        parsedResponse.promptTokens,
        parsedResponse.completionTokens,
        parsedAiReq.provider
      );

      // Extract OpenRouter generation ID if applicable
      const openrouterGenerationId = isOpenRouter(parsedAiReq.provider)
        ? extractOpenRouterGenerationId(parsedBody)
        : null;

      const aiRequest = await prisma.aiRequest.create({
        data: {
          provider: parsedAiReq.provider,
          endpoint: parsedAiReq.endpoint,
          model: parsedResponse.model || parsedAiReq.model,
          isStreaming: false,
          systemPrompt: parsedAiReq.systemPrompt,
          userMessages: safeJsonStringify(parsedAiReq.userMessages),
          assistantResponse: parsedResponse.assistantResponse,
          fullRequest: safeJsonStringify(parsedAiReq.fullRequest),
          fullResponse: safeJsonStringify(parsedResponse.fullResponse),
          // Full conversation with all message types
          messages: safeJsonStringify(parsedAiReq.messages),
          hasToolCalls: parsedAiReq.hasToolCalls,
          toolCallCount: parsedAiReq.toolCallCount > 0 ? parsedAiReq.toolCallCount : null,
          toolNames: parsedAiReq.toolNames.length > 0 ? safeJsonStringify(parsedAiReq.toolNames) : null,
          promptTokens: parsedResponse.promptTokens,
          completionTokens: parsedResponse.completionTokens,
          totalTokens: parsedResponse.totalTokens,
          inputCostMicros: cost.inputCostMicros,
          outputCostMicros: cost.outputCostMicros,
          totalCostMicros: cost.totalCostMicros,
          totalDuration: responseTime,
          // OpenRouter-specific (field added in migration)
          ...(openrouterGenerationId && { openrouterGenerationId }),
        } as any,
      });

      aiRequestId = aiRequest.id;

      // Schedule OpenRouter enrichment in background (non-blocking)
      if (openrouterGenerationId && authHeader) {
        scheduleOpenRouterEnrichment(aiRequest.id, openrouterGenerationId, authHeader);
      }
    }
  }

  // Update log
  if (logId && logEnabled) {
    await prisma.requestLog.update({
      where: { id: logId },
      data: {
        statusCode: proxyRes.statusCode,
        responseHeaders: safeJsonStringify(proxyRes.headers),
        responseBody,
        responseTruncated,
        responseSize,
        responseTime,
        aiRequestId,
      },
    });

    // Emit socket event for request completion
    emitRequestComplete({
      id: logId,
      statusCode: proxyRes.statusCode ?? null,
      responseTime,
      responseSize,
      error: null,
      aiRequestId,
      // Include AI-specific fields if available
      ...(isAi && parsedAiReq && aiRequestId ? {
        model: parsedAiReq.model,
        // We can get these from the parsed response
      } : {}),
    });
  }
}
