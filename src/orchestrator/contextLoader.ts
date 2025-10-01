export interface SalesContext {
  events: any[];
  opportunities: any[];
  recentThreads: any[];
  integrationStatus: {
    hasGoogle: boolean;
    hasSalesforce: boolean;
    hasGmail: boolean;
  };
}

export async function buildSalesContext({ mcp, userId }: { mcp: any; userId: string }): Promise<SalesContext> {
  const context: SalesContext = {
    events: [],
    opportunities: [],
    recentThreads: [],
    integrationStatus: {
      hasGoogle: false,
      hasSalesforce: false,
      hasGmail: false
    }
  };

  const { validateUserIntegrations } = await import('../../../server/mcp/client.js');
  context.integrationStatus = await validateUserIntegrations(userId);

  console.log(`[MCP-Context] Building sales context for user ${userId}:`, context.integrationStatus);

  if (context.integrationStatus.hasGoogle) {
    try {
      const events = await mcp.gcal.getEvents(userId);
      context.events = events?.slice(0, 5) || [];
      console.log(`[MCP-Context] Loaded ${context.events.length} calendar events`);
    } catch (error) {
      console.error('[MCP-Context] Error loading calendar events:', error);
    }
  }

  if (context.integrationStatus.hasSalesforce) {
    try {
      const opportunities = await mcp.sf.getOpportunities(userId, 10);
      context.opportunities = opportunities || [];
      console.log(`[MCP-Context] Loaded ${context.opportunities.length} opportunities`);
    } catch (error) {
      console.error('[MCP-Context] Error loading opportunities:', error);
    }
  }

  if (context.integrationStatus.hasGmail) {
    try {
      const threads = await mcp.gmail.searchThreads(userId, 'newer_than:30d category:primary', 5);
      context.recentThreads = threads || [];
      console.log(`[MCP-Context] Loaded ${context.recentThreads.length} recent email threads`);
    } catch (error) {
      console.error('[MCP-Context] Error loading email threads:', error);
    }
  }

  return context;
}

export function formatContextForModel(context: SalesContext): string {
  const sections = [];

  if (context.integrationStatus.hasGoogle && context.events.length > 0) {
    const eventList = context.events.map(event => 
      `- ${event.summary} (${event.startDateTime || event.startDate})`
    ).join('\n');
    sections.push(`📅 UPCOMING MEETINGS:\n${eventList}`);
  } else if (context.integrationStatus.hasGoogle) {
    sections.push('📅 CALENDAR: No upcoming meetings found');
  } else {
    sections.push('📅 CALENDAR: Not connected (recommend connecting Google Calendar)');
  }

  if (context.integrationStatus.hasSalesforce && context.opportunities.length > 0) {
    const oppList = context.opportunities.map(opp => 
      `- ${opp.Name}: ${opp.StageName} - ${opp.Amount ? `$${opp.Amount}` : 'Amount TBD'}`
    ).join('\n');
    sections.push(`🏢 SALES PIPELINE:\n${oppList}`);
  } else if (context.integrationStatus.hasSalesforce) {
    sections.push('🏢 SALESFORCE: Connected but no opportunities found');
  } else {
    sections.push('🏢 SALESFORCE: Not connected (recommend connecting for CRM data)');
  }

  if (context.integrationStatus.hasGmail && context.recentThreads.length > 0) {
    sections.push(`📧 RECENT EMAIL: ${context.recentThreads.length} recent threads available`);
  } else if (context.integrationStatus.hasGmail) {
    sections.push('📧 EMAIL: Connected but no recent threads found');
  } else {
    sections.push('📧 EMAIL: Not connected (recommend connecting Gmail for email context)');
  }

  return sections.join('\n\n');
}
