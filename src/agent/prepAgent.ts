import { z } from 'zod';
import type { MCPToolContext } from '../contracts/index.js';
import { integrationError } from '../errors.js';

const PrepSheetRequestSchema = z.object({
  intent: z.literal('PREP_SHEET'),
  userId: z.string()
});

type PrepSheetRequest = z.infer<typeof PrepSheetRequestSchema>;

interface PrepSheetSection {
  company_brief: string;
  stakeholders: string[];
  risks: string[];
  objections: string[];
  agenda: string[];
  cheatsheet: string[];
}

interface PrepSheetResponse {
  eventId: string;
  sections: PrepSheetSection;
}

export async function handlePrepSheet(
  request: PrepSheetRequest,
  context: MCPToolContext
): Promise<PrepSheetResponse> {
  console.log('[PrepAgent] Generating prep sheet for user:', request.userId);

  // Import tool handlers
  const calendarTool = await import('../tools/calendar.next_events.v1.js');
  const salesforceTool = await import('../tools/salesforce.lookup_account.v1.js');

  // Get upcoming events in the next 3 hours
  const now = new Date();
  const threeHoursFromNow = new Date(now.getTime() + (3 * 60 * 60 * 1000));

  console.log('[PrepAgent] Fetching calendar events from', now.toISOString(), 'to', threeHoursFromNow.toISOString());

  const calendarResult = await calendarTool.handler({
    userId: request.userId,
    timeRange: {
      start: now.toISOString(),
      end: threeHoursFromNow.toISOString()
    },
    includeAttendees: true
  }, context);

  if (!calendarResult.events || calendarResult.events.length === 0) {
    throw integrationError('NO_UPCOMING_EVENTS', 'No meetings in the next 3 hours');
  }

  // Get the next event
  const nextEvent = calendarResult.events[0];
  console.log('[PrepAgent] Next event:', nextEvent.summary);

  // Try to extract company domain from attendees
  let companyBrief = '';
  const stakeholders: string[] = [];
  
  if (nextEvent.attendees && nextEvent.attendees.length > 0) {
    for (const attendee of nextEvent.attendees) {
      if (attendee.email) {
        stakeholders.push(`${attendee.displayName || attendee.email} (${attendee.email})`);
        
        // Extract domain from email
        const domain = attendee.email.split('@')[1];
        if (domain && !domain.includes('gmail.com') && !domain.includes('yahoo.com') && !domain.includes('outlook.com')) {
          try {
            console.log('[PrepAgent] Looking up Salesforce account for domain:', domain);
            const salesforceResult = await salesforceTool.handler({
              userId: request.userId,
              domain: domain
            }, context);

            if (salesforceResult.accounts && salesforceResult.accounts.length > 0) {
              const account = salesforceResult.accounts[0];
              companyBrief = `${account.Name}${account.Industry ? ` - ${account.Industry}` : ''}${account.NumberOfEmployees ? ` (${account.NumberOfEmployees} employees)` : ''}. ${account.Description || ''}`;
              console.log('[PrepAgent] Found Salesforce account:', account.Name);
            }
          } catch (error: any) {
            console.log('[PrepAgent] Salesforce lookup failed (may not be connected):', error.message);
            // Continue without Salesforce data
          }
        }
      }
    }
  }

  // Return prep sheet with empty or populated sections
  return {
    eventId: nextEvent.id,
    sections: {
      company_brief: companyBrief,
      stakeholders: stakeholders,
      risks: [],
      objections: [],
      agenda: [],
      cheatsheet: []
    }
  };
}

export async function handleAgentAction(
  args: unknown,
  context: MCPToolContext
): Promise<PrepSheetResponse> {
  const request = PrepSheetRequestSchema.parse(args);

  if (request.intent === 'PREP_SHEET') {
    return handlePrepSheet(request, context);
  }

  throw new Error(`Unknown intent: ${request.intent}`);
}
