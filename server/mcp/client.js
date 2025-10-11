import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = neon(connectionString);

let googleCalendarServiceModule;
let salesforceServiceModule;
let gmailServiceModule;

async function loadGoogleCalendarService() {
  if (!googleCalendarServiceModule) {
    googleCalendarServiceModule = await import('../services/googleCalendar.js');
  }
  return googleCalendarServiceModule.googleCalendarService;
}

async function loadSalesforceService() {
  if (!salesforceServiceModule) {
    salesforceServiceModule = await import('../services/salesforceCrm.js');
  }
  return salesforceServiceModule.salesforceCrmService;
}

async function loadGmailService() {
  if (!gmailServiceModule) {
    try {
      gmailServiceModule = await import('../services/gmail.js');
    } catch {
      gmailServiceModule = { gmailService: undefined };
    }
  }
  return gmailServiceModule.gmailService;
}

export async function createMcpContext(userId) {
  console.log('[MCP-Client] Creating MCP context for user:', userId);

  const [gcal, sf, gmail] = await Promise.all([
    loadGoogleCalendarService(),
    loadSalesforceService(),
    loadGmailService()
  ]);

  return {
    gcal,
    sf,
    gmail
  };
}

export async function validateUserIntegrations(userId) {
  try {
    // Check if user has connected integrations in the database
    const integrations = await sql`
      SELECT integration_type, is_active FROM user_integrations
      WHERE user_id = ${userId}
    `;

    const activeIntegrations = new Set(
      integrations.filter(i => i.is_active).map(i => i.integration_type)
    );

    return {
      hasGoogle: activeIntegrations.has('google') || activeIntegrations.has('google_calendar'),
      hasSalesforce: activeIntegrations.has('salesforce'),
      hasGmail: activeIntegrations.has('gmail') || activeIntegrations.has('google')
    };
  } catch (error) {
    console.error('[MCP-Client] validateUserIntegrations error:', error);
    // Return false for all if there's an error (table might not exist)
    return {
      hasGoogle: false,
      hasSalesforce: false,
      hasGmail: false
    };
  }
}
