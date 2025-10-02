# Opus MCP Service

A standalone Model Context Protocol (MCP) service providing HTTP REST API access to calendar, CRM, email, and database tools.

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

- **Health Check**: `GET /healthz` - Returns `{"ok": true}`
- **Contracts**: `GET /contracts` - Returns all tool schemas
- **Root**: `GET /` - Returns "Opus MCP OK"
- **Tools**: `POST /tools/<tool-name>` - Execute a tool (requires auth)

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
