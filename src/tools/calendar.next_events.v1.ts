import {
  calendarMeetingContextSchemaV1,
  type CalendarEvent,
  type MCPToolContext
} from '../contracts/index.js';
import { HttpError, integrationError } from '../errors.js';

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

    // Check integration status first
    const integration = await context.storage.getGoogleIntegration(context.userId);
    if (!integration?.isActive) {
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Google Calendar not connected',
        { hint: 'Connect in Settings → Integrations' }
      );
    }

    // Try to load the Google Calendar service
    let googleCalendarService;
    try {
      const module = await import('../../../server/services/googleCalendar.js');
      googleCalendarService = module.googleCalendarService;
    } catch (importError: any) {
      // Service not installed or OAuth not configured
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Google Calendar not connected',
        { hint: 'Connect in Settings → Integrations' }
      );
    }

    let events: any[] = [];

    if (params.eventId) {
      const event = await googleCalendarService.getEventById(context.userId, params.eventId);
      if (event) events = [event];
    } else if (params.contactEmail) {
      const allEvents = await googleCalendarService.getUpcomingEvents(context.userId, 50);
      events = allEvents.filter((event: any) => {
        if (!event.attendees) return false;
        return event.attendees.some((attendee: any) => attendee.email === params.contactEmail);
      });
    } else if (params.timeRange) {
      events = await googleCalendarService.getEventsInRange(
        context.userId,
        params.timeRange.start,
        params.timeRange.end
      );
    } else if (params.startIso && params.endIso) {
      events = await googleCalendarService.getEventsInRange(
        context.userId,
        params.startIso,
        params.endIso
      );
    } else if (params.window) {
      events = await googleCalendarService.getEventsInRange(
        context.userId,
        params.window.startIso,
        params.window.endIso
      );
    } else if (params.daysAhead) {
      const now = new Date();
      const futureDate = new Date(now.getTime() + (params.daysAhead * 24 * 60 * 60 * 1000));
      events = await googleCalendarService.getEventsInRange(
        context.userId,
        now.toISOString(),
        futureDate.toISOString()
      );
    } else {
      const allEvents = await googleCalendarService.getUpcomingEvents(context.userId, 200);
      const now = new Date();
      const next24Hours = new Date(now.getTime() + (24 * 60 * 60 * 1000));

      events = allEvents.filter((event: any) => {
        const eventStartStr = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00Z` : null);
        if (!eventStartStr || !event.start?.dateTime) return false;
        const eventTime = new Date(eventStartStr);
        return eventTime <= next24Hours;
      }).slice(0, 10);
    }

    const transformedEvents: CalendarEvent[] = events.map(event => ({
      id: event.id,
      summary: event.summary || 'No Title',
      start: event.start,
      end: event.end,
      attendees: params.includeAttendees ? event.attendees?.map((attendee: any) => ({
        email: attendee.email,
        displayName: attendee.displayName,
        responseStatus: attendee.responseStatus
      })) : undefined,
      description: event.description,
      location: event.location
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
