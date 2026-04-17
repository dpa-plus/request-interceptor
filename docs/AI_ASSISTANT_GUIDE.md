# Request Interceptor - AI Assistant Guide

Du bist ein AI-Assistent, der auf die Admin-API eines HTTP-Request-Interceptor-Proxys zugreifen kann. Der Proxy loggt alle HTTP-Requests, erkennt AI-API-Calls automatisch und extrahiert Token-Usage, Kosten und Conversation-Daten.

## Verbindung

```
BASE_URL=http://localhost:3100
AUTH="admin:changeme"
```

Alle Befehle nutzen HTTP Basic Auth. Passe `BASE_URL` und `AUTH` an deine Umgebung an.

## Quick-Check: Ist der Service erreichbar?

```bash
curl -s http://localhost:3100/api/health | jq .
```

---

## 1. Letzte Requests anzeigen

```bash
# Letzte 20 Requests (alle)
curl -s -u admin:changeme "http://localhost:3100/api/logs?limit=20" | jq '.logs[] | {id, method, path, statusCode, isAiRequest, targetUrl, createdAt}'

# Nur AI-Requests
curl -s -u admin:changeme "http://localhost:3100/api/logs?isAiRequest=true&limit=20" | jq '.logs[] | {id, method, path, statusCode, aiRequest: .aiRequest | {provider, model, totalTokens, totalCostMicros}, createdAt}'

# Nur POST-Requests
curl -s -u admin:changeme "http://localhost:3100/api/logs?method=POST&limit=20" | jq '.logs[] | {id, path, statusCode, createdAt}'

# Nur Fehler (Status >= 400)
curl -s -u admin:changeme "http://localhost:3100/api/logs?limit=100" | jq '[.logs[] | select(.statusCode >= 400)] | .[] | {id, method, path, statusCode, error, createdAt}'

# Nach Zeitraum filtern
curl -s -u admin:changeme "http://localhost:3100/api/logs?from=2026-02-22T00:00:00Z&to=2026-02-22T23:59:59Z&limit=100" | jq '.total'

# Volltextsuche in URL, Path, Body
curl -s -u admin:changeme "http://localhost:3100/api/logs?search=chat/completions&limit=20" | jq '.logs[] | {id, path, statusCode, createdAt}'

# Requests an bestimmten Upstream
curl -s -u admin:changeme "http://localhost:3100/api/logs?targetUrl=openrouter.ai&limit=20" | jq '.logs[] | {id, path, targetUrl, createdAt}'
```

## 2. Einzelnen Request im Detail anschauen

```bash
# Voller Request-Log inkl. Headers, Body, Response, AI-Daten
curl -s -u admin:changeme "http://localhost:3100/api/logs/REQUEST_LOG_ID" | jq .

# Nur die Request-Headers
curl -s -u admin:changeme "http://localhost:3100/api/logs/REQUEST_LOG_ID" | jq '.headers | fromjson'

# Nur den Request-Body
curl -s -u admin:changeme "http://localhost:3100/api/logs/REQUEST_LOG_ID" | jq '.body | fromjson'

# Nur den Response-Body
curl -s -u admin:changeme "http://localhost:3100/api/logs/REQUEST_LOG_ID" | jq '.responseBody | fromjson'
```

## 3. AI-Requests durchsuchen

```bash
# Alle AI-Requests auflisten
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests?limit=20" | jq '.aiRequests[] | {id, provider, model, totalTokens, totalCostMicros, hasToolCalls, toolNames, totalDuration, requestLogId, createdAt}'

# Nach Provider filtern
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests?provider=openrouter&limit=20" | jq '.aiRequests[] | {id, model, totalTokens, openrouterProviderName, openrouterTotalCost}'

# Nach Model filtern (Substring-Match)
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests?model=claude&limit=20" | jq '.aiRequests[] | {id, model, totalTokens, totalCostMicros}'

# Einzelnen AI-Request mit ALLEN Details (inkl. fullRequest, fullResponse, messages)
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID" | jq .

# Nur die Conversation-Messages extrahieren
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID" | jq '.messages | fromjson'

# Nur den System-Prompt
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID" | jq '.systemPrompt'

# Nur die Assistant-Antwort
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID" | jq '.assistantResponse'

# Vollständigen Original-Request (wie er an den Provider ging)
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID" | jq '.fullRequest | fromjson'

# Vollständige Response vom Provider
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID" | jq '.fullResponse | fromjson'
```

## 4. Prompts durchsuchen (Volltextsuche)

