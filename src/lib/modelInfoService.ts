/**
 * Model Info Service
 *
 * Fetches model metadata (context_length, pricing, etc.) from OpenRouter.
 * OpenRouter has comprehensive model data for most providers.
 *
 * For provider-specific lookups with authentication, use the
 * /api/models/:modelId/from-request/:requestId endpoint which
 * replays auth from an existing request.
 */

import { getModelInfo as getOpenRouterModelInfo, OpenRouterModel } from './openRouterModels.js';

export interface ModelInfo {
  id: string;
  name?: string;
  context_length: number | null;
  pricing?: {
    prompt: number;      // USD per token
    completion: number;  // USD per token
  };
  source: 'provider' | 'openrouter' | 'unknown';
}

/**
 * Get model info from OpenRouter
 *
 * @param modelId - The model ID (e.g., "gpt-4o", "claude-3-sonnet", "openai/gpt-4o")
 * @param providerHint - Optional hint for provider prefix (e.g., "openai", "anthropic")
 */
export async function getModelInfo(modelId: string, providerHint?: string): Promise<ModelInfo | null> {
  // Guard against undefined/null modelId
  if (!modelId) {
    return null;
  }

  // 1. Try direct lookup on OpenRouter
  const openRouterModel = await getOpenRouterModelInfo(modelId);
  if (openRouterModel) {
    return convertOpenRouterModel(openRouterModel);
  }

  // 2. Try with provider prefix if model doesn't have one and we have a hint
  if (!modelId.includes('/') && providerHint) {
    const prefixedModelId = `${providerHint}/${modelId}`;
    const prefixedModel = await getOpenRouterModelInfo(prefixedModelId);
    if (prefixedModel) {
      return convertOpenRouterModel(prefixedModel);
    }
  }

  // 3. Try common provider prefixes as fallback
  if (!modelId.includes('/')) {
    const commonPrefixes = ['openai', 'anthropic', 'google', 'mistralai', 'meta-llama', 'deepseek'];
    for (const prefix of commonPrefixes) {
      const prefixedModel = await getOpenRouterModelInfo(`${prefix}/${modelId}`);
      if (prefixedModel) {
        return convertOpenRouterModel(prefixedModel);
      }
    }
  }

  return null;
}

/**
 * Convert OpenRouter model to our ModelInfo format
 */
function convertOpenRouterModel(model: OpenRouterModel): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    context_length: model.context_length,
    pricing: model.pricing ? {
      prompt: parseFloat(model.pricing.prompt) || 0,
      completion: parseFloat(model.pricing.completion) || 0,
    } : undefined,
    source: 'openrouter',
  };
}

/**
 * Guess provider prefix based on base URL
 */
export function guessProviderFromUrl(baseUrl: string): string | null {
  const url = baseUrl.toLowerCase();

  if (url.includes('openai.com') || url.includes('api.openai')) return 'openai';
  if (url.includes('anthropic.com')) return 'anthropic';
  if (url.includes('googleapis.com') || url.includes('generativelanguage')) return 'google';
  if (url.includes('mistral.ai')) return 'mistralai';
  if (url.includes('cohere.')) return 'cohere';
  if (url.includes('together.')) return 'together';
  if (url.includes('groq.')) return 'groq';
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('openrouter')) return null; // Already has prefix

  return null;
}

/**
 * Get just the context length for a model
 */
export async function getContextLength(modelId: string, providerHint?: string): Promise<number | null> {
  const info = await getModelInfo(modelId, providerHint);
  return info?.context_length || null;
}
