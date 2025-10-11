#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-${REPLIT_URL:-}}"
if [[ -z "${HOST}" ]]; then
  echo "Usage: ./scripts/smoke.sh https://<your-public-host>"
  echo "  Or set REPLIT_URL env var and run: npm run smoke"
  exit 1
fi

echo "→ Testing MCP Service at: $HOST"
echo ""

echo "→ Health check"
curl -fsS "$HOST/healthz" | jq . || { echo "❌ Health check failed"; exit 1; }
echo ""

echo "→ Contracts"
curl -fsS "$HOST/contracts" | jq . || { echo "❌ Contracts failed"; exit 1; }
echo ""

echo "→ Debug token-provider"
curl -fsS "$HOST/debug/token-provider" | jq . || { echo "❌ Debug endpoint failed"; exit 1; }
echo ""

echo "→ Tool test: calendar.next_events.v1 (with bearer auth)"
AUTH_KEY="${DEV_LOCAL_TOOL_KEY:-${MCP_SERVICE_TOKEN:-}}"
if [[ -z "${AUTH_KEY}" ]]; then
  echo "⚠️  DEV_LOCAL_TOOL_KEY or MCP_SERVICE_TOKEN not set - skipping tool test"
else
  curl -fsS -X POST "$HOST/mcp/calendar.next_events.v1" \
    -H "Authorization: Bearer ${AUTH_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-effective-user: test-user" \
    --data '{"daysAhead":1}' | jq . || { echo "❌ Tool test failed"; exit 1; }
fi
echo ""

echo "✅ All smoke tests passed!"
