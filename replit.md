# Opus MCP Service

## Overview

Opus MCP Service is a standalone Model Context Protocol (MCP) service that provides HTTP REST API access to calendar, CRM, email, and database tools. The service acts as a middleware layer that connects to external services (Google Calendar, Gmail, Salesforce) and an internal database to provide unified, versioned tool endpoints for AI agents and applications.

The service follows a contract-first design with explicitly versioned tools (e.g., `.v1` suffixes), structured error handling, and bearer token authentication. It's designed to be integration-ready while gracefully handling missing credentials through typed error responses rather than mock data.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### REST API Architecture

**Problem**: Need to provide MCP tool access over HTTP without WebSocket complexity for basic operations.

**Solution**: Express.js-based REST API with dedicated endpoints for each versioned tool.

**Key Design Decisions**:
- Each tool gets its own POST endpoint (e.g., `/tools/calendar.next_events.v1`)
- Compatibility router at `/mcp/:tool` for simplified access (e.g., `/mcp/calendar.next_events.v1`)
- Bearer token authentication on all tool endpoints via `Authorization: Bearer <token>`
- Structured JSON error responses with error codes (UNAUTHORIZED, BAD_REQUEST, CONFIG_ERROR, etc.)
- CORS configuration for cross-origin access from configured app/API origins
- Public endpoints for `/healthz` (health checks) and `/contracts` (tool discovery)
- WebSocket support at `/ws/voice` for real-time communication

**Rationale**: Simple HTTP POST interface is easier to integrate than WebSocket for most use cases, while maintaining security through authentication. The compatibility router provides a simplified URL pattern for external apps.

### Tool Versioning System

**Problem**: API stability and backward compatibility as tools evolve.

**Solution**: Explicit version suffixes in tool names (e.g., `calendar.next_events.v1`, `gmail.search_threads.v1`).

**Key Design Decisions**:
- Tools are loaded from individual files named with version suffix (`calendar.next_events.v1.ts`)
- Each tool exports: `name`, `version`, `inputSchema` (Zod), `description`, and `handler` function
- Contracts endpoint exposes schema summaries for all registered tools
- Future versions can coexist with current versions

**Rationale**: Explicit versioning prevents breaking changes when tool interfaces need to evolve, allowing gradual migration.

### Schema Validation Layer

**Problem**: Type-safe input validation and clear contract definitions.

**Solution**: Zod schemas defined in `src/contracts/index.ts` for all tool inputs.

**Key Design Decisions**:
- Centralized schema definitions exported from contracts module
- Runtime validation using Zod `.parse()` in tool handlers
- Schemas define required fields, optional fields, and defaults
- TypeScript types derived from Zod schemas for type safety

**Rationale**: Zod provides both runtime validation and TypeScript types from a single source of truth, catching errors early and providing clear API contracts.

### Context Resolution Pattern

**Problem**: Tools need access to user-specific integrations, database, and external services.

**Solution**: `MCPToolContext` object passed to all tool handlers with storage, services, and user info.

**Key Design Decisions**:
- Context includes: `userId`, `storage`, `googleCalendarService`, `salesforceCrmService`, `user` object
- Services are lazily initialized when tools execute
- Context resolver (`UnifiedMCPContextResolver`) manages service initialization
- Tools can check integration status via storage layer before making external calls

**Rationale**: Dependency injection pattern allows tools to remain focused on business logic while context handles cross-cutting concerns like authentication and service access.

### Error Handling Strategy

**Problem**: Need consistent, actionable error responses across all tools.

**Solution**: Custom `HttpError` class hierarchy with structured JSON responses.

**Key Design Decisions**:
- `HttpError` base class with statusCode, code, message, and optional details
- Helper functions: `unauthorized()`, `badRequest()`, `internalError()`, `configError()`, `integrationError()`
- Integration errors return 401 with specific codes (e.g., `GOOGLE_NOT_CONNECTED`, `SALESFORCE_NOT_CONNECTED`)
- Express error middleware converts all errors to consistent JSON format
- No mock data - missing integrations return typed errors

**Rationale**: Structured errors allow clients to programmatically handle different failure scenarios (missing auth, bad input, service unavailable) rather than parsing error messages.

### Tool Categories and Implementations

**Calendar Tools** (`calendar.next_events.v1`):
- Searches Google Calendar events by multiple criteria:
  - Event ID: `{"userId":"...", "eventId":"..."}`
  - Contact email: `{"userId":"...", "contactEmail":"..."}`
  - Time range (documented): `{"userId":"...", "startIso":"2025-10-05T00:00:00Z", "endIso":"2025-10-06T00:00:00Z"}`
  - Time range (window): `{"userId":"...", "window":{"startIso":"...", "endIso":"..."}}`
  - Days ahead: `{"userId":"...", "daysAhead":1}`
