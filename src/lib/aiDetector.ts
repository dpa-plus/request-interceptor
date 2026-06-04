import { prisma } from './prisma.js';
import {
  ContentPart,
  extractContentParts,
  extractImagesField,
  extractFileAnnotations,
} from './multimodalProcessor.js';
import { storeBase64 } from './mediaStorage.js';

// OpenAI-compatible endpoints
const AI_ENDPOINTS = [
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/embeddings',
  '/v1/images/generations',
  '/v1/audio/transcriptions',
  '/v1/audio/speech',
  '/v1/moderations',
  // Anthropic
  '/v1/messages',
  // Generic patterns (without /v1 prefix)
  '/chat/completions',
  '/completions',
  '/embeddings',
  '/messages',
];

const AI_ENDPOINT_PATTERNS = AI_ENDPOINTS.map(ep => new RegExp(`${ep.replace('/', '\\/')}$`));

export type AiProvider = 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';

// Tool call structure (OpenAI format)
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// Unified message structure for conversation view
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  // For assistant messages with tool calls
  toolCalls?: ToolCall[];
  // For tool result messages
  toolCallId?: string;
  toolName?: string;
  // For multimodal content
  hasImages?: boolean;
  imageCount?: number;
  hasAudio?: boolean;
  audioCount?: number;
  // Structured content parts (text + media + reasoning). When present, the UI
  // renders these instead of (or alongside) the flat `content` string.
  contentParts?: ContentPart[];
}

export type AiRequestKind = 'chat' | 'embedding' | 'audio' | 'image' | 'moderation';

export interface ParsedAiRequest {
  provider: AiProvider;
  endpoint: string;
  kind: AiRequestKind;
  model: string | null;
  isStreaming: boolean;
  systemPrompt: string | null;
  userMessages: string[]; // Just the content strings (legacy, for backwards compatibility)
  fullRequest: any;
  // New: full conversation with all message types
  messages: ConversationMessage[];
  // Tool-related metadata
  hasToolCalls: boolean;
  toolCallCount: number;
  toolNames: string[];
  // Embedding-specific
  embeddingInputCount?: number;
  embeddingInputPreview?: string[];
}

export interface ParsedAiResponse {
  assistantResponse: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string | null;
  fullResponse: any;
  // Tool calls from the response
  toolCalls?: ToolCall[];
  finishReason?: string;
  // Structured multimodal output (images, audio, reasoning, file annotations).
  // Populated alongside the legacy text `assistantResponse` for backwards compat.
  assistantContentParts?: ContentPart[];
  // Embedding-specific: filled in by parseEmbeddingResponse
  embeddingCount?: number;
  embeddingDimensions?: number;
}

export interface CostEstimate {
  inputCostMicros: number;
  outputCostMicros: number;
  totalCostMicros: number;
}

export function isAiEndpoint(path: string): boolean {
  return AI_ENDPOINT_PATTERNS.some(pattern => pattern.test(path));
}

/**
 * Classify the AI endpoint so the UI / stats can group requests sensibly.
 * Falls back to 'chat' since chat/completions is the dominant case.
 */
export function detectKind(path: string): AiRequestKind {
  const lower = path.toLowerCase();
  if (lower.includes('/embeddings')) return 'embedding';
  if (lower.includes('/audio/')) return 'audio';
  if (lower.includes('/images/')) return 'image';
  if (lower.includes('/moderations')) return 'moderation';
  return 'chat';
}

/**
 * Truncate a string to a max length with an ellipsis. Embedding input
 * previews use this so we don't store full document text per row.
 */
