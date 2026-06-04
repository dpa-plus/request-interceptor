import { ParsedAiResponse, CostEstimate } from './aiDetector.js';
import { safeJsonStringify } from './bodyHandler.js';
import { hashSystemPrompt } from './promptHash.js';

type ParsedAiRequest = import('./aiDetector.js').ParsedAiRequest;

interface BuildOpts {
  parsedAiReq: ParsedAiRequest;
  parsedResponse: ParsedAiResponse;
  cost: CostEstimate;
  isStreaming: boolean;
  timeToFirstToken: number | null;
  totalDuration: number;
  openrouterGenerationId?: string | null;
  messages: import('./aiDetector.js').ConversationMessage[];
}

/**
 * Build the `data` object for `prisma.aiRequest.create()`. Centralizes the
 * shape that was otherwise duplicated between streaming and non-streaming
 * proxy paths.
 */
export function buildAiRequestData(opts: BuildOpts) {
  const { parsedAiReq, parsedResponse, cost, isStreaming, timeToFirstToken, totalDuration, openrouterGenerationId, messages } = opts;

  const responseToolCount = parsedResponse.toolCalls?.length || 0;
  const totalToolCalls = (parsedAiReq.toolCallCount || 0) + responseToolCount;

  const combinedToolNames = (() => {
    const all = new Set(parsedAiReq.toolNames);
    parsedResponse.toolCalls?.forEach((tc) => {
      if (tc.function?.name) all.add(tc.function.name);
    });
    return all.size > 0 ? safeJsonStringify(Array.from(all)) : null;
  })();

  return {
    provider: parsedAiReq.provider,
    endpoint: parsedAiReq.endpoint,
    model: parsedResponse.model || parsedAiReq.model,
    isStreaming,
    systemPrompt: parsedAiReq.systemPrompt,
    systemPromptHash: hashSystemPrompt(parsedAiReq.systemPrompt),
    userMessages: safeJsonStringify(parsedAiReq.userMessages),
    assistantResponse: parsedResponse.assistantResponse,
    fullRequest: safeJsonStringify(parsedAiReq.fullRequest),
    fullResponse: safeJsonStringify(parsedResponse.fullResponse),
    messages: safeJsonStringify(messages),
    hasToolCalls: parsedAiReq.hasToolCalls || responseToolCount > 0,
    toolCallCount: totalToolCalls > 0 ? totalToolCalls : null,
    toolNames: combinedToolNames,
    promptTokens: parsedResponse.promptTokens,
    completionTokens: parsedResponse.completionTokens,
    totalTokens: parsedResponse.totalTokens,
    inputCostMicros: cost.inputCostMicros,
    outputCostMicros: cost.outputCostMicros,
    totalCostMicros: cost.totalCostMicros,
    timeToFirstToken,
    totalDuration,
    ...(openrouterGenerationId ? { openrouterGenerationId } : {}),
  };
}
