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

echo "→ Google connection status"
USER_ID="${USER_ID:-test-user}"
curl -fsS "$HOST/me/google?userId=${USER_ID}" | $JSON_FORMATTER || { echo "❌ Connection status check failed"; exit 1; }
echo ""

echo "→ Tool test: calendar.next_events.v1 (with bearer auth)"
AUTH_KEY="${DEV_LOCAL_TOOL_KEY:-${MCP_SERVICE_TOKEN:-}}"
if [[ -z "${AUTH_KEY}" ]]; then
  echo "⚠️  DEV_LOCAL_TOOL_KEY or MCP_SERVICE_TOKEN not set - skipping tool test"
else
  # Calculate dates for calendar query
  TIME_MIN=$(date -u +%Y-%m-%dT00:00:00Z)
  TIME_MAX=$(date -u -d '+7 day' +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -v+7d +%Y-%m-%dT00:00:00Z)
  
  RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "$HOST/mcp/calendar.next_events.v1" \
    -H "Authorization: Bearer ${AUTH_KEY}" \
    -H "Content-Type: application/json" \
    --data "{\"userId\":\"${USER_ID}\",\"daysAhead\":7}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | head -n-1)
  
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "$BODY" | $JSON_FORMATTER
    echo "✅ Tool returned calendar data successfully"
  elif [[ "$HTTP_CODE" == "401" ]] && echo "$BODY" | grep -q "NOT_CONNECTED"; then
    echo "$BODY" | $JSON_FORMATTER
    echo "ℹ️  Tool authenticated but Google not connected"
    echo "   Connect at: $HOST/connect?userId=${USER_ID}"
  else
    echo "$BODY" | $JSON_FORMATTER
    echo "❌ Tool test failed with HTTP $HTTP_CODE"
    exit 1
  fi
fi
echo ""

echo "→ Save prep (prep.save.v1)"
if [[ -z "${AUTH_KEY}" ]]; then
  echo "⚠️  DEV_LOCAL_TOOL_KEY or MCP_SERVICE_TOKEN not set - skipping prep.save test"
else
  curl -fsS -X POST "$HOST/mcp/prep.save.v1" \
    -H "Authorization: Bearer ${AUTH_KEY}" \
    -H "Content-Type: application/json" \
    --data "{\"userId\":\"${USER_ID:-test-user}\",\"eventId\":\"demo-event\",\"sections\":{\"snapshot\":\"demo\",\"lastContact\":[],\"priorities\":[],\"risks\":[],\"questions\":[],\"agenda\":[]}}" | $JSON_FORMATTER || { echo "❌ prep.save test failed"; exit 1; }
  echo "✅ prep.save.v1 test passed"
fi
echo ""

echo "✅ All smoke tests passed!"
