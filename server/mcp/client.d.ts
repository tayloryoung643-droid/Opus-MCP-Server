export interface McpServices {
  gcal?: any;
  sf?: any;
  gmail?: any;
}

export interface IntegrationStatus {
  hasGoogle: boolean;
  hasSalesforce: boolean;
  hasGmail: boolean;
}

export function createMcpContext(userId: string): Promise<McpServices>;
export function validateUserIntegrations(userId: string): Promise<IntegrationStatus>;
