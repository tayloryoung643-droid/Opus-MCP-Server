# Opus MCP Service

Standalone Model Context Protocol (MCP) service for Opus AI. Provides HTTP REST API access to calendar, CRM, email, and database tools with versioned contracts and secure authentication.

## Features

- **REST API**: HTTP endpoints for all MCP tools (no WebSocket dependency for basic operations)
- **Versioned Tools**: All tools explicitly versioned (`.v1`) for API stability
- **Secure**: Bearer token authentication on all tool endpoints
- **Typed Errors**: Structured JSON error responses with error codes
- **Integration Ready**: Connects to Google Calendar, Gmail, Salesforce CRM, and PostgreSQL
- **Zero Mock Data**: Returns typed errors when integrations are missing instead of placeholder data

## Architecture

```
opus-mcp/
├── src/
│   ├── server.ts              # Express app, routes, error handling
│   ├── auth.ts                # Bearer token authentication
│   ├── errors.ts              # HttpError classes and helpers
│   ├── contracts/             # Zod schemas and TypeScript types
│   │   └── index.ts
│   ├── tools/                 # Versioned tool implementations
│   │   ├── index.ts           # Tool registration
│   │   ├── calendar.next_events.v1.ts
│   │   ├── gmail.search_threads.v1.ts
│   │   ├── gmail.read_thread.v1.ts
│   │   ├── salesforce.lookup_account.v1.ts
│   │   ├── salesforce.lookup_opportunity.v1.ts
│   │   ├── db.search_prep_notes.v1.ts
│   │   ├── db.call_history.v1.ts
│   │   └── prep.generate.v1.ts
│   └── orchestrator/          # Context resolution and loading
│       ├── contextResolver.ts
│       └── contextLoader.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+
- Access to the parent Opus application (shares database and services)
- Environment variables configured

### Environment Variables

Create a `.env` file in the `opus-mcp` directory (or copy from `.env.example`):

**Important:** MCP runs on port 4000 by default; the main app uses port 5000. This separation prevents port collisions.

**Note:** Set `MCP_PORT` if Replit or another host injects `PORT`; default is 4000.

```bash
# Required
PORT=4000  # Or use MCP_PORT to override if PORT is injected by your host
MCP_SERVICE_TOKEN=your-secret-service-token-here
DATABASE_URL=postgresql://...

# Google Integration (optional, for calendar/gmail tools)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...

# Salesforce Integration (optional, for CRM tools)
SFDC_CLIENT_ID=...
SFDC_CLIENT_SECRET=...
```

### Installation

```bash
cd opus-mcp
npm install
```

### Development

```bash
npm run dev
```

Server starts on `http://localhost:4000`

### Production

```bash
npm run build
npm start
```

## API Endpoints

### Health Check

**GET /healthz** (no auth required)

Returns service health status.

```bash
curl -s http://localhost:4000/healthz
```

**Response:**
```json
{
  "ok": true
}
```

### Contracts

**GET /contracts** (no auth required)

Lists all available tools with version info and schema summaries.

```bash
curl -s http://localhost:4000/contracts | jq
```

**Response:**
```json
{
  "tools": [
    {
      "name": "calendar.next_events.v1",
      "version": "v1",
      "description": "Get details about upcoming or recent meetings from Google Calendar",
      "inputSchemaSummary": { "type": "object", "fields": {...} },
      "outputSchemaSummary": "Tool-specific response object"
    },
    ...
  ]
}
```

### Tool Execution

**POST /tools/<toolName>** (auth required)

Execute a specific tool by name. All tool endpoints require:
- **Header**: `Authorization: Bearer <MCP_SERVICE_TOKEN>`
- **Body**: Tool-specific JSON input matching the tool's input schema

## Tool Examples

### Calendar: Next Events

```bash
curl -s -X POST http://localhost:4000/tools/calendar.next_events.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123",
    "timeRange": {
      "start": "2025-10-01T00:00:00Z",
      "end": "2025-10-02T00:00:00Z"
    }
  }' | jq
```

**Success Response:**
```json
{
  "events": [
    {
      "id": "event_abc123",
      "summary": "Sales Call with Acme Corp",
      "start": { "dateTime": "2025-10-01T14:00:00Z" },
      "end": { "dateTime": "2025-10-01T15:00:00Z" },
      "attendees": [
        {
          "email": "prospect@acme.com",
          "displayName": "John Doe",
          "responseStatus": "accepted"
        }
      ]
    }
  ],
  "total": 1
}
```

**Error Response (not connected):**
```json
{
  "error": {
    "code": "GOOGLE_NOT_CONNECTED",
    "message": "Connect Google Calendar to access events"
  }
}
```

### Gmail: Search Threads

```bash
curl -s -X POST http://localhost:4000/tools/gmail.search_threads.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123",
    "q": "newer_than:90d from:prospect@example.com"
  }' | jq
```

**Response:**
```json
{
  "threads": [
    {
      "id": "thread_123abc",
      "historyId": "12345"
    }
  ]
}
```

### Gmail: Read Thread

```bash
curl -s -X POST http://localhost:4000/tools/gmail.read_thread.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123",
    "threadId": "thread_123abc"
  }' | jq
```

