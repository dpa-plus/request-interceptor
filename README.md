# Request Interceptor

> A self-hosted man-in-the-middle proxy for observing, debugging, and understanding HTTP traffic — with first-class support for LLM APIs.

![Dashboard screenshot](docs/screenshot.png)

Point any HTTP client at Request Interceptor instead of your real backend, and every call is captured, parsed, and streamed into a live dashboard. When the request is an AI API call, it is automatically decoded into a readable conversation view with token usage, cost estimates, tool calls, and streaming timing — so you can see *exactly* what your app is sending to OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint.

---

## Features

### Full request/response capture
- Transparent HTTP proxy — drop it in front of any service, no client-side changes
- Request **and** response bodies, headers, status codes, and latency
- Server-Sent Events (SSE) streaming is reconstructed, not broken
- Full-text search across URLs, paths, and bodies
- Filter by method, status, AI model, date range, or error

### Live dashboard
- New requests appear in real time via Socket.IO — no refresh, no polling
- Split-pane layout: scrollable request list on the left, tabbed detail panel on the right
- Detail tabs for **Conversation**, **Request**, **Response**, **Headers**, **Raw** and **cURL** (one-click copy)
- Keyboard-friendly navigation through the log stream

### AI-aware
- Auto-detects calls to OpenAI, Anthropic, Azure OpenAI, OpenRouter, and generic OpenAI-compatible endpoints
- Extracts **model, tokens (prompt/completion/cached/reasoning), cost, time-to-first-token, and total duration**
- Renders multi-turn conversations with system prompts, user/assistant messages, **tool calls**, tool results, and multimodal hints (images, audio)
- Dedicated **AI Dashboard** with aggregate stats by provider and by model — spend, token counts, average latency
- OpenRouter enrichment: pulls the actual upstream provider, cache discount, and reasoning-token breakdown after the fact

### Flexible routing
- Set a default target, or specify one per request via `?__target=` or an `X-Target-URL` header
- Define **routing rules** in the dashboard — match by path prefix, path regex, or header — and forward each pattern to a different upstream
- Priority-ordered rules, toggleable on/off without a redeploy

### Built-in hygiene
- Request logs are automatically pruned after 30 days
- Authorization headers, API keys, and cookies are redacted after 3 days — you keep the trace, not the secret
- HTTP basic auth + rate-limited API on the admin side

---

## Quick Start

```bash
docker compose up -d
```

Two ports come up:

- **Dashboard** → `3100` (the UI + API)
- **Proxy** → `3101` (point your clients here)

Default login: `admin` / `changeme` — change this before exposing the dashboard.

---

## Usage

Every proxied request needs a target upstream. Pick whichever fits your setup.

### 1. Per-request via query parameter

```bash
curl "https://interceptor-proxy.example.com/api/users?__target=https://api.internal.example.com"
```

### 2. Per-request via header

```bash
curl -H "X-Target-URL: https://api.internal.example.com" \
  https://interceptor-proxy.example.com/api/users
```

### 3. Default target or routing rules

Set `TARGET_URL` in the environment for a single default upstream, or define path- and header-based routing rules in the dashboard to split traffic across multiple backends.

### Intercepting an AI call

```bash
curl "https://interceptor-proxy.example.com/v1/chat/completions" \
  -H "X-Target-URL: https://api.openai.com" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello"}]}'
```

The call is forwarded to OpenAI and the response is streamed back to your client unchanged. In the dashboard you get the parsed conversation, token counts, cost estimate, and per-chunk streaming timing.

---

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT_ADMIN` | `3000` | Dashboard + API port (inside the container) |
| `PORT_PROXY` | `3001` | Proxy port (inside the container) |
| `TARGET_URL` | — | Default upstream when no target is specified on the request |
| `ADMIN_USER` | `admin` | Dashboard username |
| `ADMIN_PASSWORD` | `changeme` | Dashboard password |
| `DATABASE_URL` | `file:/data/app.db` | SQLite database path |

A single Docker volume (`/data`) holds the SQLite database — back that up and you have your entire history.

---

## Data Retention

- Full request logs kept for **30 days**, then deleted
- Sensitive headers (`Authorization`, `X-API-Key`, `Cookie`, …) redacted to `[REDACTED]` after **3 days**

Both run hourly inside the container — no external scheduler required.

---

## License

MIT

---

<sub>Built by [DPA+](https://dpa.plus)</sub>
