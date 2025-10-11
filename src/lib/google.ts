import { google } from 'googleapis';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI } = process.env;

export function getOAuthClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error('Google OAuth env not set (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI)');
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI
  );
}

export async function makeClientsFor(userId: string, tokens: any) {
  const oauth2 = getOAuthClient();
  oauth2.setCredentials(tokens);
  return {
    calendar: google.calendar({ version: 'v3', auth: oauth2 }),
    gmail: google.gmail({ version: 'v1', auth: oauth2 }),
  };
}
