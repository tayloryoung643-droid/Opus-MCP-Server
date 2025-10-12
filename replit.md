## Overview

The Opus MCP Service is a standalone Model Context Protocol (MCP) service providing HTTP REST API access to calendar, CRM, email, and database tools. It acts as a middleware layer, connecting to external services (Google Calendar, Gmail, Salesforce) and an internal database. The service offers unified, versioned tool endpoints for AI agents and applications, focusing on contract-first design, explicit versioning, structured error handling, and bearer token authentication. It's designed for seamless integration, handling missing credentials gracefully with typed error responses.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The service provides a user-friendly connection page at `/connect?userId=<id>` for OAuth integrations.

### Technical Implementations
The service is built on Express.js, providing REST API access to all functionalities. It implements explicit tool versioning (e.g., `calendar.next_events.v1`) to ensure API stability and backward compatibility. Zod schemas are used for robust input validation and clear contract definitions. A token provider system with an in-memory cache fetches user integration tokens from a central application, propagating request IDs for observability. Direct Google OAuth integration is implemented with secure, CSRF-protected flows and in-memory token storage for Google Calendar and Gmail tools. **Token Provider Fallback**: Google Calendar and Gmail tools automatically fall back to the token provider when local OAuth tokens are not found. The fallback flow: (1) checks local token storage, (2) if missing, calls `fetchGoogleTokens()` to retrieve tokens from the App's token provider, (3) saves fetched tokens locally for subsequent requests. This enables seamless sharing of Google credentials between the MCP service and the main App. A `MCPToolContext` object is passed to tool handlers, providing access to user-specific integrations and services. Error handling is standardized using a custom `HttpError` class hierarchy, returning structured JSON responses with actionable guidance.

### Feature Specifications
- **REST API**: Dedicated POST endpoints for each versioned tool (e.g., `/tools/calendar.next_events.v1`), compatibility router at `/mcp/:tool`, bearer token authentication, structured JSON error responses, CORS support, public endpoints for `/healthz`, `/contracts`, and `/debug/token-provider`. WebSocket support is available at `/ws/voice`.
- **Tool Versioning**: Tools are explicitly versioned (e.g., `calendar.next_events.v1`), allowing future versions to coexist.
- **Schema Validation**: Zod schemas ensure type-safe input validation for all tools.
- **Token Provider**: Fetches and caches user integration tokens with a 10-minute TTL, providing secure access to external services.
- **Google OAuth**: Secure, in-memory OAuth token storage with CSRF protection for Google Calendar and Gmail.
- **Context Resolution**: Tools receive a `MCPToolContext` object containing `userId`, `storage`, service clients, and `requestId`.
- **Error Handling**: Custom `HttpError` class provides consistent, actionable JSON error responses (e.g., `GOOGLE_NOT_CONNECTED`).
- **Tool Categories**: Includes Calendar (`calendar.next_events.v1`), Gmail (`gmail.search_threads.v1`, `gmail.read_thread.v1`), Salesforce (`salesforce.lookup_account.v1`, `salesforce.lookup_opportunity.v1`), Database (`db.search_prep_notes.v1`, `db.call_history.v1`), and Prep tools (`prep.save.v1`, `prep.generate.v1` orchestration endpoint).
- **Database Layer**: An abstraction layer (`server/storage.js`) uses direct SQL queries via Neon serverless driver for internal application data (prep notes, call history, companies, contacts).
- **Prep Storage**: In-memory store (`src/lib/prepStore.ts`) for call preparation materials. Supports two formats: (1) **MinimalPrepV1** (facts-only, default) - Contains meeting details, deduplicated attendees, up to 3 deduplicated Gmail threads with trimmed snippets (≤280 chars), and optional Salesforce data (account, opportunity, contacts). (2) **Full prep** (legacy) - Includes structured sections: snapshot, lastContact, priorities, risks, questions, agenda, and notes. The mode is controlled by `PREP_MODE` environment variable (default: "minimal"). Accessible via GET `/prep/:id` and GET `/prep?userId=...` endpoints. The `prep.save.v1` tool allows AI agents to persist prep data. The `prep.generate.v1` orchestration endpoint fetches Google Calendar events and Gmail threads to generate prep materials. **MinimalPrepV1 Features**: Attendee deduplication by lowercase email, Gmail thread deduplication by normalized subject (keeps newest per group), snippet trimming to first 2 unique sentences (max 280 chars), tightened Gmail query with people groups `(from:X OR to:X)`, title match using keywords, and 180-day recency filter.

### System Design Choices
The service adopts a modular design with clear separation of concerns, utilizing an Express.js framework for its RESTful API. Versioning is central to API evolution, and Zod enforces strict data contracts. The token provider and Google OAuth integrations are designed for secure, user-specific external service access. A comprehensive error-handling strategy ensures client applications receive clear, structured feedback.

## External Dependencies

- **Database**: Neon Serverless Postgres (`@neondatabase/serverless`) for primary data storage, managed with Drizzle ORM (v0.30.0). Configured via `DATABASE_URL`.
- **Google Services**: Google Calendar API and Gmail API for event and email data. Integrated via OAuth2, requiring `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- **Salesforce CRM**: Salesforce REST API for account and opportunity data. Requires `SFDC_CLIENT_ID` and `SFDC_CLIENT_SECRET`.
- **Authentication & Security**: Bearer Token authentication using `MCP_SERVICE_TOKEN`, JWT handling (`jsonwebtoken` v9.0.2).
- **Runtime & Framework**: Express.js (v4.18.2) for the HTTP server, CORS for cross-origin support, Zod (v3.22.4) for schema validation, TypeScript for type safety, and `tsx` for development.