import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = neon(connectionString);

// Service stubs that integrate with user's external services
const createGoogleCalendarService = (userId) => ({
  async getEvents(userId) {
    // This is a stub - real implementation would use Google Calendar API
    console.log('[MCP-Client] Google Calendar service called for user:', userId);
    return [];
  }
});

const createSalesforceService = (userId) => ({
  async getOpportunities(userId, limit = 10) {
    // This is a stub - real implementation would use Salesforce API
    console.log('[MCP-Client] Salesforce service called for user:', userId);
    return [];
  }
});

const createGmailService = (userId) => ({
  async searchThreads(userId, query, limit = 5) {
    // This is a stub - real implementation would use Gmail API
    console.log('[MCP-Client] Gmail service called for user:', userId);
    return [];
  }
});

export async function createMcpContext(userId) {
  console.log('[MCP-Client] Creating MCP context for user:', userId);
  
  return {
    gcal: createGoogleCalendarService(userId),
    sf: createSalesforceService(userId),
    gmail: createGmailService(userId)
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
