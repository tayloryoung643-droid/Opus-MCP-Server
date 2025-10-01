import {
  salesforceOpportunityLookupSchemaV1,
  type SalesforceOpportunity,
  type MCPToolContext
} from '../contracts/index.js';
import { integrationError } from '../errors.js';

export const name = 'salesforce.lookup_opportunity.v1';
export const version = 'v1';
export const inputSchema = salesforceOpportunityLookupSchemaV1;
export const description = 'Get opportunity details from Salesforce';

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<{ opportunities: SalesforceOpportunity[]; total: number }> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);

    const salesforceIntegration = await context.storage.getSalesforceIntegration(context.userId);
    if (!salesforceIntegration?.isActive) {
      throw integrationError('SALESFORCE_NOT_CONNECTED', 'Connect Salesforce to access CRM data');
    }

    const { salesforceCrmService } = await import('../../../server/services/salesforceCrm.js');

    let opportunities: any[] = [];

    if (params.opportunityId) {
      const allOpportunities = await salesforceCrmService.getOpportunities(context.userId, 50);
      opportunities = allOpportunities.filter((opp: any) => opp.Id === params.opportunityId);
    } else if (params.contactId || params.accountId) {
      opportunities = await salesforceCrmService.getOpportunities(context.userId, 50);
    } else {
      opportunities = await salesforceCrmService.getOpportunities(context.userId, 50);
    }

    const transformedOpportunities: SalesforceOpportunity[] = opportunities.map(opp => ({
      Id: opp.Id,
      Name: opp.Name,
      StageName: opp.StageName,
      Amount: opp.Amount,
      CloseDate: opp.CloseDate,
      AccountId: opp.AccountId,
      AccountName: opp.Account?.Name
    }));

    console.log(`[MCP-Tool:${name}] Found ${transformedOpportunities.length} opportunities`);

    return {
      opportunities: transformedOpportunities,
      total: transformedOpportunities.length
    };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
