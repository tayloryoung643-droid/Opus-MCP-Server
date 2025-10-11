#!/usr/bin/env bash
set -euo pipefail

# Use jq if available, otherwise use cat
if command -v jq &> /dev/null; then
  JSON_FORMATTER="jq ."
else
  JSON_FORMATTER="cat"
fi

HOST="${1:-${REPLIT_URL:-}}"
if [[ -z "${HOST}" ]]; then
  echo "Usage: ./scripts/smoke.sh https://<your-public-host>"
  echo "  Or set REPLIT_URL env var and run: npm run smoke"
  exit 1
fi

echo "→ Testing MCP Service at: $HOST"
echo ""

echo "→ Health check"
curl -fsS "$HOST/healthz" | $JSON_FORMATTER || { echo "❌ Health check failed"; exit 1; }
echo ""

echo "→ Contracts"
curl -fsS "$HOST/contracts" | $JSON_FORMATTER || { echo "❌ Contracts failed"; exit 1; }
echo ""

echo "→ Debug token-provider"
curl -fsS "$HOST/debug/token-provider" | $JSON_FORMATTER || { echo "❌ Debug endpoint failed"; exit 1; }
echo ""

echo "→ Tool test: calendar.next_events.v1 (with bearer auth)"
AUTH_KEY="${DEV_LOCAL_TOOL_KEY:-${MCP_SERVICE_TOKEN:-}}"
if [[ -z "${AUTH_KEY}" ]]; then
  echo "⚠️  DEV_LOCAL_TOOL_KEY or MCP_SERVICE_TOKEN not set - skipping tool test"
else
  RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "$HOST/mcp/calendar.next_events.v1" \
    -H "Authorization: Bearer ${AUTH_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-effective-user: test-user" \
    --data '{"daysAhead":1}')
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | head -n-1)
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "$BODY" | $JSON_FORMATTER
    echo "✅ Tool returned data successfully"
  elif [[ "$HTTP_CODE" == "401" ]] && echo "$BODY" | grep -q "NOT_CONNECTED"; then
    echo "$BODY" | $JSON_FORMATTER
    echo "ℹ️  Tool authenticated but integration not connected (expected if Google/Salesforce not set up)"
  else
    echo "$BODY" | $JSON_FORMATTER
    echo "❌ Tool test failed with HTTP $HTTP_CODE"
    exit 1
  fi
fi
echo ""

echo "✅ All smoke tests passed!"
