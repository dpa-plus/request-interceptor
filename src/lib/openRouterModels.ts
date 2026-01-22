/**
 * OpenRouter Models API client with caching
 * Fetches model metadata (context_length, pricing, etc.) from OpenRouter
 */

interface OpenRouterPricing {
  prompt: string;
  completion: string;
  request: string;
  image: string;
  web_search: string;
  internal_reasoning: string;
  input_cache_read: string;
  input_cache_write: string;
}

interface OpenRouterArchitecture {
  input_modalities: string[];
  output_modalities: string[];
  tokenizer: string;
  instruct_type: string | null;
}

interface OpenRouterTopProvider {
  context_length: number;
  max_completion_tokens: number;
  is_moderated: boolean;
}

export interface OpenRouterModel {
  id: string;
  canonical_slug: string;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: OpenRouterArchitecture;
  pricing: OpenRouterPricing;
  top_provider: OpenRouterTopProvider;
  per_request_limits: unknown | null;
  supported_parameters: string[];
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

// In-memory cache for models
let modelsCache: Map<string, OpenRouterModel> = new Map();
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

/**
 * Fetch all models from OpenRouter API and update cache
 */
async function fetchModels(): Promise<void> {
  try {
    console.log('[OpenRouter Models] Fetching models from API...');
    const response = await fetch('https://openrouter.ai/api/v1/models');

    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}`);
    }

    const data = await response.json() as OpenRouterModelsResponse;

    // Build lookup map by model ID
    modelsCache = new Map();
    for (const model of data.data) {
      modelsCache.set(model.id, model);
      // Also index by canonical_slug if different
      if (model.canonical_slug && model.canonical_slug !== model.id) {
        modelsCache.set(model.canonical_slug, model);
      }
    }

    cacheTimestamp = Date.now();
    console.log(`[OpenRouter Models] Cached ${data.data.length} models`);
  } catch (error) {
    console.error('[OpenRouter Models] Failed to fetch models:', error);
    // Don't clear cache on error, keep stale data
  }
}

/**
 * Ensure cache is populated and not stale
 */
async function ensureCache(): Promise<void> {
  const now = Date.now();
  if (modelsCache.size === 0 || (now - cacheTimestamp) > CACHE_TTL_MS) {
    await fetchModels();
  }
}

/**
 * Get model info by ID
 * @param modelId - The model ID (e.g., "google/gemini-2.5-pro-preview")
 */
export async function getModelInfo(modelId: string): Promise<OpenRouterModel | null> {
  await ensureCache();
  return modelsCache.get(modelId) || null;
}

/**
 * Get context length for a model
 * @param modelId - The model ID
 * @returns Context length in tokens, or null if unknown
 */
export async function getContextLength(modelId: string): Promise<number | null> {
  const model = await getModelInfo(modelId);
  return model?.context_length || null;
}

/**
 * Get pricing for a model (in USD per token)
 * @param modelId - The model ID
 * @returns Pricing object or null if unknown
 */
export async function getModelPricing(modelId: string): Promise<{
  promptPricePerToken: number;
  completionPricePerToken: number;
  promptPricePerMillion: number;
  completionPricePerMillion: number;
} | null> {
  const model = await getModelInfo(modelId);
  if (!model?.pricing) return null;

  const promptPricePerToken = parseFloat(model.pricing.prompt) || 0;
  const completionPricePerToken = parseFloat(model.pricing.completion) || 0;

  return {
    promptPricePerToken,
    completionPricePerToken,
    promptPricePerMillion: promptPricePerToken * 1_000_000,
    completionPricePerMillion: completionPricePerToken * 1_000_000,
  };
}

/**
 * Get all cached models (for API endpoint)
 */
export async function getAllModels(): Promise<OpenRouterModel[]> {
  await ensureCache();
  // Deduplicate (some models are indexed by both id and canonical_slug)
  const seen = new Set<string>();
  const models: OpenRouterModel[] = [];
  for (const model of modelsCache.values()) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }
  return models;
}

/**
 * Force refresh the cache
 */
export async function refreshCache(): Promise<void> {
  cacheTimestamp = 0; // Force refresh
  await ensureCache();
}

/**
 * Get cache stats
 */
export function getCacheStats(): { modelCount: number; cacheAge: number; isStale: boolean } {
  const now = Date.now();
  return {
    modelCount: modelsCache.size,
    cacheAge: cacheTimestamp ? now - cacheTimestamp : -1,
    isStale: (now - cacheTimestamp) > CACHE_TTL_MS,
  };
}
