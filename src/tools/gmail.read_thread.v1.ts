import { gmailReadThreadSchemaV1, type GmailMessage, type MCPToolContext } from '../contracts/index.js';
import { HttpError, badRequest } from '../errors.js';
import { getGoogleTokens, saveGoogleTokens } from '../lib/tokenStore.js';
import { makeClientsFor } from '../lib/google.js';
import { fetchGoogleTokens } from '../lib/tokenProvider.js';

export const name = 'gmail.read_thread.v1';
export const version = 'v1';
export const inputSchema = gmailReadThreadSchemaV1;
export const description = 'Read a Gmail thread by ID and return normalized headers and text bodies';

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<{ threadId: string; messages: GmailMessage[] }> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);

    if (!params.threadId) {
      throw badRequest('threadId is required');
    }

    // Check if user has connected Google (local tokens first, then token provider)
    let tokens = await getGoogleTokens(params.userId);
    
    if (!tokens) {
      console.log(`[MCP-Tool:${name}] No local tokens found, trying token provider...`);
      tokens = await fetchGoogleTokens(params.userId);
      
      if (tokens) {
        console.log(`[MCP-Tool:${name}] Token provider returned tokens, saving locally`);
        await saveGoogleTokens(params.userId, tokens);
      }
    }
    
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

    // Fetch thread from Gmail API
    const { data } = await gmail.users.threads.get({
      userId: 'me',
      id: params.threadId,
      format: 'full',
    });

    // Extract messages from thread
    const messages: GmailMessage[] = (data.messages || []).map(msg => {
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) => 
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      return {
        id: msg.id || '',
        date: getHeader('date'),
        from: getHeader('from'),
        to: getHeader('to'),
        subject: getHeader('subject'),
        snippet: msg.snippet || '',
      };
    });

    console.log(`[MCP-Tool:${name}] Read ${messages.length} messages from thread`);

    return { 
      threadId: data.id || params.threadId, 
      messages 
    };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
