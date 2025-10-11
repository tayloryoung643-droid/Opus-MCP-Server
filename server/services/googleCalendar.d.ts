export interface GoogleCalendarService {
  getUpcomingEvents(userId: string, limit?: number, requestId?: string): Promise<any[]>;
  getEventsInRange(userId: string, startIso: string, endIso: string, requestId?: string): Promise<any[]>;
  getEventById(userId: string, eventId: string, requestId?: string): Promise<any | null>;
}

export const googleCalendarService: GoogleCalendarService;
export default googleCalendarService;