- Returns structured event data with attendees
- Filters for upcoming events in next 24 hours as default

**Gmail Tools** (`gmail.search_threads.v1`, `gmail.read_thread.v1`):
- Search threads using Gmail query syntax
- Read full thread content with normalized message format
- Extracts headers (from, to, subject, date) and body text

**Salesforce Tools** (`salesforce.lookup_account.v1`, `salesforce.lookup_opportunity.v1`):
- Account lookup by ID, name, or domain
- Opportunity lookup with filtering options
- Returns standard Salesforce fields with configurable field selection

**Database Tools** (`db.search_prep_notes.v1`, `db.call_history.v1`):
- Search historical prep notes by text query
- Retrieve call history by contact email, company name, or domain
- Date-based filtering with configurable lookback periods

**Prep Generation** (`prep.generate.v1`):
- Stub for AI-powered call preparation (not yet implemented)
- Designed to aggregate context from multiple tools

### Database Layer

**Problem**: Access to internal application data (prep notes, call history, companies, contacts).

**Solution**: Storage abstraction layer with direct SQL queries.

**Key Design Decisions**:
- Storage layer (`server/storage.js`) provides typed query methods
- Direct SQL using Neon serverless driver for performance
- Methods return empty arrays rather than throwing on query failures
- Company/contact relationships through normalized tables

**Rationale**: Direct SQL provides flexibility for complex queries while the storage layer provides a clean interface for tools.

## External Dependencies

### Database
- **Neon Serverless Postgres**: Primary data store via `@neondatabase/serverless`
- **Drizzle ORM**: Type-safe database queries (`drizzle-orm` v0.30.0)
- Connection via `DATABASE_URL` environment variable
- Tables: companies, contacts, prep_notes, user_integrations, calls

### Google Services
- **Google Calendar API**: Event and meeting data
- **Gmail API**: Email thread search and reading
- OAuth2 integration with access/refresh tokens stored per user
- Requires: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

### Salesforce CRM
- **Salesforce REST API**: Account and opportunity data
- OAuth integration with user-specific credentials
- Requires: `SFDC_CLIENT_ID`, `SFDC_CLIENT_SECRET` (or `SALESFORCE_CLIENT_ID/SECRET`)
- Service methods for querying accounts, opportunities, and search

### Authentication & Security
- **Bearer Token**: `MCP_SERVICE_TOKEN` environment variable for API authentication
- **jsonwebtoken**: JWT handling (v9.0.2)
- Per-user OAuth tokens stored in database for external service access

### Runtime & Framework
- **Express.js**: HTTP server (v4.18.2)
- **CORS**: Cross-origin support with configurable origins (`APP_ORIGIN`, `API_ORIGIN`)
- **Zod**: Schema validation and type generation (v3.22.4)
- **TypeScript**: Type safety with ES2022/ESNext modules
- **tsx**: Development runtime for TypeScript execution

### Service Integration Pattern
This is a standalone MCP service with its own storage and service implementations:
- Storage layer in `server/storage.js` provides database access using Neon SQL
- MCP client in `server/mcp/client.js` provides service context and integration validation
- Database integration stubs in place for Google Calendar, Gmail, and Salesforce services
- Storage layer provides company, contact, integration, and call data access

### Configuration
Environment-based configuration with validation:
- Port: `MCP_PORT` or `PORT` (runs on port 8000 in Replit)
- Required: `MCP_SERVICE_TOKEN`, `DATABASE_URL`
- Optional: Google and Salesforce OAuth credentials (for future integration)
- Schema validation via Zod ensures all required vars are present

## Deployment

The MCP service is deployed as a standalone Repl on port 8000:
- **Service URL**: `https://e4bedc74-a6dc-4338-9b37-70398c52b12d-00-1uas4iu27ac85.spock.replit.dev`
- **Health Check**: `GET /healthz` returns `{"ok": true}`
- **Contracts**: `GET /contracts` returns all 8 available tools
- **Authentication**: All tool endpoints require `Authorization: Bearer <MCP_SERVICE_TOKEN>` header

### Available Tools
1. `calendar.next_events.v1` - Get upcoming calendar events
2. `gmail.search_threads.v1` - Search Gmail threads
3. `gmail.read_thread.v1` - Read Gmail thread by ID
4. `salesforce.lookup_account.v1` - Lookup Salesforce account
5. `salesforce.lookup_opportunity.v1` - Lookup Salesforce opportunity
6. `db.search_prep_notes.v1` - Search call prep notes
7. `db.call_history.v1` - Get call history
8. `prep.generate.v1` - Generate call prep (stub)

### Integration with Main App
The main application should:
1. Store the `MCP_SERVICE_TOKEN` as an environment variable
2. Make HTTP POST requests to `https://<repl-url>/tools/<tool-name>`
3. Include `Authorization: Bearer <token>` header
4. Send `userId` in request body for all tool calls