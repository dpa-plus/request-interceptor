# API Reference

Base URL: `http://localhost:3100` (Admin/API) | `http://localhost:3101` (Proxy)

## Authentication

All `/api/*` endpoints (except `/api/health`) require HTTP Basic Auth.

- **User**: `ADMIN_USER` env var (default: `admin`)
- **Password**: `ADMIN_PASSWORD` env var (default: `changeme`)
- **Rate Limit**: 100 requests/minute per IP

```
Authorization: Basic YWRtaW46Y2hhbmdlbWU=
```

---

## Health

### `GET /api/health`

No auth required.

**Response:**
```json
{ "status": "ok", "timestamp": "2026-02-22T12:00:00.000Z" }
```

---

## Request Logs

### `GET /api/logs`

List proxied request logs with filters.

| Param | Type | Description |
|---|---|---|
| `limit` | int | Max results (default 100, max 1000) |
| `offset` | int | Pagination offset |
| `method` | string | Filter by HTTP method (`GET`, `POST`, ...) |
| `isAiRequest` | `"true"` / `"false"` | Filter AI requests |
| `targetUrl` | string | Filter by target URL (substring match) |
| `from` | ISO date | Start date filter |
| `to` | ISO date | End date filter |
| `search` | string | Full-text search in url, path, body |

**Response:**
```json
{
  "logs": [
    {
      "id": "cm...",
      "method": "POST",
      "url": "/v1/chat/completions",
      "path": "/v1/chat/completions",
      "queryParams": null,
      "headers": "{ ... }",
      "body": "{ ... }",
      "bodyTruncated": false,
      "bodySize": 1234,
      "statusCode": 200,
      "responseHeaders": "{ ... }",
      "responseBody": "{ ... }",
      "responseTruncated": false,
      "responseSize": 5678,
      "responseTime": 1234,
      "targetUrl": "https://openrouter.ai",
      "routeSource": "default",
      "routeRuleId": null,
      "isAiRequest": true,
      "createdAt": "2026-02-22T12:00:00.000Z",
      "error": null,
      "aiRequest": {
        "id": "cm...",
        "provider": "openrouter",
        "model": "anthropic/claude-sonnet-4",
        "isStreaming": true,
        "totalTokens": 1500,
        "totalCostMicros": 2400
      }
    }
  ],
  "total": 42,
  "limit": 100,
  "offset": 0
}
```

### `GET /api/logs/:id`

Get single log with full details including associated AI request.

### `DELETE /api/logs`

Delete logs.

| Param | Type | Description |
|---|---|---|
| `olderThan` | ISO date | Delete logs older than this date. Omit to delete all. |

**Response:** `{ "deleted": 42 }`

---

## AI Requests

### `GET /api/ai-requests`

List AI requests.

| Param | Type | Description |
|---|---|---|
| `limit` | int | Max results (default 100, max 1000) |
| `offset` | int | Pagination offset |
| `provider` | string | Filter: `openai`, `anthropic`, `openrouter`, `azure`, `custom` |
| `model` | string | Filter by model name (substring match) |
| `from` | ISO date | Start date |
| `to` | ISO date | End date |

**Response:**
```json
{
  "aiRequests": [
    {
      "id": "cm...",
      "provider": "openrouter",
      "endpoint": "/v1/chat/completions",
      "model": "anthropic/claude-sonnet-4",
      "isStreaming": true,
      "promptTokens": 1000,
      "completionTokens": 500,
      "totalTokens": 1500,
      "totalCostMicros": 2400,
      "timeToFirstToken": 450,
      "totalDuration": 3200,
      "createdAt": "2026-02-22T12:00:00.000Z",
      "hasToolCalls": true,
      "toolCallCount": 3,
      "toolNames": "[\"get_weather\",\"search\"]",
      "openrouterEnriched": true,
      "openrouterProviderName": "Anthropic",
      "openrouterTotalCost": 0.0024,
      "openrouterCacheDiscount": 0.0002,
      "openrouterNativeTokensReasoning": null,
      "openrouterNativeTokensCached": 200,
      "requestLogId": "cm..."
    }
  ],
  "total": 42,
  "limit": 100,
  "offset": 0
}
```

### `GET /api/ai-requests/:id`

Get single AI request with all fields including `fullRequest`, `fullResponse`, `messages`, `systemPrompt`, `userMessages`, `assistantResponse`, and the associated `requestLog`.

### `GET /api/ai-requests/search/prompt`

Full-text search across system prompts, user messages, assistant responses, and full conversation messages.

| Param | Type | Description |
|---|---|---|
| `q` | string | Search query (min 2 chars, required) |
| `limit` | int | Max results (default 50, max 200) |
| `offset` | int | Pagination offset |
| `hasToolCalls` | `"true"` / `"false"` | Filter by tool usage |
| `provider` | string | Filter by provider |
| `model` | string | Filter by model (substring) |

### `POST /api/ai-requests/:id/replay`

Prepare an AI request replay with optional modifications. Returns modified request data for the frontend to execute (does not send the request itself).

**Body (all optional):**
```json
{
  "model": "openai/gpt-4o",
  "temperature": 0.7,
  "maxTokens": 2000,
  "systemPrompt": "You are a helpful assistant.",
  "messages": [...]
}
```

