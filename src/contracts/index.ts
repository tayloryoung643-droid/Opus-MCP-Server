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
  includeAttendees: z.boolean().default(true)
}).refine(data => data.eventId || data.contactEmail || data.timeRange, {
  message: "At least one search criteria must be provided"
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

// Tool execution context
export interface MCPToolContext {
  userId: string;
  storage: any;
  googleCalendarService?: any;
  salesforceCrmService?: any;
  user?: any;
}
