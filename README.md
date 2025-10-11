# Opus MCP Service

A standalone Model Context Protocol (MCP) service providing HTTP REST API access to calendar, CRM, email, and database tools.

## Quick Start

### 1. Connect Google (First Time Setup)

Before tools can access Google Calendar & Gmail, connect your Google account:

1. **Start server**: `npm run dev`
2. **Open connect page**: Navigate to `https://<your-public-url>/connect?userId=<your-user-id>`
3. **Authorize**: Click "Authorize Google Calendar & Gmail" and complete OAuth flow
4. **Verify**: Check status at `/me/google?userId=<your-user-id>` - should show `{"connected":true}`

> **Required Secrets** (set in Replit Secrets):
> - `GOOGLE_CLIENT_ID` - Your Google OAuth client ID
> - `GOOGLE_CLIENT_SECRET` - Your Google OAuth client secret  
> - `GOOGLE_OAUTH_REDIRECT_URI` - Your callback URL (e.g., `https://<public-host>/auth/google/callback`)
> - `MCP_SERVICE_TOKEN` - Service auth token (min 10 chars)

### 2. Test in 60 Seconds

1. **Start server**: `npm run dev`
2. **Copy your public URL** from the console log (looks like `https://<repl-name>.<username>.repl.co`)
3. **Set env for this shell**:
   ```bash
   export HOST='https://<your-public-host>'
   export MCP_SERVICE_TOKEN='<your-token>'
   export USER_ID='<your-user-id>'  # Optional, defaults to test-user
   ```
4. **Run smoke test**:
   ```bash
   npm run smoke
   ```

Expected output: Health, contracts, connection status, and calendar data (if connected) or helpful error messages.

## Features

- 8 versioned tools for AI agents:
  - `calendar.next_events.v1` - Get upcoming calendar events
  - `gmail.search_threads.v1` - Search Gmail threads
  - `gmail.read_thread.v1` - Read Gmail thread by ID
  - `salesforce.lookup_account.v1` - Lookup Salesforce account
  - `salesforce.lookup_opportunity.v1` - Lookup Salesforce opportunity
  - `db.search_prep_notes.v1` - Search call prep notes
  - `db.call_history.v1` - Get call history
  - `prep.generate.v1` - Generate call prep (stub)

- Bearer token authentication
- Structured error handling
- CORS support
- Health checks and contract discovery

## Replit Deployment

### Starting the Service

1. **Click the Run button** in Replit (uses `.replit` configuration)
2. The service will start via `npm run dev` and bind to port 8000
3. **Do NOT start from shell separately** or you'll get "Port already in use" errors

### Verifying the Service

The console should show:
```
[config] port=8000, tokenLen=48
[MCP-Server] Listening on http://0.0.0.0:8000 (source: PORT)
[MCP-Server] Health: GET /healthz   Contracts: GET /contracts
```

### Endpoints

**Public Endpoints:**
- `GET /` - Returns "Opus MCP OK"
- `GET /healthz` - Health check
- `GET /contracts` - List all tools with paths
- `GET /connect?userId=<id>` - OAuth connection page
- `GET /me/google?userId=<id>` - Check Google connection status
- `GET /admin/connections` - List all connected users

**OAuth Flow:**
- `GET /auth/google?userId=<id>` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback (automatic)
- `POST /auth/google/disconnect?userId=<id>` - Disconnect Google

**Tool Endpoints (require bearer auth):**
- `POST /mcp/<tool-name>` - Execute a tool (requires `Authorization: Bearer <token>`)

### Troubleshooting

If you get "Port already in use" errors:

```bash
pkill -f "node.*src/server.ts" || true
pkill -f tsx || true
```

Then click Run once.

### Public URL

The service is accessible at the public Replit URL. Only the Run process is publicly accessible.

## Authentication

All tool endpoints require a bearer token:

```
Authorization: Bearer <MCP_SERVICE_TOKEN>
```

Set `MCP_SERVICE_TOKEN` in your environment secrets (minimum 10 characters).

## Environment Variables

Required:
- `MCP_SERVICE_TOKEN` or `MCP_SECRET_TOKEN` - Service authentication token
- `DATABASE_URL` - Neon Postgres connection string

Optional:
- `PORT` or `MCP_PORT` - Server port (default: 4000, Replit assigns 8000)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` - Google OAuth
- `SFDC_CLIENT_ID`, `SFDC_CLIENT_SECRET` - Salesforce OAuth
- `APP_ORIGIN`, `API_ORIGIN` - CORS allowed origins