**Response:**
```json
{
  "replayData": {
    "targetUrl": "https://openrouter.ai",
    "path": "/api/v1/chat/completions",
    "fullUrl": "https://openrouter.ai/api/v1/chat/completions",
    "method": "POST",
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer ..." },
    "body": { ... }
  },
  "original": { "id": "...", "model": "...", "provider": "..." },
  "modifications": { "model": "openai/gpt-4o", "temperature": 0.7 }
}
```

### `GET /api/ai-requests/templates`

Get recurring system prompt templates (grouped by first 200 chars of system prompt, appearing more than once).

### `GET /api/ai-requests/:id/similar`

Find requests with the same system prompt as the given request.

---

## Statistics

### `GET /api/stats`

Aggregated statistics.

| Param | Type | Description |
|---|---|---|
| `from` | ISO date | Start date |
| `to` | ISO date | End date |

**Response:**
```json
{
  "totalRequests": 1000,
  "totalAiRequests": 500,
  "totalErrors": 12,
  "requestsByMethod": { "POST": 480, "GET": 520 },
  "ai": {
    "totalPromptTokens": 500000,
    "totalCompletionTokens": 200000,
    "totalTokens": 700000,
    "totalCostMicros": 140000,
    "totalCostUsd": 0.14,
    "avgDurationMs": 2500,
    "avgTimeToFirstTokenMs": 400,
    "byProvider": [
      { "provider": "openrouter", "count": 400, "totalTokens": 600000, "totalCostMicros": 120000 }
    ],
    "byModel": [
      { "model": "anthropic/claude-sonnet-4", "count": 200, "totalTokens": 300000, "totalCostMicros": 60000 }
    ]
  },
  "openrouter": {
    "enrichedCount": 380,
    "totalCostUsd": 0.12,
    "totalCacheDiscountUsd": 0.01,
    "totalReasoningTokens": 5000,
    "totalCachedTokens": 50000,
    "byActualProvider": [
      { "provider": "Anthropic", "count": 200, "totalTokens": 300000, "totalCostUsd": 0.06 }
    ]
  }
}
```

---

## Routing Rules

### `GET /api/routing-rules`

List all routing rules (ordered by priority descending).

### `POST /api/routing-rules`

Create a routing rule.

**Body:**
```json
{
  "name": "OpenAI Direct",
  "priority": 10,
  "enabled": true,
  "matchType": "path_prefix",
  "matchPattern": "/v1/chat",
  "matchHeader": null,
  "targetUrl": "https://api.openai.com"
}
```

`matchType` values: `path_regex`, `header_regex`, `path_prefix`

### `PUT /api/routing-rules/:id`

Update a routing rule. All fields optional.

### `DELETE /api/routing-rules/:id`

Delete a routing rule.

---

## Config

### `GET /api/config`

Get current configuration.

**Response:**
```json
{
  "id": "default",
  "defaultTargetUrl": "https://openrouter.ai",
  "logEnabled": true,
  "maxBodySize": 1048576,
  "aiDetectionEnabled": true,
  "updatedAt": "2026-02-22T12:00:00.000Z"
}
```

### `PUT /api/config`

Update configuration. All fields optional.

**Body:**
```json
{
  "defaultTargetUrl": "https://openrouter.ai",
  "logEnabled": true,
  "maxBodySize": 1048576,
  "aiDetectionEnabled": true
}
```

---

## Model Info

### `GET /api/models/:modelId`

Get model metadata (context window, pricing). Uses OpenRouter as data source. Supports slash-separated IDs like `anthropic/claude-sonnet-4`.

**Response:**
```json
{
  "id": "anthropic/claude-sonnet-4",
  "name": "Claude Sonnet 4",
  "context_length": 200000,
  "pricing": { "prompt": 0.000003, "completion": 0.000015 },
  "source": "openrouter"
}
```

### `GET /api/models/:modelId/from-request/:requestId`

Get model info with auth replay. Fetches the provider's `/v1/models` endpoint using the Authorization header from the specified request log. Falls back to OpenRouter if provider lookup fails.

### `GET /api/models/:modelId/context-length`

Convenience endpoint returning only the context length.

**Response:** `{ "modelId": "anthropic/claude-sonnet-4", "context_length": 200000 }`

### `GET /api/openrouter/models/:modelId`

Direct OpenRouter model lookup (bypasses provider prefix guessing).

### `GET /api/openrouter/models`

List all OpenRouter models.

**Response:** `{ "models": [...], "count": 1234 }`

### `GET /api/models/cache-stats`

Cache statistics for the model info system.

### `POST /api/openrouter/refresh-cache`

Force-refresh the OpenRouter model cache.

---

## AI Model Pricing

Custom pricing rules used for cost calculation when provider doesn't report costs.

### `GET /api/pricing`

List all pricing rules.

### `POST /api/pricing`

Create or update a pricing rule.

**Body:**
```json
{
  "provider": "openai",
  "modelPattern": "^gpt-4o$",
  "inputPricePerMillion": 2500,
  "outputPricePerMillion": 10000
}
```

`modelPattern` is a regex matched against the model name. Prices are in micro-dollars per 1M tokens.

### `DELETE /api/pricing/:id`

Delete a pricing rule.

---

## Proxy

The proxy runs on port 3101 (default). Three ways to specify the target:

```bash
# 1. Query parameter
curl "http://localhost:3101/v1/chat/completions?__target=https://api.openai.com"

# 2. X-Target-URL header
curl -H "X-Target-URL: https://api.openai.com" http://localhost:3101/v1/chat/completions

# 3. Default target (set via /api/config)
curl http://localhost:3101/v1/chat/completions
```