```bash
# Suche in System-Prompts, User-Messages, Assistant-Responses
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/search/prompt?q=transkribiere" | jq '.results[] | {id, provider, model, totalTokens, createdAt}'

# Suche mit Filtern
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/search/prompt?q=function+calling&hasToolCalls=true&provider=openrouter" | jq '.results[] | {id, model, toolNames, createdAt}'

# Nur Anzahl der Treffer
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/search/prompt?q=error" | jq '.total'
```

## 5. Statistiken & Kosten

```bash
# Gesamtstatistiken
curl -s -u admin:changeme "http://localhost:3100/api/stats" | jq '{totalRequests, totalAiRequests, totalErrors, aiCostUsd: .ai.totalCostUsd, avgDurationMs: .ai.avgDurationMs}'

# Kosten pro Model
curl -s -u admin:changeme "http://localhost:3100/api/stats" | jq '.ai.byModel[] | {model, count, costUsd: (.totalCostMicros / 1000000)}'

# Kosten pro Provider
curl -s -u admin:changeme "http://localhost:3100/api/stats" | jq '.ai.byProvider[] | {provider, count, costUsd: (.totalCostMicros / 1000000)}'

# OpenRouter-spezifisch: Cache-Savings, Reasoning-Tokens, tatsächliche Provider
curl -s -u admin:changeme "http://localhost:3100/api/stats" | jq '.openrouter'

# Statistiken für Zeitraum
curl -s -u admin:changeme "http://localhost:3100/api/stats?from=2026-02-01T00:00:00Z&to=2026-02-28T23:59:59Z" | jq '{totalRequests, aiCostUsd: .ai.totalCostUsd}'
```

## 6. Ähnliche Requests und Templates finden

```bash
# Wiederkehrende System-Prompts (Templates)
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/templates" | jq '.templates[] | {preview: .preview[0:80], count, models, avgTokens}'

# Requests mit dem gleichen System-Prompt wie ein bestimmter Request
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID/similar" | jq '{count, similar: [.similar[] | {id, model, totalTokens, createdAt}]}'
```

## 7. Request Replay vorbereiten

```bash
# Replay mit anderem Model
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID/replay" \
  -X POST -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o"}' | jq .

# Replay mit angepasster Temperature
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID/replay" \
  -X POST -H "Content-Type: application/json" \
  -d '{"temperature": 0.2, "maxTokens": 500}' | jq .
```

Das Replay gibt die vollständigen Daten zurück (URL, Headers inkl. Auth, Body), die du direkt als curl ausführen kannst:

```bash
# Replay-Daten holen und als curl ausführen
REPLAY=$(curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID/replay" -X POST -H "Content-Type: application/json" -d '{}')
URL=$(echo $REPLAY | jq -r '.replayData.fullUrl')
AUTH_HEADER=$(echo $REPLAY | jq -r '.replayData.headers.Authorization')
BODY=$(echo $REPLAY | jq -c '.replayData.body')

curl -s "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: $AUTH_HEADER" \
  -d "$BODY" | jq .
```

## 8. Model-Info nachschlagen

```bash
# Context-Window und Pricing eines Models
curl -s -u admin:changeme "http://localhost:3100/api/models/anthropic%2Fclaude-sonnet-4" | jq '{name, context_length, pricing, source}'

# Nur Context-Length
curl -s -u admin:changeme "http://localhost:3100/api/models/openai%2Fgpt-4o/context-length" | jq .

# Model-Info mit Auth-Replay vom Provider selbst (nutzt Auth-Header eines bestehenden Requests)
curl -s -u admin:changeme "http://localhost:3100/api/models/anthropic%2Fclaude-sonnet-4/from-request/REQUEST_LOG_ID" | jq .

# Alle OpenRouter-Models auflisten
curl -s -u admin:changeme "http://localhost:3100/api/openrouter/models" | jq '.count'

# Model in OpenRouter suchen
curl -s -u admin:changeme "http://localhost:3100/api/openrouter/models" | jq '[.models[] | select(.id | test("claude")) | {id, name, context_length}]'
```

## 9. Routing-Regeln verwalten

```bash
# Alle Regeln anzeigen
curl -s -u admin:changeme "http://localhost:3100/api/routing-rules" | jq '.[] | {id, name, enabled, matchType, matchPattern, targetUrl, priority}'

# Regel erstellen
curl -s -u admin:changeme "http://localhost:3100/api/routing-rules" \
  -X POST -H "Content-Type: application/json" \
  -d '{"name": "OpenAI Direct", "matchType": "path_prefix", "matchPattern": "/v1/chat", "targetUrl": "https://api.openai.com", "priority": 10}' | jq .

# Regel deaktivieren
curl -s -u admin:changeme "http://localhost:3100/api/routing-rules/RULE_ID" \
  -X PUT -H "Content-Type: application/json" \
  -d '{"enabled": false}' | jq .

# Regel löschen
curl -s -u admin:changeme "http://localhost:3100/api/routing-rules/RULE_ID" -X DELETE | jq .
```

