export interface SalesforceAccountOptions {
  queryText?: string;
  limit?: number;
  fields?: string[];
}

export interface SalesforceOpportunityOptions {
  limit?: number;
  accountId?: string;
  contactId?: string;
  fields?: string[];
}

export interface SalesforceCrmService {
  getAccountById(userId: string, accountId: string, requestId?: string, fields?: string[]): Promise<any | null>;
  searchRecords(userId: string, queryText?: string, objectTypes?: string[], requestId?: string): Promise<any[]>;
  searchAccounts(userId: string, options?: SalesforceAccountOptions, requestId?: string): Promise<any[]>;
  getOpportunityById(userId: string, opportunityId: string, requestId?: string, fields?: string[]): Promise<any | null>;
  getOpportunities(userId: string, options?: SalesforceOpportunityOptions, requestId?: string): Promise<any[]>;
}

export const salesforceCrmService: SalesforceCrmService;
export default salesforceCrmService;
