#!/bin/bash
# =============================================================================
# Seed Test Data - Sends requests through the proxy to create realistic logs
# =============================================================================
# Usage: bash scripts/seed-test-data.sh
#
# This script sends various HTTP requests through the proxy (port 3101)
# to create test data visible on the dashboard (port 3100).
#
# The proxy forwards each request to the target specified via __target param.
# We use httpbin.org as a target - it's a free HTTP testing service that
# echoes back whatever you send it.
# =============================================================================

PROXY="http://localhost:3101"
TARGET="https://httpbin.org"

echo "========================================="
echo "  Seeding test data through the proxy"
echo "  Proxy: $PROXY"
echo "  Target: $TARGET"
echo "========================================="
echo ""

# --- Group 1: Basic GET requests (like loading pages) ---
echo "[1/7] Sending basic GET requests..."
curl -s -o /dev/null -w "  GET /get -> %{http_code} (%{time_total}s)\n" \
  "$PROXY/get?__target=$TARGET"

curl -s -o /dev/null -w "  GET /html -> %{http_code} (%{time_total}s)\n" \
  "$PROXY/html?__target=$TARGET"

curl -s -o /dev/null -w "  GET /json -> %{http_code} (%{time_total}s)\n" \
  "$PROXY/json?__target=$TARGET"

curl -s -o /dev/null -w "  GET /ip -> %{http_code} (%{time_total}s)\n" \
  "$PROXY/ip?__target=$TARGET"

curl -s -o /dev/null -w "  GET /user-agent -> %{http_code} (%{time_total}s)\n" \
  "$PROXY/user-agent?__target=$TARGET"

# --- Group 2: Different HTTP methods ---
echo ""
echo "[2/7] Sending POST/PUT/PATCH/DELETE requests..."
curl -s -o /dev/null -w "  POST /post -> %{http_code} (%{time_total}s)\n" \
  -X POST "$PROXY/post?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","action":"create_account"}'

curl -s -o /dev/null -w "  PUT /put -> %{http_code} (%{time_total}s)\n" \
  -X PUT "$PROXY/put?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"updated@example.com"}'

curl -s -o /dev/null -w "  PATCH /patch -> %{http_code} (%{time_total}s)\n" \
  -X PATCH "$PROXY/patch?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -d '{"email":"patched@example.com"}'

curl -s -o /dev/null -w "  DELETE /delete -> %{http_code} (%{time_total}s)\n" \
  -X DELETE "$PROXY/delete?__target=$TARGET"

# --- Group 3: Different status codes ---
echo ""
echo "[3/7] Triggering various status codes..."
curl -s -o /dev/null -w "  GET /status/200 -> %{http_code}\n" \
  "$PROXY/status/200?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/201 -> %{http_code}\n" \
  "$PROXY/status/201?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/301 -> %{http_code}\n" \
  "$PROXY/status/301?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/400 -> %{http_code}\n" \
  "$PROXY/status/400?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/401 -> %{http_code}\n" \
  "$PROXY/status/401?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/403 -> %{http_code}\n" \
  "$PROXY/status/403?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/404 -> %{http_code}\n" \
  "$PROXY/status/404?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/500 -> %{http_code}\n" \
  "$PROXY/status/500?__target=$TARGET"

curl -s -o /dev/null -w "  GET /status/503 -> %{http_code}\n" \
  "$PROXY/status/503?__target=$TARGET"

# --- Group 4: Delayed responses (test response time display) ---
echo ""
echo "[4/7] Sending delayed requests (testing response time)..."
curl -s -o /dev/null -w "  GET /delay/1 -> %{http_code} (%{time_total}s)\n" \
  "$PROXY/delay/1?__target=$TARGET"

curl -s -o /dev/null -w "  GET /delay/3 -> %{http_code} (%{time_total}s)\n" \
  "$PROXY/delay/3?__target=$TARGET"

# --- Group 5: AI-like requests (will be detected as AI by the proxy) ---
echo ""
echo "[5/7] Sending AI-like requests (OpenAI format)..."

# OpenAI chat completion format
curl -s -o /dev/null -w "  POST /v1/chat/completions -> %{http_code}\n" \
  -X POST "$PROXY/v1/chat/completions?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-test-dummy-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "max_tokens": 100
  }'

curl -s -o /dev/null -w "  POST /v1/chat/completions -> %{http_code}\n" \
  -X POST "$PROXY/v1/chat/completions?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-test-dummy-key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Write a haiku about programming"}
    ],
    "max_tokens": 50
  }'

# Anthropic format
curl -s -o /dev/null -w "  POST /v1/messages -> %{http_code}\n" \
  -X POST "$PROXY/v1/messages?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-ant-test-dummy-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "messages": [
      {"role": "user", "content": "Explain quantum computing in simple terms"}
    ],
    "max_tokens": 200
  }'

# Another AI request
curl -s -o /dev/null -w "  POST /v1/chat/completions -> %{http_code}\n" \
  -X POST "$PROXY/v1/chat/completions?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "system", "content": "You are a code reviewer."},
      {"role": "user", "content": "Review this function: function add(a, b) { return a + b; }"}
    ]
  }'

# --- Group 6: Requests with different content types ---
echo ""
echo "[6/7] Sending requests with various content types..."
curl -s -o /dev/null -w "  POST /post (form data) -> %{http_code}\n" \
  -X POST "$PROXY/post?__target=$TARGET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=secret123"

curl -s -o /dev/null -w "  POST /post (XML) -> %{http_code}\n" \
  -X POST "$PROXY/post?__target=$TARGET" \
  -H "Content-Type: application/xml" \
  -d '<user><name>TestUser</name><role>admin</role></user>'

# --- Group 7: Rapid burst (tests grouping) ---
echo ""
echo "[7/7] Sending burst of related requests (for grouping test)..."
for i in {1..5}; do
  curl -s -o /dev/null -w "  GET /anything/api/users/$i -> %{http_code}\n" \
    "$PROXY/anything/api/users/$i?__target=$TARGET"
done

for i in {1..3}; do
  curl -s -o /dev/null -w "  GET /anything/api/products/$i -> %{http_code}\n" \
    "$PROXY/anything/api/products/$i?__target=$TARGET"
done

# --- Group 8: Project-Tag header (groups traffic by project in the dashboard) ---
echo ""
echo "[8/8] Sending requests tagged with a Project-Tag header..."
for tag in checkout-service billing-worker data-pipeline; do
  curl -s -o /dev/null -w "  GET /get (Project-Tag: $tag) -> %{http_code}\n" \
    "$PROXY/get?__target=$TARGET" \
    -H "Project-Tag: $tag"
done

# A tagged AI request, so the project tag shows alongside the model chip
curl -s -o /dev/null -w "  POST /v1/chat/completions (Project-Tag: billing-worker) -> %{http_code}\n" \
  -X POST "$PROXY/v1/chat/completions?__target=$TARGET" \
  -H "Content-Type: application/json" \
  -H "Project-Tag: billing-worker" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Summarize this invoice"}]}'

echo ""
echo "========================================="
echo "  Done! Check http://localhost:3100"
echo "========================================="