## 10. Konfiguration

```bash
# Aktuelle Konfiguration
curl -s -u admin:changeme "http://localhost:3100/api/config" | jq .

# Default-Target ändern
curl -s -u admin:changeme "http://localhost:3100/api/config" \
  -X PUT -H "Content-Type: application/json" \
  -d '{"defaultTargetUrl": "https://openrouter.ai"}' | jq .
```

## 11. Aufräumen

```bash
# Alle Logs löschen
curl -s -u admin:changeme "http://localhost:3100/api/logs" -X DELETE | jq .

# Logs älter als 7 Tage löschen
curl -s -u admin:changeme "http://localhost:3100/api/logs?olderThan=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)" -X DELETE | jq .
```

## 12. Pricing-Regeln

```bash
# Alle Pricing-Regeln
curl -s -u admin:changeme "http://localhost:3100/api/pricing" | jq '.[] | {id, provider, modelPattern, inputPricePerMillion, outputPricePerMillion}'

# Pricing-Regel erstellen (Preise in Micro-Dollar pro 1M Tokens)
curl -s -u admin:changeme "http://localhost:3100/api/pricing" \
  -X POST -H "Content-Type: application/json" \
  -d '{"provider": "openai", "modelPattern": "^gpt-4o$", "inputPricePerMillion": 2500, "outputPricePerMillion": 10000}' | jq .
```

---

## Typische Debugging-Workflows

### "Welcher Request hat den Fehler verursacht?"

```bash
# 1. Fehler-Requests finden
curl -s -u admin:changeme "http://localhost:3100/api/logs?limit=50" | jq '[.logs[] | select(.statusCode >= 400)] | .[] | {id, method, path, statusCode, createdAt}'

# 2. Fehler-Details anschauen
curl -s -u admin:changeme "http://localhost:3100/api/logs/REQUEST_LOG_ID" | jq '{statusCode, error, responseBody: (.responseBody | fromjson? // .responseBody)}'
```

### "Was hat die KI geantwortet?"

```bash
# 1. AI-Request finden
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests?model=claude&limit=5" | jq '.aiRequests[] | {id, model, totalTokens, createdAt}'

# 2. Conversation lesen
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/AI_REQUEST_ID" | jq '{systemPrompt: .systemPrompt[0:200], assistantResponse: .assistantResponse[0:500], totalTokens, totalDuration}'
```

### "Wieviel kostet ein bestimmter Prompt?"

```bash
# Alle Requests mit diesem Prompt-Pattern finden und Kosten summieren
curl -s -u admin:changeme "http://localhost:3100/api/ai-requests/search/prompt?q=transkribiere" | jq '{total: .total, totalCostUsd: ([.results[].totalCostMicros // 0] | add / 1000000), avgTokens: ([.results[].totalTokens // 0] | add / (.total // 1))}'
```

### "Was ging heute über den Proxy?"

```bash
TODAY=$(date -u +%Y-%m-%dT00:00:00Z)
curl -s -u admin:changeme "http://localhost:3100/api/stats?from=$TODAY" | jq '{requests: .totalRequests, aiRequests: .totalAiRequests, errors: .totalErrors, costUsd: .ai.totalCostUsd, topModels: [.ai.byModel[:3][] | {model, count}]}'
```

---

## Hinweise

- **IDs**: Request-Log-IDs und AI-Request-IDs sind CUIDs (z.B. `cm3abc123def456`). Ein Request-Log kann eine zugehörige AI-Request haben (`aiRequestId`). Die AI-Request hat ein Feld `requestLogId` das auf den zugehörigen Log zeigt.
- **Kosten**: `totalCostMicros` ist in Micro-Dollar (1 USD = 1.000.000 Micro-Dollar). Teile durch 1.000.000 für USD.
- **Model-IDs mit Slash**: Bei Model-IDs wie `anthropic/claude-sonnet-4` muss der Slash URL-encoded werden: `anthropic%2Fclaude-sonnet-4`.
- **Streaming**: Bei Streaming-Requests ist `fullResponse` die gesammelte komplette Antwort aus allen SSE-Chunks.
- **OpenRouter Enrichment**: Für OpenRouter-Requests werden zusätzliche Daten asynchron via Generation-API nachgeladen (exakte Kosten, Provider-Name, Cache-Discount, etc.). Felder mit `openrouter`-Prefix.
