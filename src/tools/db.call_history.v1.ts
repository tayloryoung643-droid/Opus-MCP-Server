import {
  callHistoryLookupSchemaV1,
  type CallHistory,
  type MCPToolContext
} from '../contracts/index.js';

export const name = 'db.call_history.v1';
export const version = 'v1';
export const inputSchema = callHistoryLookupSchemaV1;
export const description = 'Get historical call data for contacts or companies from the database';

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<{ calls: CallHistory[]; searchCriteria: string; total: number }> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);
    const storage = context.storage;

    const now = new Date();
    const lookbackDate = new Date(now.getTime() - (params.lookbackDays * 24 * 60 * 60 * 1000));

    let calls: any[] = [];
    let searchCriteria = '';

    try {
      if (params.contactEmail) {
        searchCriteria = `contact email: ${params.contactEmail}`;
        const companies = await storage.getCompaniesByContactEmail(params.contactEmail);
        const companyIds = companies.map((c: any) => c.id);

        if (companyIds.length > 0) {
          calls = await storage.getCallsByCompanyIds(companyIds, lookbackDate, params.maxResults);
        }
      } else if (params.companyName) {
        searchCriteria = `company name: ${params.companyName}`;
        const companies = await storage.getCompaniesByName(params.companyName);
        const companyIds = companies.map((c: any) => c.id);

        if (companyIds.length > 0) {
          calls = await storage.getCallsByCompanyIds(companyIds, lookbackDate, params.maxResults);
        }
      } else if (params.companyDomain) {
        searchCriteria = `company domain: ${params.companyDomain}`;
        const company = await storage.getCompanyByDomain(params.companyDomain);
        if (company) {
          calls = await storage.getCallsByCompanyIds([company.id], lookbackDate, params.maxResults);
        }
      }
    } catch (error) {
      console.warn(`[MCP-Tool:${name}] Storage query failed, using fallback:`, error);
      const recentCalls = await storage.getPreviousCalls();
      calls = recentCalls.filter((call: any) => {
        const callDate = new Date(call.scheduledAt);
        return callDate >= lookbackDate;
      }).slice(0, params.maxResults);
    }

    const transformedCalls: CallHistory[] = await Promise.all(
      calls.map(async (call: any) => {
        const company = call.companyId ? await storage.getCompany(call.companyId) : null;
        const contacts = call.companyId ? await storage.getContactsByCompany(call.companyId) : [];
        const callPrep = await storage.getCallPrep(call.id);
        const notes = await storage.getPrepNotes(call.id);

        return {
          id: call.id,
          title: call.title,
          scheduledAt: new Date(call.scheduledAt),
          status: call.status,
          companyName: company?.name,
          contactEmails: contacts.map((c: any) => c.email).filter(Boolean),
          callPrep: callPrep ? {
            executiveSummary: callPrep.executiveSummary,
            conversationStrategy: callPrep.conversationStrategy
          } : undefined,
          notes: notes?.text
        };
      })
    );

    console.log(`[MCP-Tool:${name}] Found ${transformedCalls.length} call history records`);

    return {
      calls: transformedCalls,
      searchCriteria,
      total: transformedCalls.length
    };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
