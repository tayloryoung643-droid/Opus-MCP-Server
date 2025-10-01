import {
  salesforceAccountLookupSchemaV1,
  type SalesforceAccount,
  type MCPToolContext
} from '../contracts/index.js';
import { integrationError } from '../errors.js';

export const name = 'salesforce.lookup_account.v1';
export const version = 'v1';
export const inputSchema = salesforceAccountLookupSchemaV1;
export const description = 'Retrieve account information from Salesforce';

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<{ accounts: SalesforceAccount[]; total: number }> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);

    const salesforceIntegration = await context.storage.getSalesforceIntegration(context.userId);
    if (!salesforceIntegration?.isActive) {
      throw integrationError('SALESFORCE_NOT_CONNECTED', 'Connect Salesforce to access CRM data');
    }

    const { salesforceCrmService } = await import('../../../server/services/salesforceCrm.js');

    let accounts: any[] = [];

    if (params.accountId) {
      const account = await salesforceCrmService.getAccountById(context.userId, params.accountId);
      accounts = account ? [account] : [];
    } else if (params.name) {
      const searchResults = await salesforceCrmService.searchRecords(context.userId, params.name, ['Account']);
      accounts = searchResults.filter((record: any) => record.attributes.type === 'Account') || [];
    } else if (params.domain) {
      const searchResults = await salesforceCrmService.searchRecords(context.userId, params.domain, ['Account']);
      accounts = searchResults.filter((record: any) => record.attributes.type === 'Account') || [];
    } else {
      const searchResults = await salesforceCrmService.searchRecords(context.userId, '', ['Account']);
      accounts = searchResults.filter((record: any) => record.attributes.type === 'Account') || [];
    }

    const transformedAccounts: SalesforceAccount[] = accounts.map(account => ({
      Id: account.Id,
      Name: account.Name,
      Industry: account.Industry,
      NumberOfEmployees: account.NumberOfEmployees,
      AnnualRevenue: account.AnnualRevenue,
      Website: account.Website,
      Description: account.Description
    }));

    console.log(`[MCP-Tool:${name}] Found ${transformedAccounts.length} accounts`);

    return {
      accounts: transformedAccounts,
      total: transformedAccounts.length
    };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
