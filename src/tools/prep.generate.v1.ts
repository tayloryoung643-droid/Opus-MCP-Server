import { z } from 'zod';
import crypto from 'crypto';
import { type MCPToolContext } from '../contracts/index.js';
import { CONFIG } from '../config.js';
import { getGoogleTokens, saveGoogleTokens } from '../lib/tokenStore.js';
import { makeClientsFor } from '../lib/google.js';
import { fetchGoogleTokens } from '../lib/tokenProvider.js';
import { buildMinimalPrep, buildGmailQuery } from '../lib/minimalPrepBuilder.js';
import { savePrep, saveMinimalPrep } from '../lib/prepStore.js';
import { HttpError } from '../errors.js';

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

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<any> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);
    const { userId, eventId } = params;

    console.log(`[${requestId}] prep.generate.v1 started for user=${userId}, event=${eventId}`);

    let tokens = await getGoogleTokens(userId);
    
    if (!tokens) {
      console.log(`[${requestId}] No local tokens found, trying token provider...`);
      tokens = await fetchGoogleTokens(userId);
      
      if (tokens) {
        console.log(`[${requestId}] Token provider returned tokens, saving locally`);
        await saveGoogleTokens(userId, tokens);
      }
    }
    
    if (!tokens) {
      console.log(`[${requestId}] Google not connected for user=${userId}`);
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Google account not connected. Please connect your Google account.',
        { hint: `Connect Google at /connect?userId=${userId}` }
      );
    }

    console.log(`[${requestId}] Step 1: Creating Google clients...`);
    const { calendar, gmail } = await makeClientsFor(userId, {
      access_token: tokens.accessToken, 
      refresh_token: tokens.refreshToken, 
      expiry_date: tokens.expiryDate,
    });

    console.log(`[${requestId}] Step 2: Fetching calendar event...`);
    const ev = await calendar.events.get({ calendarId: 'primary', eventId });
  
    if (CONFIG.PREP_MODE === 'minimal') {
      const attendees = (ev.data.attendees || []).map(a => a.email!).filter(Boolean);
      const eventTitle = ev.data.summary || '';
      console.log(`[${requestId}] Step 3: Searching Gmail (${attendees.length} attendees)...`);
      
      const q = buildGmailQuery({ attendees, eventTitle, recencyDays: 180 });
      
      const gmailStart = Date.now();
      const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 10 });
      console.log(`[${requestId}] Step 3a: Found ${list.data.threads?.length || 0} threads in ${Date.now() - gmailStart}ms`);
      
      const threadStart = Date.now();
      const threads = await Promise.all((list.data.threads || []).map(async t => {
        const full = await gmail.users.threads.get({ userId: 'me', id: t.id!, format: 'full' });
        return full.data;
      }));
      console.log(`[${requestId}] Step 3b: Fetched thread details in ${Date.now() - threadStart}ms`);

      let enrichments: Map<string, any> | undefined;
      try {
        const { claudeEnricher } = await import('../lib/claudeEnricher.js');

        if (claudeEnricher.isEnabled()) {
          console.log(`[${requestId}] Step 3c: Enriching Gmail threads with Claude AI...`);
          const enrichStart = Date.now();

          const enricherThreads = threads.map(t => ({
            threadId: t.id!,
            subject: t.messages?.[0]?.payload?.headers?.find(h => h.name === 'Subject')?.value || '',
            messages: (t.messages || []).map(m => ({
              from: m.payload?.headers?.find(h => h.name === 'From')?.value || undefined,
              to: m.payload?.headers?.find(h => h.name === 'To')?.value || undefined,
              date: m.payload?.headers?.find(h => h.name === 'Date')?.value || undefined,
              snippet: m.snippet || undefined
            }))
          }));

          enrichments = await claudeEnricher.enrichThreads(
            enricherThreads,
            ev.data.summary || 'Untitled Meeting',
            ev.data.start?.dateTime || ev.data.start?.date || undefined
          );

          console.log(`[${requestId}] Step 3c: Enriched ${enrichments.size} threads in ${Date.now() - enrichStart}ms`);
        } else {
          console.log(`[${requestId}] Step 3c: Claude enrichment disabled (no API key)`);
        }
      } catch (enrichError) {
        console.error(`[${requestId}] Enrichment failed, continuing without:`, enrichError);
      }

      console.log(`[${requestId}] Step 4: Researching attendee companies...`);
      let companyResearchResults: any[] = [];
      try {
        const { handler: companyResearchHandler } = await import('./company.research.v1.js');

        const attendeeDomains = new Map<string, string>();
        for (const attendee of attendees) {
          const domain = attendee.split('@')[1];
          if (domain && !domain.includes('gmail.com') && !domain.includes('yahoo.com') && !domain.includes('hotmail.com') && !domain.includes('outlook.com')) {
            attendeeDomains.set(domain, attendee);
          }
        }

        const researchPromises = Array.from(attendeeDomains.entries()).map(async ([domain, email]) => {
          try {
            const result = await companyResearchHandler({ userId, domain }, { userId, storage: null });
            return { ...result, matchedAttendee: email };
          } catch (error) {
            console.error(`[${requestId}] Company research failed for ${domain}:`, error);
            return null;
          }
        });

        const results = await Promise.all(researchPromises);
        companyResearchResults = results.filter(r => r !== null);

        console.log(`[${requestId}] Step 4: Researched ${companyResearchResults.length} companies`);
      } catch (error) {
        console.error(`[${requestId}] Company research step failed:`, error);
      }

      console.log(`[${requestId}] Step 5: Checking Salesforce...`);
      let salesforceData;
      try {
        const { storage } = await import('../../server/storage.js');
        const salesforceIntegration = await storage.getSalesforceIntegration(userId, requestId);
        
        if (salesforceIntegration?.isActive) {
          const { salesforceCrmService } = await import('../../server/services/salesforceCrm.js');
          
          const attendeeDomains = attendees
            .map(email => email.split('@')[1])
            .filter(d => d && !d.includes('gmail.com') && !d.includes('outlook.com'));
          
          let account: any = undefined;
          let opportunity: any = undefined;
          let contacts: any = undefined;
          
          if (attendeeDomains.length > 0) {
            const accountSearch = await salesforceCrmService.searchRecords(userId, attendeeDomains[0], ['Account']);
            account = accountSearch.find((r: any) => r.attributes.type === 'Account');
            
            if (account) {
              const oppSearch = await salesforceCrmService.getOpportunities(userId);
              opportunity = oppSearch.find((opp: any) => opp.AccountId === account.Id);
            }
          }
          
          if (attendees.length > 0) {
            const contactSearches = await Promise.all(
              attendees.slice(0, 3).map(email => 
                salesforceCrmService.searchRecords(userId, email, ['Contact'])
              )
            );
            contacts = contactSearches.flat().filter((r: any) => r.attributes.type === 'Contact');
          }
          
          salesforceData = { account, opportunity, contacts };
          console.log(`[${requestId}] Step 5: Salesforce data found`);
        } else {
          console.log(`[${requestId}] Step 5: Salesforce not connected`);
        }
      } catch (sfError) {
        console.warn(`[${requestId}] Salesforce lookup failed:`, sfError);
      }
      
      console.log(`[${requestId}] Step 6: Building minimal prep...`);
      const minimalPrep = buildMinimalPrep({
        userId,
        event: {
          id: ev.data.id ?? eventId,
          summary: ev.data.summary ?? undefined,
          start: ev.data.start ? {
            dateTime: ev.data.start.dateTime ?? undefined,
            date: ev.data.start.date ?? undefined
          } : undefined,
          end: ev.data.end ? {
            dateTime: ev.data.end.dateTime ?? undefined,
            date: ev.data.end.date ?? undefined
          } : undefined,
          attendees: ev.data.attendees?.map(a => ({
            email: a.email ?? undefined,
            displayName: a.displayName ?? undefined,
            responseStatus: a.responseStatus ?? undefined
          }))
        },
        gmailThreads: threads as any,
        salesforce: salesforceData,
        enrichments,
        companyResearch: companyResearchResults.length > 0 ? companyResearchResults : undefined
      });
      
      const saved = saveMinimalPrep(minimalPrep);
      const totalTime = Date.now() - startTime;

      console.log(`[${requestId}] Prep summary:`);
      console.log(`  - Gmail threads: ${threads.length}`);
      console.log(`  - Enriched threads: ${enrichments?.size || 0}`);
      console.log(`  - Company research: ${companyResearchResults.length}`);
      console.log(`  - Salesforce data: ${salesforceData ? 'Yes' : 'No'}`);
      console.log(`[${requestId}] prep.generate.v1 completed in ${totalTime}ms`);
      
      return saved;
    } else {
      const attendees = (ev.data.attendees || []).map(a => a.email!).filter(Boolean);
      const subject = (ev.data.summary || '').slice(0, 80);

      const q = `${attendees.map(a => `from:${a}`).join(' OR ')} ${subject ? `subject:("${subject}")` : ''}`;
      const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 3 });
      const threads = await Promise.all((list.data.threads || []).map(async t => {
        const full = await gmail.users.threads.get({ userId: 'me', id: t.id! });
        const last = full.data.messages?.at(-1);
        return { id: t.id, snippet: last?.snippet || '' };
      }));

      const sections = {
        snapshot: `Meeting: ${ev.data.summary || 'Untitled'}\nParticipants: ${attendees.join(', ')}`,
        lastContact: threads.map(t => `• ${t.snippet}`),
        priorities: ['Improve efficiency', 'De-risk project', 'Hit KPIs'],
        risks: [
          { risk: 'No budget', counter: 'Prove ROI with pilot' }, 
          { risk: 'Competing vendor', counter: 'Differentiate on speed' }, 
          { risk: 'Timing', counter: 'Offer fast start' }
        ],
        questions: [
          'What triggered this meeting?', 
          'Who is the economic buyer?', 
          'What does success look like?', 
          'Timeline?', 
          'Risks?'
        ],
        agenda: [
          'Context (5m)', 
          'Discovery (15m)', 
          'Solution preview (10m)', 
          'Next steps (5m)'
        ],
        notes: '',
      };

      const saved = savePrep({ userId, eventId, sections });
      return { prepId: saved.id, url: `/prep/${saved.id}` };
    }
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error(`[${requestId}] prep.generate.v1 FAILED after ${elapsed}ms:`, errorMessage);
    
    if (error instanceof HttpError) {
      throw error;
    }
    
    const statusCode = error?.response?.status || error?.code || error?.status;
    const errorReason = error?.errors?.[0]?.reason;
    
    const isTokenExpired = statusCode === 401 || 
      errorReason === 'authError' ||
      errorMessage.includes('invalid_grant') || 
      errorMessage.includes('Token has been expired') ||
      errorMessage.includes('Invalid Credentials');
    
    if (isTokenExpired) {
      throw new HttpError(
        401,
        'GOOGLE_TOKEN_EXPIRED',
        'Google authentication has expired. Please reconnect your Google account.'
      );
    }
    
    const isNotFound = statusCode === 404 || 
      errorMessage.includes('Not Found') || 
      errorMessage.includes('notFound');
    
    if (isNotFound) {
      throw new HttpError(
        404,
        'EVENT_NOT_FOUND',
        'Calendar event not found'
      );
    }
    
    throw new HttpError(
      500,
      'PREP_GENERATION_FAILED',
      errorMessage
    );
  }
}