function truncatePreview(s: string, max: number = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export function detectProvider(targetUrl: string, headers: Record<string, any>): AiProvider {
  const url = targetUrl.toLowerCase();

  if (url.includes('openrouter.ai')) return 'openrouter';
  if (url.includes('api.openai.com')) return 'openai';
  if (url.includes('openai.azure.com')) return 'azure';
  if (url.includes('api.anthropic.com')) return 'anthropic';

  // Check for custom provider header
  const customProvider = headers['x-ai-provider'];
  if (customProvider) {
    const normalized = customProvider.toLowerCase();
    if (['openai', 'anthropic', 'azure', 'openrouter'].includes(normalized)) {
      return normalized as AiProvider;
    }
  }

  return 'custom';
}

export function isOpenRouter(provider: AiProvider): boolean {
  return provider === 'openrouter';
}

/**
 * Extract generation ID from OpenRouter response.
 * OpenRouter returns the generation ID in the `id` field of the response.
 */
export function extractOpenRouterGenerationId(responseBody: any): string | null {
  if (!responseBody) return null;

  // Non-streaming: id is directly in response
  if (typeof responseBody.id === 'string') {
    return responseBody.id;
  }

  return null;
}

/**
 * Extract generation ID from streamed OpenRouter response chunks.
 * The ID is typically in the first chunk.
 */
export function extractOpenRouterGenerationIdFromChunks(chunks: any[]): string | null {
  for (const chunk of chunks) {
    if (chunk && typeof chunk.id === 'string') {
      return chunk.id;
    }
  }
  return null;
}

export function parseAiRequest(body: any, path: string, targetUrl: string, headers: Record<string, any>): ParsedAiRequest {
  const provider = detectProvider(targetUrl, headers);
  const kind = detectKind(path);
  const isStreaming = body?.stream === true;

  let systemPrompt: string | null = null;
  const userMessages: string[] = [];
  const messages: ConversationMessage[] = [];
  const toolNames: Set<string> = new Set();
  let toolCallCount = 0;
  let model: string | null = body?.model || null;

  // Embedding requests have `input` (string | string[]) instead of `messages`.
  // We don't store the full corpus — capture the count plus a short preview of
  // each entry so the UI can render "3 inputs: 'foo…', 'bar…', …".
  let embeddingInputCount: number | undefined;
  let embeddingInputPreview: string[] | undefined;
  if (kind === 'embedding') {
    const input = body?.input;
    if (typeof input === 'string') {
      embeddingInputCount = 1;
      embeddingInputPreview = [truncatePreview(input)];
    } else if (Array.isArray(input)) {
      embeddingInputCount = input.length;
      // Cap the preview list — large batch jobs can have thousands of entries.
      embeddingInputPreview = input.slice(0, 5).map((v: unknown) =>
        truncatePreview(typeof v === 'string' ? v : JSON.stringify(v))
      );
    }
  }

  // Parse messages for chat completions
  if (Array.isArray(body?.messages)) {
    for (const msg of body.messages) {
      const role = msg.role as string;

      if (role === 'system') {
        systemPrompt = extractContent(msg.content);
        messages.push({
          role: 'system',
          content: systemPrompt,
        });
      } else if (role === 'user') {
        const content = extractContent(msg.content);
        const mediaInfo = extractMediaInfo(msg.content);
        const parts = extractContentParts(msg.content);
        if (content) userMessages.push(content);
        messages.push({
          role: 'user',
          content,
          hasImages: mediaInfo.hasImages,
          imageCount: mediaInfo.imageCount,
          hasAudio: mediaInfo.hasAudio,
          audioCount: mediaInfo.audioCount,
          contentParts: parts.length > 0 ? parts : undefined,
        });
      } else if (role === 'assistant') {
        const content = extractContent(msg.content);
        const parsedToolCalls = parseToolCalls(msg.tool_calls || msg.function_call);
        const parts = extractContentParts(msg.content);

        // Collect tool names
        if (parsedToolCalls) {
          for (const tc of parsedToolCalls) {
            toolNames.add(tc.function.name);
            toolCallCount++;
          }
        }

        messages.push({
          role: 'assistant',
          content,
          toolCalls: parsedToolCalls || undefined,
          contentParts: parts.length > 0 ? parts : undefined,
        });
      } else if (role === 'tool') {
        // Tool result message
        messages.push({
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          toolCallId: msg.tool_call_id,
          toolName: msg.name,
        });
      } else if (role === 'function') {
        // Legacy function role (deprecated but still used)
        messages.push({
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          toolName: msg.name,
        });
      }
    }
  }

  // Anthropic format - system is separate
  if (body?.system) {
    systemPrompt = typeof body.system === 'string' ? body.system : JSON.stringify(body.system);
    // Insert system message at the beginning if not already present
    if (messages.length === 0 || messages[0].role !== 'system') {
      messages.unshift({
        role: 'system',
        content: systemPrompt,
      });
    }
  }

  // Anthropic format - parse tool_use and tool_result in content blocks
  if (Array.isArray(body?.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            toolNames.add(block.name);
            toolCallCount++;
          }
        }
      }
    }
  }

  return {
    provider,
    endpoint: path,
    kind,
    model,
    isStreaming,
    systemPrompt,
    userMessages,
    fullRequest: body,
    messages,
    hasToolCalls: toolCallCount > 0,
    toolCallCount,
    toolNames: Array.from(toolNames),
    embeddingInputCount,
    embeddingInputPreview,
  };
}

