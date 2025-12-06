import { z } from 'zod';

// Salesforce tool schemas - v1
export const salesforceContactLookupSchemaV1 = z.object({
  userId: z.string(),
  email: z.string().email().optional(),
  company: z.string().optional(),
  fields: z.array(z.string()).optional().default([
    'Id', 'Name', 'Email', 'Phone', 'Title', 'AccountId', 'Account.Name'
  ])
});

export const salesforceOpportunityLookupSchemaV1 = z.object({
  userId: z.string(),
  opportunityId: z.string().optional(),
  contactId: z.string().optional(),
  accountId: z.string().optional(),
  fields: z.array(z.string()).optional().default([
    'Id', 'Name', 'StageName', 'Amount', 'CloseDate', 'AccountId', 'Account.Name'
  ])
});

export const salesforceAccountLookupSchemaV1 = z.object({
  userId: z.string(),
  accountId: z.string().optional(),
  name: z.string().optional(),
  domain: z.string().optional(),
  fields: z.array(z.string()).optional().default([
    'Id', 'Name', 'Industry', 'NumberOfEmployees', 'AnnualRevenue', 'Website', 'Description'
  ])
});

// Google Calendar tool schemas - v1
export const calendarMeetingContextSchemaV1 = z.object({
  userId: z.string(),
  eventId: z.string().optional(),
  contactEmail: z.string().email().optional(),
  timeRange: z.object({
    start: z.string(),
    end: z.string()
  }).optional(),
  startIso: z.string().optional(),
  endIso: z.string().optional(),
  daysAhead: z.number().min(1).max(365).optional(),
  window: z.object({
    startIso: z.string(),
    endIso: z.string()
  }).optional(),
  includeAttendees: z.boolean().default(true)
}).refine(data => {
  return data.eventId || data.contactEmail || data.timeRange || 
         (data.startIso && data.endIso) || data.daysAhead || data.window;
}, {
  message: "At least one search criteria must be provided",
  path: []
});

export const calendarAttendeeHistorySchemaV1 = z.object({
  userId: z.string(),
  attendeeEmail: z.string().email(),
  lookbackDays: z.number().min(1).max(365).default(90),
  maxResults: z.number().min(1).max(50).default(10)
});

// Database tool schemas - v1
export const prepNotesSearchSchemaV1 = z.object({
  userId: z.string(),
  query: z.string().min(1),
  limit: z.number().min(1).max(50).default(10)
});

export const callHistoryLookupSchemaV1 = z.object({
  userId: z.string(),
  contactEmail: z.string().email().optional(),
  companyName: z.string().optional(),
  companyDomain: z.string().optional(),
  lookbackDays: z.number().min(1).max(365).default(180),
  maxResults: z.number().min(1).max(20).default(10)
}).refine(data => data.contactEmail || data.companyName || data.companyDomain, {
  message: "At least one search criteria must be provided"
});

// Gmail tool schemas - v1
export const gmailSearchThreadsSchemaV1 = z.object({
  userId: z.string(),
  q: z.string().optional().default("newer_than:7d")
});

export const gmailReadThreadSchemaV1 = z.object({
  userId: z.string(),
  threadId: z.string()
});

// Company research tool schemas - v1
export const companyResearchSchemaV1 = z.object({
  userId: z.string(),
  company: z.string().optional(),
  domain: z.string().optional()
}).refine(data => data.company || data.domain, {
  message: "Either company name or domain must be provided"
});

// Tool result types
export interface SalesforceContact {
  Id: string;
  Name: string;
  Email?: string;
  Phone?: string;
  Title?: string;
  AccountId?: string;
  AccountName?: string;
}

export interface SalesforceOpportunity {
  Id: string;
  Name: string;
  StageName: string;
  Amount?: number;
  CloseDate?: string;
  AccountId?: string;
  AccountName?: string;
}

export interface SalesforceAccount {
  Id: string;
  Name: string;
  Industry?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  Website?: string;
  Description?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  description?: string;
  location?: string;
}

export interface CallHistory {
  id: string;
  title: string;
  scheduledAt: Date;
  status: string;
  companyName?: string;
  contactEmails: string[];
  callPrep?: {
    executiveSummary?: string;
    conversationStrategy?: string;
  };
  notes?: string;
}

export interface PrepNote {
  id: string;
  userId: string;
  eventId: string;
  text: string;
  updatedAt: Date;
}

export interface GmailThread {
  id: string;
  historyId?: string;
}

export interface GmailMessage {
  id: string;
  date?: string;
  from?: string;
  to?: string;
  subject?: string;
  snippet: string;
  body: string;
}

export interface CompanyResearch {
  companyName?: string;
  industry?: string;
  employeeCount?: string;
  revenue?: string;
  description?: string;
  website?: string;
  linkedInUrl?: string;
  recentNews: Array<{
    headline: string;
    date?: string;
    url?: string;
  }>;
  lastUpdated: number;
  searchQuery: string;
}

// MinimalPrepV1 types
export interface MinimalPrepV1 {
  id: string;
  userId: string;
  eventId: string;
  createdAt: number;
  meeting: {
    title: string;
    start?: string;
    end?: string;
  };
  attendees: Array<{
    name?: string;
    email: string;
    response?: "accepted" | "declined" | "tentative" | "needsAction";
  }>;
  gmail: Array<{
    threadId: string;
    subject: string;
    participants: string[];
    lastMessageSnippet: string;
    lastMessageDate: string;
  }>;
  salesforce?: {
    account?: {
      id: string;
      name: string;
      industry?: string;
      employees?: number;
      website?: string;
    };
    opportunity?: {
      id: string;
      name: string;
      stageName?: string;
      amount?: number;
      closeDate?: string;
      owner?: string;
    };
    contacts?: Array<{
      id: string;
      name?: string;
      email?: string;
      title?: string;
    }>;
  };
  companyResearch?: Array<{
    domain: string;
    companyName?: string;
    industry?: string;
    employeeCount?: string;
    revenue?: string;
    description?: string;
    website?: string;
    linkedInUrl?: string;
    recentNews?: Array<{
      headline: string;
      date?: string;
      url?: string;
    }>;
  }>;
}

// Tool execution context
export interface MCPToolContext {
  userId: string;
  storage: any;
  googleCalendarService?: any;
  salesforceCrmService?: any;
  user?: any;
  requestId?: string;
}
