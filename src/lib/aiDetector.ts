import { prisma } from './prisma.js';

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
  // Generic patterns
  '/chat/completions',
  '/completions',
];

const AI_ENDPOINT_PATTERNS = AI_ENDPOINTS.map(ep => new RegExp(`${ep.replace('/', '\\/')}$`));

export type AiProvider = 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';

export interface ParsedAiRequest {
  provider: AiProvider;
  endpoint: string;
  model: string | null;
  isStreaming: boolean;
  systemPrompt: string | null;
  userMessages: string[]; // Just the content strings
  fullRequest: any;
}

export interface ParsedAiResponse {
  assistantResponse: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string | null;
  fullResponse: any;
}

export interface CostEstimate {
  inputCostMicros: number;
  outputCostMicros: number;
  totalCostMicros: number;
}

export function isAiEndpoint(path: string): boolean {
  return AI_ENDPOINT_PATTERNS.some(pattern => pattern.test(path));
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
  const isStreaming = body?.stream === true;

  let systemPrompt: string | null = null;
  const userMessages: string[] = [];
  let model: string | null = body?.model || null;

  // Parse messages for chat completions
  if (Array.isArray(body?.messages)) {
    for (const msg of body.messages) {
      if (msg.role === 'system') {
        systemPrompt = extractContent(msg.content);
      } else if (msg.role === 'user') {
        const content = extractContent(msg.content);
        if (content) userMessages.push(content);
      }
    }
  }

  // Anthropic format
  if (body?.system) {
    systemPrompt = typeof body.system === 'string' ? body.system : JSON.stringify(body.system);
  }

  return {
    provider,
    endpoint: path,
    model,
    isStreaming,
    systemPrompt,
    userMessages,
    fullRequest: body,
  };
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

  if (!body) {
    return { assistantResponse, promptTokens, completionTokens, totalTokens, model, fullResponse: body };
  }

  // Standard OpenAI response format
  if (body.choices && Array.isArray(body.choices)) {
    const choice = body.choices[0];
    if (choice?.message?.content) {
      assistantResponse = choice.message.content;
    } else if (choice?.text) {
      assistantResponse = choice.text;
    }
  }

  // Anthropic response format
  if (body.content && Array.isArray(body.content)) {
    const textContent = body.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    if (textContent) assistantResponse = textContent;
  }

  // Usage
  if (body.usage) {
    promptTokens = body.usage.prompt_tokens ?? body.usage.input_tokens ?? null;
    completionTokens = body.usage.completion_tokens ?? body.usage.output_tokens ?? null;
    totalTokens = body.usage.total_tokens ?? (promptTokens && completionTokens ? promptTokens + completionTokens : null);
  }

  model = body.model || null;

  return {
    assistantResponse,
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    fullResponse: body,
  };
}

export function parseStreamedResponse(chunks: string[]): ParsedAiResponse {
  let assistantResponse = '';
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;
  let model: string | null = null;
  let fullResponse: any[] = [];

  for (const chunk of chunks) {
    // Skip empty lines and [DONE]
    if (!chunk || chunk === '[DONE]') continue;

    try {
      const data = JSON.parse(chunk);
      fullResponse.push(data);

      // Extract content from delta
      if (data.choices?.[0]?.delta?.content) {
        assistantResponse += data.choices[0].delta.content;
      }

      // Anthropic streaming
      if (data.delta?.text) {
        assistantResponse += data.delta.text;
      }

      // Model (usually in first chunk)
      if (data.model && !model) {
        model = data.model;
      }

      // Usage (usually in last chunk for OpenAI with stream_options)
      if (data.usage) {
        promptTokens = data.usage.prompt_tokens ?? data.usage.input_tokens ?? null;
        completionTokens = data.usage.completion_tokens ?? data.usage.output_tokens ?? null;
        totalTokens = data.usage.total_tokens ?? null;
      }

      // Anthropic message_delta with usage
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

  return {
    assistantResponse: assistantResponse || null,
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    fullResponse,
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