/**
 * Replace the (potentially MB-sized) embedding vectors in an embedding
 * response with `null` placeholders before the body lands in the DB. Records
 * the dimensionality of the first vector so the UI can still display it.
 *
 * Mutates `body` in place. Returns the detected vector dimension, or null
 * if no embeddings were found.
 */
export function stripEmbeddingVectors(body: any): { count: number; dimensions: number | null } | null {
  if (!body || !Array.isArray(body.data)) return null;
  let dimensions: number | null = null;
  let count = 0;
  for (const entry of body.data) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { embedding?: unknown };
    if (Array.isArray(e.embedding)) {
      if (dimensions === null) dimensions = e.embedding.length;
      e.embedding = null;
      count++;
    }
  }
  return count > 0 ? { count, dimensions } : null;
}

/**
 * Parse tool calls from OpenAI format
 */
function parseToolCalls(toolCallsOrFunctionCall: any): ToolCall[] | null {
  if (!toolCallsOrFunctionCall) return null;

  // Modern tool_calls array
  if (Array.isArray(toolCallsOrFunctionCall)) {
    return toolCallsOrFunctionCall.map((tc: any) => ({
      id: tc.id || '',
      type: 'function' as const,
      function: {
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '{}',
      },
    }));
  }

  // Legacy function_call object
  if (toolCallsOrFunctionCall.name) {
    return [{
      id: 'legacy',
      type: 'function',
      function: {
        name: toolCallsOrFunctionCall.name,
        arguments: toolCallsOrFunctionCall.arguments || '{}',
      },
    }];
  }

  return null;
}

/**
 * Extract media information (images, audio) from multimodal content
 */
function extractMediaInfo(content: any): {
  hasImages: boolean;
  imageCount: number;
  hasAudio: boolean;
  audioCount: number;
} {
  if (!Array.isArray(content)) {
    return { hasImages: false, imageCount: 0, hasAudio: false, audioCount: 0 };
  }

  const imageCount = content.filter(
    (part: any) => part.type === 'image_url' || part.type === 'image'
  ).length;

  const audioCount = content.filter(
    (part: any) => part.type === 'input_audio' || part.type === 'audio'
  ).length;

  return {
    hasImages: imageCount > 0,
    imageCount,
    hasAudio: audioCount > 0,
    audioCount,
  };
}

/**
 * Build a flat preview text for a structured content parts array.
 * Used when we want to summarize a multimodal message as text (e.g. legacy
 * `content` field, fallbacks).
 */
export function contentPartsToText(parts: ContentPart[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.type === 'text') out.push(p.text);
    else if (p.type === 'reasoning') out.push(`[reasoning]\n${p.text}`);
    else if (p.type === 'image') out.push('[image]');
    else if (p.type === 'audio') out.push(p.transcript ? `[audio: ${p.transcript}]` : '[audio]');
    else if (p.type === 'video') out.push('[video]');
    else if (p.type === 'file') out.push(p.filename ? `[file: ${p.filename}]` : '[file]');
    else if (p.type === 'file_annotation') out.push(`[parsed file: ${p.name ?? p.hash.slice(0, 8)}]`);
  }
  return out.join('\n').trim();
}

function extractContent(content: any): string | null {
  if (typeof content === 'string') return content;

  // Multimodal content (array of content parts)
  if (Array.isArray(content)) {
    const textParts = content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
    return textParts || null;
  }

  return null;
}

