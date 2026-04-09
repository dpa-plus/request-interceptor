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
 *
 * OpenRouter's generation API is lazy — data may not be available immediately.
 * We retry with increasing delays (10s, 20s, 30s) matching the SMA backend strategy.
 */
export async function enrichAiRequestWithOpenRouter(
  aiRequestId: string,
  generationId: string,
  authHeader: string
): Promise<void> {
  const retryDelays = [10_000, 20_000, 30_000];
  let generationData: OpenRouterGenerationData | null = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    // Wait before fetching — initial 10s delay, then retries at 20s, 30s
    const delay = attempt === 0 ? 10_000 : retryDelays[attempt - 1];
    await new Promise(resolve => setTimeout(resolve, delay));

    generationData = await fetchOpenRouterGeneration(generationId, authHeader);

    if (generationData && generationData.total_cost !== undefined) {
      break;
    }

    if (attempt < retryDelays.length) {
      console.log(`OpenRouter generation data not yet available for ${generationId}, retrying in ${retryDelays[attempt] / 1000}s (attempt ${attempt + 1}/${retryDelays.length})`);
    }
  }

  if (!generationData) {
    console.warn(`Failed to fetch OpenRouter generation data for ${generationId} after ${retryDelays.length + 1} attempts`);
    return;
  }

  try {
    await prisma.aiRequest.update({
      where: { id: aiRequestId },
      data: {
        openrouterEnriched: true,
        openrouterEnrichedAt: new Date(),
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
        totalCostMicros: Math.round(generationData.total_cost * 1_000_000),
        promptTokens: generationData.native_tokens_prompt ?? generationData.tokens_prompt,
        completionTokens: generationData.native_tokens_completion ?? generationData.tokens_completion,
        totalTokens:
          (generationData.native_tokens_prompt ?? generationData.tokens_prompt ?? 0) +
          (generationData.native_tokens_completion ?? generationData.tokens_completion ?? 0),
        model: generationData.model,
      } as any,
    });

    console.log(`Enriched AiRequest ${aiRequestId} with OpenRouter data (generation: ${generationId}, provider: ${generationData.provider_name}, cost: $${generationData.total_cost})`);

    emitOpenRouterEnriched({
      aiRequestId,
      openrouterProviderName: generationData.provider_name,
      openrouterTotalCost: generationData.total_cost,
      openrouterCacheDiscount: generationData.cache_discount,
    });
  } catch (error) {
    console.error(`Error updating AiRequest ${aiRequestId} with OpenRouter data:`, error);
  }
}

/**
 * Schedule OpenRouter enrichment in the background.
 * The enrichment function handles its own retry delays internally.
 */
export function scheduleOpenRouterEnrichment(
  aiRequestId: string,
  generationId: string,
  authHeader: string
): void {
  enrichAiRequestWithOpenRouter(aiRequestId, generationId, authHeader).catch(err => {
    console.error('Background OpenRouter enrichment failed:', err);
  });
}
