import { MCPToolContext } from '../contracts/index.js';

export class UnifiedMCPContextResolver {
  private mcpContext: MCPToolContext | null = null;
  private mcpServices: any = null;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async initialize(): Promise<void> {
    try {
      const { createMcpContext } = await import('../../../server/mcp/client.js');
      const { storage } = await import('../../../server/storage.js');
      
      this.mcpServices = await createMcpContext(this.userId);
      
      this.mcpContext = {
        userId: this.userId,
        storage: storage,
        googleCalendarService: this.mcpServices.gcal,
        salesforceCrmService: this.mcpServices.sf,
        user: { id: this.userId }
      };

      console.log(`[MCP-Resolver] Initialized context for user ${this.userId}`);
    } catch (error) {
      console.error('[MCP-Resolver] Failed to initialize context:', error);
      throw error;
    }
  }

  async executeTool(toolName: string, args: any = {}): Promise<any> {
    if (!this.mcpContext) {
      await this.initialize();
    }

    try {
      console.log(`[MCP-Resolver] Executing tool: ${toolName} for user ${this.userId}`);
      
      const toolModule = await import(`../tools/${toolName}.js`);
      const result = await toolModule.handler(args, this.mcpContext!);
      
      console.log(`[MCP-Resolver] Tool ${toolName} completed successfully`);
      return result;
    } catch (error) {
      console.error(`[MCP-Resolver] Tool ${toolName} execution failed:`, error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        fallback: true
      };
    }
  }

  async checkIntegrations(): Promise<{
    hasGoogle: boolean;
    hasSalesforce: boolean;
    hasGmail: boolean;
  }> {
    const { validateUserIntegrations } = await import('../../../server/mcp/client.js');
    return await validateUserIntegrations(this.userId);
  }
}

export async function createUnifiedMCPResolver(userId: string): Promise<UnifiedMCPContextResolver> {
  const resolver = new UnifiedMCPContextResolver(userId);
  await resolver.initialize();
  return resolver;
}
