# Request Interceptor

A man-in-the-middle HTTP proxy that logs requests/responses and provides special handling for AI API calls.

## What it does

- Proxies HTTP requests to configurable targets
- Logs all requests and responses with timing data
- Detects AI API calls (OpenAI, Anthropic, OpenRouter, Azure) and extracts usage/cost data
- Provides a web dashboard for viewing logs
- Supports SSE streaming

## Quick Start

```bash
docker compose up -d
```

- **Dashboard**: http://localhost:3100
- **Proxy**: http://localhost:3101

Default login: `admin` / `changeme`

## Usage

Requests need a target. Three ways to specify it:

```bash
# 1. Query parameter
curl "http://localhost:3101/api/users?__target=https://api.example.com"

# 2. Header
curl -H "X-Target-URL: https://api.example.com" http://localhost:3101/api/users

# 3. Configure a default target or routing rules in the dashboard
```

### AI API Example

```bash
curl "http://localhost:3101/v1/chat/completions" \
  -H "X-Target-URL: https://api.openai.com" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello"}]}'
```

The proxy will log the request, detect it as an AI call, and extract token usage and cost estimates.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT_ADMIN` | 3000 | Dashboard port |
| `PORT_PROXY` | 3001 | Proxy port |
| `ADMIN_USER` | admin | Dashboard username |
| `ADMIN_PASSWORD` | changeme | Dashboard password |
| `DATABASE_URL` | file:/data/app.db | SQLite database path |

## Data Retention

- Request logs are deleted after 30 days
- Authorization headers are redacted after 3 days

## Development

```bash
# Backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

## License

MIT

---

<sub>Built by [DPA+](https://dpa.plus)</sub>