export function parseAiResponse(body: any, isStreaming: boolean): ParsedAiResponse {
  let assistantResponse: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;
  let model: string | null = null;
  let toolCalls: ToolCall[] | undefined = undefined;
  let finishReason: string | undefined = undefined;
  const assistantContentParts: ContentPart[] = [];

  if (!body) {
    return { assistantResponse, promptTokens, completionTokens, totalTokens, model, fullResponse: body };
  }

  // Standard OpenAI response format
  if (body.choices && Array.isArray(body.choices)) {
    const choice = body.choices[0];
    const msg = choice?.message;
    if (msg?.content) {
      assistantResponse = typeof msg.content === 'string' ? msg.content : null;
      // Some providers return content as a content-part array (Anthropic-style on chat completions)
      if (Array.isArray(msg.content)) {
        assistantContentParts.push(...extractContentParts(msg.content));
      } else if (typeof msg.content === 'string' && msg.content) {
        assistantContentParts.push({ type: 'text', text: msg.content });
      }
    } else if (choice?.text) {
      assistantResponse = choice.text;
      if (choice.text) assistantContentParts.push({ type: 'text', text: choice.text });
    }

    // Reasoning content (OpenRouter / o1-style)
    if (msg && typeof msg.reasoning === 'string' && msg.reasoning) {
      assistantContentParts.unshift({ type: 'reasoning', text: msg.reasoning });
    } else if (msg && Array.isArray(msg.reasoning_details)) {
      const reasoningText = msg.reasoning_details
        .map((r: any) => (typeof r?.text === 'string' ? r.text : ''))
        .filter(Boolean)
        .join('\n');
      if (reasoningText) assistantContentParts.unshift({ type: 'reasoning', text: reasoningText });
    }

    // Image output (OpenRouter / Gemini / etc.): message.images[]
    if (msg?.images) {
      assistantContentParts.push(...extractImagesField(msg.images));
    }

    // Audio output (non-streaming, when present): message.audio
    if (msg?.audio && typeof msg.audio === 'object') {
      const a = msg.audio as any;
      const part = audioPartFromMessageAudio(a);
      if (part) assistantContentParts.push(part);
    }

    // File annotations (OpenRouter PDF parse results)
    if (msg?.annotations) {
      assistantContentParts.push(...extractFileAnnotations(msg.annotations));
    }

    // Extract tool calls from response
    if (msg?.tool_calls) {
      toolCalls = parseToolCalls(msg.tool_calls) || undefined;
    } else if (msg?.function_call) {
      toolCalls = parseToolCalls(msg.function_call) || undefined;
    }

    // Extract finish reason
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  // Anthropic response format
  if (body.content && Array.isArray(body.content)) {
    const textContent = body.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    if (textContent) assistantResponse = textContent;

    // Anthropic thinking blocks
    const thinking = body.content
      .filter((c: any) => c.type === 'thinking')
      .map((c: any) => (typeof c.thinking === 'string' ? c.thinking : (c.text || '')))
      .filter(Boolean)
      .join('\n');
    if (thinking) assistantContentParts.unshift({ type: 'reasoning', text: thinking });

    // Build structured parts from Anthropic content blocks
    assistantContentParts.push(...extractContentParts(body.content));

    // Anthropic tool_use blocks
    const toolUseBlocks = body.content.filter((c: any) => c.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      toolCalls = toolUseBlocks.map((block: any) => ({
        id: block.id || '',
        type: 'function' as const,
        function: {
          name: block.name || '',
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
        },
      }));
    }
  }

  // OpenRouter error path: parsed PDF annotations under error.metadata.file_annotations
  if (body.error && body.error.metadata && Array.isArray(body.error.metadata.file_annotations)) {
    assistantContentParts.push(...extractFileAnnotations(body.error.metadata.file_annotations));
  }

  // Anthropic stop_reason
  if (body.stop_reason) {
    finishReason = body.stop_reason;
  }

  // Usage
  if (body.usage) {
    promptTokens = body.usage.prompt_tokens ?? body.usage.input_tokens ?? null;
    completionTokens = body.usage.completion_tokens ?? body.usage.output_tokens ?? null;
    totalTokens = body.usage.total_tokens ?? (promptTokens && completionTokens ? promptTokens + completionTokens : null);
  }

  model = body.model || null;

  // Embedding responses: count + dimensions are extracted by the caller via
  // stripEmbeddingVectors() since stripping must happen before we serialize.
  let embeddingCount: number | undefined;
  let embeddingDimensions: number | undefined;
  if (Array.isArray(body.data) && body.data.some((d: any) => 'embedding' in (d ?? {}))) {
    embeddingCount = body.data.length;
    const first = body.data.find((d: any) => Array.isArray(d?.embedding) || d?.embedding === null);
    if (first && Array.isArray(first.embedding)) {
      embeddingDimensions = first.embedding.length;
    }
  }

  return {
    assistantResponse,
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    fullResponse: body,
    toolCalls,
    finishReason,
    assistantContentParts: assistantContentParts.length > 0 ? assistantContentParts : undefined,
    embeddingCount,
    embeddingDimensions,
  };
}

function audioPartFromMessageAudio(a: any): ContentPart | null {
  if (!a || typeof a !== 'object') return null;
  const transcript = typeof a.transcript === 'string' ? a.transcript : undefined;
  const format = typeof a.format === 'string' ? a.format : undefined;
  // data may have already been stripped to media:<hash>.<ext>
  if (typeof a.data === 'string' && a.data.startsWith('media:')) {
    const rest = a.data.slice(6);
    const dot = rest.lastIndexOf('.');
    if (dot < 0) return null;
    return {
      type: 'audio',
      media: { hash: rest.slice(0, dot), ext: rest.slice(dot + 1) },
      format,
      transcript,
    };
  }
  // Otherwise we only have a transcript — still useful to surface
  if (transcript) {
    return { type: 'audio', media: {}, format, transcript };
  }
  return null;
}

export async function parseStreamedResponse(chunks: string[]): Promise<ParsedAiResponse> {
  let assistantResponse = '';
  let reasoningText = '';
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;
  let model: string | null = null;
  let fullResponse: any[] = [];
  let finishReason: string | undefined = undefined;

  // Collect tool calls from streaming (OpenAI streams tool calls incrementally)
  const toolCallsMap = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>();

  // Streaming image output: each delta.images entry is the full image; collect by index.
  const streamedImages: ContentPart[] = [];
  // Streaming audio output: data chunks accumulated, transcript accumulated.
  const audioDataChunks: string[] = [];
  let audioTranscript = '';
  let audioFormat: string | undefined = undefined;
  // File annotations from final chunk
  let annotations: any = null;

  for (const chunk of chunks) {
    if (!chunk || chunk === '[DONE]') continue;

    try {
      const data = JSON.parse(chunk);
      fullResponse.push(data);

      const delta = data.choices?.[0]?.delta;
      if (delta) {
        if (typeof delta.content === 'string') assistantResponse += delta.content;

        // Reasoning streaming
        if (typeof delta.reasoning === 'string') reasoningText += delta.reasoning;
        if (Array.isArray(delta.reasoning_details)) {
          for (const rd of delta.reasoning_details) {
            if (typeof rd?.text === 'string') reasoningText += rd.text;
          }
        }

        // Image output streaming
        if (Array.isArray(delta.images)) {
          streamedImages.push(...extractImagesField(delta.images));
        }

        // Audio output streaming
        if (delta.audio && typeof delta.audio === 'object') {
          if (typeof delta.audio.data === 'string') audioDataChunks.push(delta.audio.data);
          if (typeof delta.audio.transcript === 'string') audioTranscript += delta.audio.transcript;
          if (typeof delta.audio.format === 'string') audioFormat = delta.audio.format;
        }

        // Tool calls (OpenAI incremental)
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: tc.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              });
            }
            const existing = toolCallsMap.get(index)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name += tc.function.name;
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
          }
        }
      }

      // Final-chunk annotations (PDF parse) appear on message in non-delta form for OpenRouter
      const finalMsg = data.choices?.[0]?.message;
      if (finalMsg?.annotations && !annotations) {
        annotations = finalMsg.annotations;
      }

      if (data.choices?.[0]?.finish_reason) {
        finishReason = data.choices[0].finish_reason;
      }

      // Anthropic streaming
      if (data.delta?.text) {
        assistantResponse += data.delta.text;
      }
      if (data.delta?.thinking) {
        reasoningText += typeof data.delta.thinking === 'string' ? data.delta.thinking : '';
      }
      if (data.delta?.stop_reason) {
        finishReason = data.delta.stop_reason;
      }

      if (data.model && !model) {
        model = data.model;
      }

      if (data.usage) {
        promptTokens = data.usage.prompt_tokens ?? data.usage.input_tokens ?? null;
        completionTokens = data.usage.completion_tokens ?? data.usage.output_tokens ?? null;
        totalTokens = data.usage.total_tokens ?? null;
      }

      if (data.type === 'message_delta' && data.usage) {
        completionTokens = data.usage.output_tokens ?? null;
      }
      if (data.type === 'message_start' && data.message?.usage) {
        promptTokens = data.message.usage.input_tokens ?? null;
      }
    } catch {
      // Ignore parse errors for malformed chunks
    }
  }

  const toolCalls = toolCallsMap.size > 0
    ? Array.from(toolCallsMap.values()).filter(tc => tc.function.name)
    : undefined;

  // Assemble structured assistant parts
  const assistantContentParts: ContentPart[] = [];
  if (reasoningText) assistantContentParts.push({ type: 'reasoning', text: reasoningText });
  if (assistantResponse) assistantContentParts.push({ type: 'text', text: assistantResponse });
  assistantContentParts.push(...streamedImages);

  // Persist accumulated audio chunks (if any)
  if (audioDataChunks.length > 0) {
    const fullAudioBase64 = audioDataChunks.join('');
    const format = audioFormat || 'wav';
    const mime = `audio/${format === 'mp3' ? 'mpeg' : format}`;
    const ref = await storeBase64(fullAudioBase64, mime);
    if (ref) {
      assistantContentParts.push({
        type: 'audio',
        media: ref,
        format,
        transcript: audioTranscript || undefined,
      });
    } else if (audioTranscript) {
      assistantContentParts.push({ type: 'audio', media: {}, format, transcript: audioTranscript });
    }
  } else if (audioTranscript) {
    assistantContentParts.push({ type: 'audio', media: {}, format: audioFormat, transcript: audioTranscript });
  }

  if (annotations) assistantContentParts.push(...extractFileAnnotations(annotations));

  return {
    assistantResponse: assistantResponse || null,
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    fullResponse,
    toolCalls,
    finishReason,
    assistantContentParts: assistantContentParts.length > 0 ? assistantContentParts : undefined,
  };
}

