/**
 * Unified Model Info Service
 *
 * Fetches model metadata (context_length, pricing, etc.) with a two-tier approach:
 * 1. First: Try the provider's own /models endpoint (most AI APIs follow OpenAI standard)
 * 2. Fallback: Use OpenRouter's /api/v1/models as a comprehensive fallback
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

// Cache for provider model info
// Key format: "baseUrl|modelId"
const providerModelsCache: Map<string, ModelInfo> = new Map();
const providerCacheTimestamps: Map<string, number> = new Map();
const PROVIDER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Track failed providers to avoid repeated failures
const failedProviders: Map<string, number> = new Map();
const FAILED_PROVIDER_RETRY_MS = 5 * 60 * 1000; // 5 minutes before retry

/**
 * Normalize base URL for cache key
 */
function normalizeBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}

/**
 * Fetch models from a provider's /models endpoint
 * Most OpenAI-compatible APIs expose this endpoint
 */
async function fetchProviderModels(baseUrl: string): Promise<Map<string, ModelInfo> | null> {
  const normalizedUrl = normalizeBaseUrl(baseUrl);

  // Check if this provider recently failed
  const lastFailed = failedProviders.get(normalizedUrl);
  if (lastFailed && (Date.now() - lastFailed) < FAILED_PROVIDER_RETRY_MS) {
    return null;
  }

  try {
    // Try common model endpoint paths
    const endpoints = [
      '/v1/models',
      '/models',
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${normalizedUrl}${endpoint}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(5000), // 5 second timeout
        });

        if (response.ok) {
          const data = await response.json() as any;

          // OpenAI format: { data: [...models] }
          const models = data.data || data.models || (Array.isArray(data) ? data : null);

          if (Array.isArray(models) && models.length > 0) {
            console.log(`[Model Info] Fetched ${models.length} models from ${normalizedUrl}${endpoint}`);

            const modelMap = new Map<string, ModelInfo>();
            const now = Date.now();

            for (const model of models) {
              const modelId = model.id || model.name;
              if (!modelId) continue;

              const info: ModelInfo = {
                id: modelId,
                name: model.name || model.id,
                context_length: model.context_length || model.context_window || model.max_tokens || null,
                source: 'provider',
              };

              // Some providers include pricing
              if (model.pricing) {
                info.pricing = {
                  prompt: parseFloat(model.pricing.prompt) || 0,
                  completion: parseFloat(model.pricing.completion) || 0,
                };
              }

              modelMap.set(modelId, info);

              // Also cache individually
              const cacheKey = `${normalizedUrl}|${modelId}`;
              providerModelsCache.set(cacheKey, info);
              providerCacheTimestamps.set(cacheKey, now);
            }

            // Clear failed status on success
            failedProviders.delete(normalizedUrl);

            return modelMap;
          }
        }
      } catch (endpointError) {
        // Try next endpoint
        continue;
      }
    }

    // All endpoints failed
    failedProviders.set(normalizedUrl, Date.now());
    return null;
  } catch (error) {
    console.log(`[Model Info] Failed to fetch from ${normalizedUrl}:`, error);
    failedProviders.set(normalizedUrl, Date.now());
    return null;
  }
}

/**
 * Get model info from provider cache
 */
function getFromProviderCache(baseUrl: string, modelId: string): ModelInfo | null {
  const normalizedUrl = normalizeBaseUrl(baseUrl);
  const cacheKey = `${normalizedUrl}|${modelId}`;

  const cached = providerModelsCache.get(cacheKey);
  const timestamp = providerCacheTimestamps.get(cacheKey);

  if (cached && timestamp && (Date.now() - timestamp) < PROVIDER_CACHE_TTL_MS) {
    return cached;
  }

  return null;
}

/**
 * Get model info with provider-first, OpenRouter fallback strategy
 *
 * @param modelId - The model ID (e.g., "gpt-4o", "claude-3-sonnet", "openai/gpt-4o")
 * @param providerBaseUrl - The base URL of the provider (e.g., "https://api.openai.com")
 */
export async function getModelInfo(modelId: string, providerBaseUrl?: string): Promise<ModelInfo | null> {
  // 1. Check provider cache first
  if (providerBaseUrl) {
    const cached = getFromProviderCache(providerBaseUrl, modelId);
    if (cached) {
      return cached;
    }
  }

  // 2. Try to fetch from provider's /models endpoint
  if (providerBaseUrl) {
    const providerModels = await fetchProviderModels(providerBaseUrl);
    if (providerModels) {
      const model = providerModels.get(modelId);
      if (model) {
        return model;
      }
    }
  }

  // 3. Fallback to OpenRouter
  const openRouterModel = await getOpenRouterModelInfo(modelId);
  if (openRouterModel) {
    return convertOpenRouterModel(openRouterModel);
  }

  // 4. Try OpenRouter with provider prefix if model doesn't have one
  if (!modelId.includes('/') && providerBaseUrl) {
    const providerPrefix = guessProviderPrefix(providerBaseUrl);
    if (providerPrefix) {
      const prefixedModelId = `${providerPrefix}/${modelId}`;
      const prefixedModel = await getOpenRouterModelInfo(prefixedModelId);
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
 * Guess provider prefix for OpenRouter lookup based on base URL
 */
function guessProviderPrefix(baseUrl: string): string | null {
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
export async function getContextLength(modelId: string, providerBaseUrl?: string): Promise<number | null> {
  const info = await getModelInfo(modelId, providerBaseUrl);
  return info?.context_length || null;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  providerCacheSize: number;
  failedProvidersCount: number;
} {
  return {
    providerCacheSize: providerModelsCache.size,
    failedProvidersCount: failedProviders.size,
  };
}

/**
 * Clear all caches (for testing/debugging)
 */
export function clearCaches(): void {
  providerModelsCache.clear();
  providerCacheTimestamps.clear();
  failedProviders.clear();
}
