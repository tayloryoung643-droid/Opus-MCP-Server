import {
  calendarMeetingContextSchemaV1,
  type CalendarEvent,
  type MCPToolContext
} from '../contracts/index.js';
import { HttpError } from '../errors.js';
import { getGoogleTokens } from '../lib/tokenStore.js';
import { makeClientsFor } from '../lib/google.js';

export const name = 'calendar.next_events.v1';
export const version = 'v1';
export const inputSchema = calendarMeetingContextSchemaV1;
export const description = 'Get details about upcoming or recent meetings from Google Calendar';

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<{ events: CalendarEvent[]; total: number }> {
  const startTime = Date.now();
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);

    // Check if user has connected Google
    const tokens = await getGoogleTokens(params.userId);
    if (!tokens) {
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Google Calendar not connected',
        { hint: `Connect Google at /connect?userId=${params.userId}` }
      );
    }

    // Create Google Calendar client with stored tokens
    const { calendar } = await makeClientsFor(params.userId, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate,
    });

    // Determine time range
    let timeMin: string | undefined;
    let timeMax: string | undefined;
    
    if (params.timeRange) {
      timeMin = params.timeRange.start;
      timeMax = params.timeRange.end;
    } else if (params.startIso && params.endIso) {
      timeMin = params.startIso;
      timeMax = params.endIso;
    } else if (params.window) {
      timeMin = params.window.startIso;
      timeMax = params.window.endIso;
    } else if (params.daysAhead) {
      timeMin = new Date().toISOString();
      timeMax = new Date(Date.now() + params.daysAhead * 24 * 60 * 60 * 1000).toISOString();
    } else {
      timeMin = new Date().toISOString();
      timeMax = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }

    // Fetch events from Google Calendar
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: params.maxResults || 50,
    });

    let events = data.items || [];

    // Filter by eventId if specified
    if (params.eventId) {
      events = events.filter(e => e.id === params.eventId);
    }

    // Filter by contactEmail if specified
    if (params.contactEmail) {
      events = events.filter(event => 
        event.attendees?.some(attendee => attendee.email === params.contactEmail)
      );
    }

    // Transform to our schema
    const transformedEvents: CalendarEvent[] = events.map(event => ({
      id: event.id || '',
      summary: event.summary || 'No Title',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      attendees: params.includeAttendees ? event.attendees?.map(attendee => ({
        email: attendee.email || '',
        displayName: attendee.displayName,
        responseStatus: attendee.responseStatus,
      })) : undefined,
      description: event.description,
      location: event.location,
      hangoutLink: event.hangoutLink,
    }));

    const duration = Date.now() - startTime;
    console.log(`[MCP-Tool:${name}] SUCCESS: Found ${transformedEvents.length} events in ${duration}ms`);

    return {
      events: transformedEvents,
      total: transformedEvents.length
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MCP-Tool:${name}] ERROR after ${duration}ms:`, error);
    throw error;
  }
}