// Default pricing in micro-dollars per 1M tokens
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2500000, output: 10000000 },
  'gpt-4o-mini': { input: 150000, output: 600000 },
  'gpt-4-turbo': { input: 10000000, output: 30000000 },
  'gpt-4': { input: 30000000, output: 60000000 },
  'gpt-3.5-turbo': { input: 500000, output: 1500000 },
  'claude-3-opus': { input: 15000000, output: 75000000 },
  'claude-3-sonnet': { input: 3000000, output: 15000000 },
  'claude-3-haiku': { input: 250000, output: 1250000 },
  'claude-3.5-sonnet': { input: 3000000, output: 15000000 },
};

export async function calculateCost(
  model: string | null,
  promptTokens: number | null,
  completionTokens: number | null,
  provider: AiProvider
): Promise<CostEstimate> {
  if (!model || (!promptTokens && !completionTokens)) {
    return { inputCostMicros: 0, outputCostMicros: 0, totalCostMicros: 0 };
  }

  // Try to find pricing in database first
  const dbPricing = await prisma.aiModelPricing.findMany({
    where: { provider },
  });

  let inputPricePerMillion = 0;
  let outputPricePerMillion = 0;

  // Check database pricing with regex matching
  for (const pricing of dbPricing) {
    try {
      const regex = new RegExp(pricing.modelPattern, 'i');
      if (regex.test(model)) {
        inputPricePerMillion = pricing.inputPricePerMillion;
        outputPricePerMillion = pricing.outputPricePerMillion;
        break;
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // Fall back to default pricing
  if (inputPricePerMillion === 0 && outputPricePerMillion === 0) {
    const normalizedModel = model.toLowerCase();
    for (const [pattern, prices] of Object.entries(DEFAULT_PRICING)) {
      if (normalizedModel.includes(pattern)) {
        inputPricePerMillion = prices.input;
        outputPricePerMillion = prices.output;
        break;
      }
    }
  }

  const inputCostMicros = Math.round(((promptTokens || 0) / 1_000_000) * inputPricePerMillion);
  const outputCostMicros = Math.round(((completionTokens || 0) / 1_000_000) * outputPricePerMillion);

  return {
    inputCostMicros,
    outputCostMicros,
    totalCostMicros: inputCostMicros + outputCostMicros,
  };
}
