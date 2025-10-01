import { gmailSearchThreadsSchemaV1, type GmailThread, type MCPToolContext } from '../contracts/index.js';
import { integrationError } from '../errors.js';

export const name = 'gmail.search_threads.v1';
export const version = 'v1';
export const inputSchema = gmailSearchThreadsSchemaV1;
export const description = 'Search recent Gmail threads with a Gmail query';

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<{ threads: GmailThread[] }> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);
    const userId = params.userId;

    const googleIntegration = await context.storage.getGoogleIntegration(userId);
    if (!googleIntegration?.accessToken) {
      throw integrationError('GOOGLE_NOT_CONNECTED', 'Connect Google to access Gmail');
    }

    const tokens = {
      access_token: googleIntegration.accessToken,
      refresh_token: googleIntegration.refreshToken,
      expiry_date: googleIntegration.tokenExpiry?.getTime()
    };

    const { listRecentThreads } = await import('../../../server/services/gmail.js');
    const q = params.q || "newer_than:7d";
    const threads = await listRecentThreads(tokens, q);

    const result = threads?.map(t => ({ id: t.id, historyId: t.historyId })) || [];

    console.log(`[MCP-Tool:${name}] Found ${result.length} threads`);

    return { threads: result };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
