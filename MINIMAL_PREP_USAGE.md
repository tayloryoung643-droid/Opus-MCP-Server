# MinimalPrepV1 - Facts-Only Prep Payload

## Overview

The MinimalPrepV1 feature provides a streamlined, facts-only prep payload for calendar events. Instead of template sections, it returns deduplicated, trimmed data ready for AI processing.

## Configuration

Set the `PREP_MODE` environment variable:
- `minimal` (default): Returns MinimalPrepV1 format
- `full`: Returns legacy template-based format

```bash
export PREP_MODE=minimal
```

## API Usage

### Generate Prep

```bash
POST /mcp/prep.generate.v1
Authorization: Bearer <MCP_SERVICE_TOKEN>
Content-Type: application/json

{
  "userId": "user123",
  "eventId": "calendar-event-id"
}
```

### Response Format

```json
{
  "id": "user123_event123_1234567890",
  "userId": "user123",
  "eventId": "event123",
  "createdAt": 1234567890,
  "meeting": {
    "title": "Quarterly Business Review",
    "start": "2025-10-15T14:00:00Z",
    "end": "2025-10-15T15:00:00Z"
  },
  "attendees": [
    {
      "name": "John Doe",
      "email": "john@example.com",
      "response": "accepted"
    }
  ],
  "gmail": [
    {
      "threadId": "thread123",
      "subject": "Re: Q4 Planning",
      "participants": ["john@example.com", "jane@example.com"],
      "lastMessageSnippet": "Looking forward to discussing our roadmap. Key priorities are...",
      "lastMessageDate": "2025-10-10T10:30:00Z"
    }
  ],
  "salesforce": {
    "account": {
      "id": "001xx000003DGb2AAG",
      "name": "Acme Corp",
      "industry": "Technology",
      "employees": 500,
      "website": "https://acme.com"
    },
    "opportunity": {
      "id": "006xx000001XyZxAAK",
      "name": "Q4 Enterprise Deal",
      "stageName": "Negotiation",
      "amount": 250000,
      "closeDate": "2025-12-31"
    },
    "contacts": [
      {
        "id": "003xx000004TtBjAAK",
        "name": "John Doe",
        "email": "john@example.com",
        "title": "VP of Engineering"
      }
    ]
  },
  "companyResearch": [
    {
      "domain": "acme.com",
      "companyName": "Acme Corp",
      "industry": "Technology & Software",
      "employeeCount": "5,000+",
      "revenue": "$500M",
      "description": "Acme Corp is a leading provider of innovative solutions...",
      "website": "https://www.acme.com",
      "linkedInUrl": "https://www.linkedin.com/company/acme-corp",
      "recentNews": [
        {
          "headline": "Acme Corp announces record Q4 revenue",
          "date": "2025-10-01",
          "url": "https://news.example.com/acme-q4-revenue"
        },
        {
          "headline": "Acme Corp launches new product line",
          "url": "https://techcrunch.example.com/acme-product-launch"
        }
      ]
    }
  ]
}
```

## Features

### 1. Attendee Deduplication
- Deduplicates by lowercase email
- Preserves name and response status
- Unique attendees only

### 2. Gmail Thread Deduplication
- Groups by normalized subject (removes "Re:", "Fw:", brackets, etc.)
- Keeps newest thread per subject group
- Limits to 3 threads maximum
- Sorted by recency (newest first)

### 3. Snippet Trimming
- Extracts first 2 unique sentences
- Maximum 280 characters
- Adds "…" if truncated
- No repetition

### 4. Tightened Gmail Query
- People groups: `(from:X OR to:X)` for each attendee
- Title match: Keywords >3 chars from event title
- Recency filter: `newer_than:180d`
- Combines all criteria with AND logic

### 5. Optional Salesforce Data
- Only included when data is found
- Account lookup by attendee email domains
- Opportunity lookup by account
- Contact lookup by attendee emails
- Omits entire `salesforce` field if no data

### 6. Company Research (Web Enrichment)
- Automatically researches companies based on attendee email domains
- Extracts company name, industry, headcount, revenue
- Finds LinkedIn URLs and company websites
- Gathers recent news headlines (up to 3)
- Researches up to 3 unique domains per prep
- Excludes common email providers (gmail.com, outlook.com, etc.)
- **Primary provider**: Claude web_search (requires `ANTHROPIC_API_KEY`)
- **Fallback providers**: Google Custom Search API, then mock data
- Failures don't break prep generation - company data is simply omitted

#### Research Provider Priority:
1. **Claude web_search** (if `ANTHROPIC_API_KEY` is set) - Uses Claude's built-in web search tool for real-time company research with AI-powered extraction
2. **Google Custom Search** (if `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` are set) - Uses Google's search API with pattern matching
3. **Mock data** (development fallback) - Returns realistic placeholder data for testing

## Retrieve Prep

### By ID
```bash
GET /prep/{prepId}
```

### By User
```bash
GET /prep?userId=user123
```

Returns array of preps sorted by creation time (newest first).

## Development Mode

For testing without authentication:
```bash
export DEV_LOCAL_TOOL_KEY=your-dev-key

curl -X POST http://localhost:5000/mcp/prep.generate.v1 \
  -H "Authorization: Bearer your-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user","eventId":"event123"}'
```

## Error Handling

The endpoint returns structured errors:

```json
{
  "error": {
    "code": "GOOGLE_NOT_CONNECTED",
    "message": "Gmail not connected",
    "hint": "Connect Google at /connect?userId=user123"
  }
}
```

Common error codes:
- `GOOGLE_NOT_CONNECTED`: User needs to authorize Google
- `SFDC_NOT_CONNECTED`: Salesforce not configured (non-blocking, Salesforce data omitted)
- `MISSING_INPUT`: Invalid request parameters
