import { getTokensFor, clearTokenCache } from '../../src/tokenProvider.js';

const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const DEFAULT_CALENDAR_ID = 'primary';

function log(rid, message, extra = {}) {
  const payload = { rid, source: 'GoogleCalendarService', ...extra };
  console.log(`[GoogleCalendar] ${message}`, payload);
}

function buildUrl(path, query) {
  const url = new URL(`${GOOGLE_CALENDAR_API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

async function fetchWithToken(userId, requestId, path, { query, method = 'GET' } = {}, attempt = 1) {
  const rid = requestId ?? `gcal-${attempt}`;
  const tokens = await getTokensFor(userId, rid);

  if (!tokens?.google?.accessToken) {
    log(rid, 'No Google tokens available', { userId });
    return null;
  }

  const url = buildUrl(path, query);
  const headers = {
    'Authorization': `Bearer ${tokens.google.accessToken}`,
    'Accept': 'application/json'
  };

  if (requestId) {
    headers['x-request-id'] = requestId;
  }

  const response = await fetch(url, { method, headers });

  if (response.status === 401 || response.status === 403) {
    log(rid, 'Received unauthorized response, clearing cache and retrying', {
      userId,
      status: response.status,
      attempt
    });

    if (attempt === 1) {
      clearTokenCache(userId);
      return fetchWithToken(userId, requestId, path, { query, method }, attempt + 1);
    }
  }

  if (!response.ok) {
    const errorBody = await safeReadJson(response);
    log(rid, 'Google API error response', {
      userId,
      status: response.status,
      error: errorBody
    });
    throw new Error(`Google Calendar API request failed with status ${response.status}`);
  }

  return await response.json();
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

async function listEvents(userId, requestId, query) {
  const data = await fetchWithToken(
    userId,
    requestId,
    `/calendars/${encodeURIComponent(DEFAULT_CALENDAR_ID)}/events`,
    { query }
  );

  if (!data) {
    return [];
  }

  return Array.isArray(data.items) ? data.items : [];
}

export const googleCalendarService = {
  async getUpcomingEvents(userId, limit = 10, requestId) {
    const now = new Date().toISOString();
    const query = {
      timeMin: now,
      maxResults: Math.min(Math.max(limit, 1), 250),
      singleEvents: 'true',
      orderBy: 'startTime'
    };

    log(requestId ?? 'gcal-list', 'Fetching upcoming events', { userId, limit: query.maxResults });
    return await listEvents(userId, requestId, query);
  },

  async getEventsInRange(userId, startIso, endIso, requestId) {
    const query = {
      timeMin: startIso,
      timeMax: endIso,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: 250
    };

    log(requestId ?? 'gcal-range', 'Fetching events in range', {
      userId,
      startIso,
      endIso
    });
    return await listEvents(userId, requestId, query);
  },

  async getEventById(userId, eventId, requestId) {
    const data = await fetchWithToken(
      userId,
      requestId,
      `/calendars/${encodeURIComponent(DEFAULT_CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`
    );

    if (!data) {
      return null;
    }

    log(requestId ?? 'gcal-event', 'Fetched event by ID', { userId, eventId });
    return data;
  }
};

export default googleCalendarService;
