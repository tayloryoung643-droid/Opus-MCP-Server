import { gmailSearchThreadsSchemaV1, type GmailThread, type MCPToolContext } from '../contracts/index.js';
import { HttpError } from '../errors.js';
import { getGoogleTokens } from '../lib/tokenStore.js';
import { makeClientsFor } from '../lib/google.js';

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

    // Check if user has connected Google
    const tokens = await getGoogleTokens(params.userId);
    if (!tokens) {
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Gmail not connected',
        { hint: `Connect Google at /connect?userId=${params.userId}` }
      );
    }

    // Create Gmail client with stored tokens
    const { gmail } = await makeClientsFor(params.userId, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryDate,
    });

    // Search threads using Gmail API
    const q = params.q || 'newer_than:7d';
    const maxResults = params.maxResults || 50;

    const { data } = await gmail.users.threads.list({
      userId: 'me',
      q,
      maxResults,
    });

    const threads: GmailThread[] = (data.threads || []).map(t => ({
      id: t.id || '',
      snippet: t.snippet,
    }));

    console.log(`[MCP-Tool:${name}] Found ${threads.length} threads`);

    return { threads };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
