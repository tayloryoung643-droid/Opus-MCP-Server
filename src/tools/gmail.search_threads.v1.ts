import { gmailSearchThreadsSchemaV1, type GmailThread, type MCPToolContext } from '../contracts/index.js';
import { HttpError, integrationError } from '../errors.js';

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

    const googleIntegration = await context.storage.getGoogleIntegration(userId, context.requestId);
    if (!googleIntegration?.accessToken) {
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Gmail not connected',
        { hint: 'Connect in Settings → Integrations' }
      );
    }

    const tokens = {
      access_token: googleIntegration.accessToken,
      refresh_token: googleIntegration.refreshToken,
      expiry_date: googleIntegration.tokenExpiry?.getTime()
    };

    // Try to load the Gmail service
    let listRecentThreads;
    try {
      const module = await import('../../../server/services/gmail.js');
      listRecentThreads = module.listRecentThreads;
    } catch (importError: any) {
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Gmail not connected',
        { hint: 'Connect in Settings → Integrations' }
      );
    }

    const q = params.q || "newer_than:7d";
    const threads = await listRecentThreads(tokens, q);

    const result = threads?.map((t: any) => ({ id: t.id, historyId: t.historyId })) || [];

    console.log(`[MCP-Tool:${name}] Found ${result.length} threads`);

    return { threads: result };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