**Response:**
```json
{
  "threadId": "thread_123abc",
  "messages": [
    {
      "id": "msg_xyz",
      "date": "Mon, 01 Oct 2025 10:30:00 +0000",
      "from": "prospect@example.com",
      "to": "you@company.com",
      "subject": "Re: Product Demo",
      "snippet": "Thanks for the demo...",
      "body": "Full email body text..."
    }
  ]
}
```

### Salesforce: Lookup Account

```bash
curl -s -X POST http://localhost:4000/tools/salesforce.lookup_account.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123",
    "domain": "acme.com"
  }' | jq
```

**Response:**
```json
{
  "accounts": [
    {
      "Id": "001abc123",
      "Name": "Acme Corporation",
      "Industry": "Technology",
      "NumberOfEmployees": 5000,
      "AnnualRevenue": 100000000,
      "Website": "https://acme.com",
      "Description": "Enterprise software solutions"
    }
  ],
  "total": 1
}
```

**Error Response (not connected):**
```json
{
  "error": {
    "code": "SALESFORCE_NOT_CONNECTED",
    "message": "Connect Salesforce to access CRM data"
  }
}
```

### Salesforce: Lookup Opportunity

```bash
curl -s -X POST http://localhost:4000/tools/salesforce.lookup_opportunity.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123"
  }' | jq
```

**Response (all opportunities):**
```json
{
  "opportunities": [
    {
      "Id": "006xyz789",
      "Name": "Q4 Enterprise License",
      "StageName": "Proposal",
      "Amount": 150000,
      "CloseDate": "2025-12-31",
      "AccountId": "001abc123",
      "AccountName": "Acme Corporation"
    }
  ],
  "total": 1
}
```

### Database: Search Prep Notes

```bash
curl -s -X POST http://localhost:4000/tools/db.search_prep_notes.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123",
    "query": "pricing strategy",
    "limit": 5
  }' | jq
```

**Response:**
```json
{
  "notes": [
    {
      "id": "note_abc",
      "userId": "u_123",
      "eventId": "event_xyz",
      "text": "Discussed pricing strategy with focus on volume discounts",
      "updatedAt": "2025-09-15T10:30:00.000Z"
    }
  ],
  "query": "pricing strategy",
  "total": 1
}
```

### Database: Call History

```bash
curl -s -X POST http://localhost:4000/tools/db.call_history.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123",
    "companyDomain": "acme.com",
    "lookbackDays": 90
  }' | jq
```

**Response:**
```json
{
  "calls": [
    {
      "id": "call_123",
      "title": "Discovery Call - Acme Corp",
      "scheduledAt": "2025-09-01T14:00:00.000Z",
      "status": "completed",
      "companyName": "Acme Corporation",
      "contactEmails": ["prospect@acme.com"],
      "callPrep": {
        "executiveSummary": "Enterprise software company...",
        "conversationStrategy": "Focus on scalability..."
      },
      "notes": "Great conversation, moving to proposal stage"
    }
  ],
  "searchCriteria": "company domain: acme.com",
  "total": 1
}
```

## Error Handling

All errors return JSON with the following structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { } // Optional additional details
  }
}
```

### Common Error Codes

- **`UNAUTHORIZED`** (401): Missing or invalid bearer token
- **`BAD_REQUEST`** (400): Invalid input (validation errors)
- **`GOOGLE_NOT_CONNECTED`** (401): User needs to connect Google Calendar/Gmail
- **`SALESFORCE_NOT_CONNECTED`** (401): User needs to connect Salesforce CRM
- **`CONFIG_ERROR`** (500): Server configuration issue (missing env vars)
- **`INTERNAL_ERROR`** (500): Unexpected server error

### Important: All Tool Requests Must Include userId

All tool endpoints require a `userId` field in the request body for user context and data isolation. This is validated before tool execution.

## Troubleshooting

### Service won't start

**Error**: `Missing required environment variables`

**Solution**: Ensure `MCP_SERVICE_TOKEN` and `DATABASE_URL` are set in `.env`

```bash
export MCP_SERVICE_TOKEN="your-secret-token"
export DATABASE_URL="postgresql://..."
npm run dev
```

### 401 Unauthorized

**Error**: `Missing or invalid Authorization header`

**Solution**: Include bearer token in all tool requests:

```bash
curl -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" ...
```

### 400 Bad Request

**Error**: `Invalid input`

**Solution**: Check the tool's input schema in `/contracts` and ensure your JSON matches:

```bash
# First, check the contract
curl http://localhost:4000/contracts | jq '.tools[] | select(.name=="calendar.next_events.v1")'

# Then provide matching input
curl -X POST http://localhost:4000/tools/calendar.next_events.v1 \
  -H "Authorization: Bearer ${MCP_SERVICE_TOKEN}" \
  -d '{"userId":"u_123", ...}'
```

### Integration Not Connected Errors

**Error**: `GOOGLE_NOT_CONNECTED` or `SALESFORCE_NOT_CONNECTED`

**Solution**: User must connect the integration through the main Opus web application first. The MCP service reads integration status from the shared database but doesn't handle OAuth flows.

## WebSocket Support (Planned)

WebSocket endpoint for Orb/voice integration is stubbed at `GET /ws` but not yet implemented. Currently returns `501 Not Implemented`.

## License

Proprietary - Opus AI Platform
