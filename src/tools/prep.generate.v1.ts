import { z } from 'zod';
import { type MCPToolContext, type MinimalPrepV1, type CompanyResearch } from '../contracts/index.js';
import { HttpError } from '../errors.js';
import { getGoogleTokens, saveGoogleTokens } from '../lib/tokenStore.js';
import { makeClientsFor } from '../lib/google.js';
import { fetchGoogleTokens } from '../lib/tokenProvider.js';
import { buildMinimalPrep, buildGmailQuery } from '../lib/minimalPrepBuilder.js';
import { saveMinimalPrep } from '../lib/prepStore.js';
import { researchCompanyWithClaude, isAnthropicAvailable } from '../lib/anthropicResearch.js';

export const name = 'prep.generate.v1';
export const version = 'v1';
export const inputSchema = z.object({
  userId: z.string(),
  eventId: z.string(),
  context: z.object({
    companyDomain: z.string().optional(),
    contactEmail: z.string().optional(),
    notes: z.string().optional()
  }).optional()
});
export const description = 'Generate call preparation materials using AI';

const COMMON_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'google.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me',
  'zoho.com', 'mail.com', 'gmx.com'
]);

function extractCompanyDomains(attendeeEmails: string[]): string[] {
  const domains = new Set<string>();
  
  for (const email of attendeeEmails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && !COMMON_EMAIL_PROVIDERS.has(domain)) {
      domains.add(domain);
    }
  }
  
  return Array.from(domains).slice(0, 3);
}

interface CompanyResearchWithDomain extends CompanyResearch {
  domain: string;
}

async function researchCompanyFallback(domain: string, userId: string): Promise<CompanyResearchWithDomain | null> {
  console.log(`[prep.generate] Researching company for domain: ${domain}`);
  
  if (isAnthropicAvailable()) {
    try {
      const result = await researchCompanyWithClaude(domain);
      if (result) {
        return { ...result, domain };
      }
    } catch (err) {
      console.warn(`[prep.generate] Claude research failed for ${domain}:`, err);
    }
  }
  
  console.log(`[prep.generate] Returning mock data for domain: ${domain}`);
  return {
    domain,
    companyName: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
    industry: 'Technology',
    employeeCount: '100-500',
    description: `Company at ${domain}`,
    website: `https://${domain}`,
    recentNews: [],
    lastUpdated: Date.now(),
    searchQuery: `mock:${domain}`
  };
}

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<MinimalPrepV1> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);
    const { userId, eventId } = params;

    let tokens = await getGoogleTokens(userId);
    
    if (!tokens) {
      console.log(`[MCP-Tool:${name}] No local tokens found, trying token provider...`);
      tokens = await fetchGoogleTokens(userId);
      
      if (tokens) {
        console.log(`[MCP-Tool:${name}] Token provider returned tokens, saving locally`);
        await saveGoogleTokens(userId, tokens);
      }
    }
    
    if (!tokens) {
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Google Calendar not connected',
        { hint: `Connect Google at /connect?userId=${userId}` }
      );
    }

    const { calendar, gmail } = await makeClientsFor(userId, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate,
    });

    console.log(`[MCP-Tool:${name}] Fetching event: ${eventId}`);
    
    let event;
    try {
      const { data } = await calendar.events.get({
        calendarId: 'primary',
        eventId: eventId,
      });
      event = data;
    } catch (err: any) {
      if (err.code === 404) {
        throw new HttpError(404, 'EVENT_NOT_FOUND', `Event not found: ${eventId}`);
      }
      throw err;
    }

    console.log(`[MCP-Tool:${name}] Event found: ${event.summary}`);

    const attendeeEmails = (event.attendees || [])
      .map(a => a.email?.toLowerCase())
      .filter((e): e is string => !!e);

    let gmailThreads: any[] = [];
    
    if (attendeeEmails.length > 0) {
      const gmailQuery = buildGmailQuery({
        attendees: attendeeEmails,
        eventTitle: event.summary || '',
        recencyDays: 180
      });
      
      console.log(`[MCP-Tool:${name}] Gmail query: ${gmailQuery}`);
      
      try {
        const { data: threadList } = await gmail.users.threads.list({
          userId: 'me',
          q: gmailQuery,
          maxResults: 10,
        });
        
        const threadIds = (threadList.threads || []).slice(0, 5);
        
        const threadDetails = await Promise.all(
          threadIds.map(async (t) => {
            try {
              const { data } = await gmail.users.threads.get({
                userId: 'me',
                id: t.id!,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Date'],
              });
              return data;
            } catch {
              return null;
            }
          })
        );
        
        gmailThreads = threadDetails.filter(Boolean);
        console.log(`[MCP-Tool:${name}] Found ${gmailThreads.length} Gmail threads`);
      } catch (err) {
        console.warn(`[MCP-Tool:${name}] Gmail search failed:`, err);
      }
    }

    const companyDomains = extractCompanyDomains(attendeeEmails);
    console.log(`[MCP-Tool:${name}] Company domains to research: ${companyDomains.join(', ')}`);
    
    let companyResearch: Array<CompanyResearch & { domain: string }> = [];
    
    if (companyDomains.length > 0) {
      const results = await Promise.allSettled(
        companyDomains.map(domain => researchCompanyFallback(domain, userId))
      );
      
      companyResearch = results
        .filter((r): r is PromiseFulfilledResult<CompanyResearch & { domain: string }> => 
          r.status === 'fulfilled' && r.value !== null
        )
        .map(r => r.value);
      
      console.log(`[MCP-Tool:${name}] Company research completed: ${companyResearch.length} results`);
    }

    const prepData = buildMinimalPrep({
      userId,
      event: {
        id: eventId,
        summary: event.summary || undefined,
        start: event.start ? {
          dateTime: event.start.dateTime || undefined,
          date: event.start.date || undefined
        } : undefined,
        end: event.end ? {
          dateTime: event.end.dateTime || undefined,
          date: event.end.date || undefined
        } : undefined,
        attendees: event.attendees?.map(a => ({
          email: a.email || undefined,
          displayName: a.displayName || undefined,
          responseStatus: a.responseStatus || undefined
        }))
      },
      gmailThreads,
      salesforce: undefined,
      companyResearch: companyResearch.map(cr => ({
        domain: cr.domain,
        companyName: cr.companyName,
        industry: cr.industry,
        employeeCount: cr.employeeCount,
        revenue: cr.revenue,
        description: cr.description,
        website: cr.website,
        linkedInUrl: cr.linkedInUrl,
        recentNews: cr.recentNews
      }))
    });

    const savedPrep = saveMinimalPrep(prepData);
    
    console.log(`[MCP-Tool:${name}] Prep saved with ID: ${savedPrep.id}`);

    return savedPrep;
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
