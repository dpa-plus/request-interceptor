import { prisma } from './prisma.js';
import { emitOpenRouterEnriched } from './socketServer.js';

export interface OpenRouterGenerationData {
  id: string;
  upstream_id: string | null;
  total_cost: number;
  cache_discount: number | null;
  upstream_inference_cost: number | null;
  created_at: string;
  model: string;
  app_id: number | null;
  streamed: boolean | null;
  cancelled: boolean | null;
  provider_name: string | null;
  latency: number | null;
  moderation_latency: number | null;
  generation_time: number | null;
  finish_reason: string | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  native_tokens_prompt: number | null;
  native_tokens_completion: number | null;
  native_tokens_completion_images: number | null;
  native_tokens_reasoning: number | null;
  native_tokens_cached: number | null;
  num_media_prompt: number | null;
  num_input_audio_prompt: number | null;
  num_media_completion: number | null;
  num_search_results: number | null;
  origin: string;
  usage: number;
  is_byok: boolean;
  native_finish_reason: string | null;
  external_user: string | null;
  api_type: string | null;
  router: string | null;
}

interface OpenRouterGenerationResponse {
  data: OpenRouterGenerationData;
}

/**
 * Fetch generation metadata from OpenRouter API.
 * This should be called asynchronously AFTER the response has been sent to the client.
 */
export async function fetchOpenRouterGeneration(
  generationId: string,
  authHeader: string
): Promise<OpenRouterGenerationData | null> {
  try {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
        },
      }
    );

    if (!response.ok) {
      console.error(`OpenRouter generation API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as OpenRouterGenerationResponse;
    return data.data;
  } catch (error) {
    console.error('Error fetching OpenRouter generation:', error);
    return null;
  }
}

/**
 * Enrich an AiRequest record with OpenRouter generation data.
 * This runs in the background after the response has been sent.
 */
export async function enrichAiRequestWithOpenRouter(
  aiRequestId: string,
  generationId: string,
  authHeader: string
): Promise<void> {
  try {
    const generationData = await fetchOpenRouterGeneration(generationId, authHeader);

    if (!generationData) {
      console.warn(`Failed to fetch OpenRouter generation data for ${generationId}`);
      return;
    }

    // Update the AiRequest with enriched data (using 'as any' for new fields not yet in Prisma types)
    await prisma.aiRequest.update({
      where: { id: aiRequestId },
      data: {
        // Mark as enriched
        openrouterEnriched: true,
        openrouterEnrichedAt: new Date(),

        // OpenRouter-specific data
        openrouterGenerationId: generationData.id,
        openrouterProviderName: generationData.provider_name,
        openrouterUpstreamId: generationData.upstream_id,
        openrouterTotalCost: generationData.total_cost,
        openrouterCacheDiscount: generationData.cache_discount,
        openrouterLatency: generationData.latency ? Math.round(generationData.latency) : null,
        openrouterGenerationTime: generationData.generation_time ? Math.round(generationData.generation_time) : null,
        openrouterModerationLatency: generationData.moderation_latency ? Math.round(generationData.moderation_latency) : null,
        openrouterNativeTokensPrompt: generationData.native_tokens_prompt,
        openrouterNativeTokensCompletion: generationData.native_tokens_completion,
        openrouterNativeTokensReasoning: generationData.native_tokens_reasoning,
        openrouterNativeTokensCached: generationData.native_tokens_cached,
        openrouterFinishReason: generationData.finish_reason || generationData.native_finish_reason,
        openrouterIsByok: generationData.is_byok,
        openrouterRawResponse: JSON.stringify(generationData),

        // Update cost with actual OpenRouter cost (convert USD to micro-dollars)
        totalCostMicros: Math.round(generationData.total_cost * 1_000_000),

        // Update token counts if we have native values
        promptTokens: generationData.native_tokens_prompt ?? generationData.tokens_prompt,
        completionTokens: generationData.native_tokens_completion ?? generationData.tokens_completion,
        totalTokens:
          (generationData.native_tokens_prompt ?? generationData.tokens_prompt ?? 0) +
          (generationData.native_tokens_completion ?? generationData.tokens_completion ?? 0),

        // Update model if different
        model: generationData.model,
      } as any,
    });

    console.log(`Enriched AiRequest ${aiRequestId} with OpenRouter data (generation: ${generationId}, provider: ${generationData.provider_name}, cost: $${generationData.total_cost})`);

    // Emit socket event for OpenRouter enrichment
    emitOpenRouterEnriched({
      aiRequestId,
      openrouterProviderName: generationData.provider_name,
      openrouterTotalCost: generationData.total_cost,
      openrouterCacheDiscount: generationData.cache_discount,
    });
  } catch (error) {
    console.error(`Error enriching AiRequest ${aiRequestId} with OpenRouter data:`, error);
  }
}

/**
 * Schedule OpenRouter enrichment to run after a short delay.
 * This allows the OpenRouter API time to process the generation.
 */
export function scheduleOpenRouterEnrichment(
  aiRequestId: string,
  generationId: string,
  authHeader: string,
  delayMs: number = 1000
): void {
  // Don't await - this runs in the background
  setTimeout(() => {
    enrichAiRequestWithOpenRouter(aiRequestId, generationId, authHeader).catch(err => {
      console.error('Background OpenRouter enrichment failed:', err);
    });
  }, delayMs);
}
