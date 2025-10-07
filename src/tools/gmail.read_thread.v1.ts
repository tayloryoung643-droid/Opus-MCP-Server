import { gmailReadThreadSchemaV1, type GmailMessage, type MCPToolContext } from '../contracts/index.js';
import { HttpError, integrationError, badRequest } from '../errors.js';

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
    const userId = params.userId;

    if (!params.threadId) {
      throw badRequest('threadId is required');
    }

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
    let readThread, extractMessageParts;
    try {
      const module = await import('../../../server/services/gmail.js');
      readThread = module.readThread;
      extractMessageParts = module.extractMessageParts;
    } catch (importError: any) {
      throw new HttpError(
        401,
        'GOOGLE_NOT_CONNECTED',
        'Gmail not connected',
        { hint: 'Connect in Settings → Integrations' }
      );
    }
    const thread = await readThread(tokens, params.threadId);
    const messages = (thread.messages || []).map((m: any) => {
      const parts = extractMessageParts(m);
      return {
        id: parts.id,
        date: parts.headers["date"],
        from: parts.headers["from"],
        to: parts.headers["to"],
        subject: parts.headers["subject"],
        snippet: parts.snippet,
        body: parts.body
      };
    });

    console.log(`[MCP-Tool:${name}] Read ${messages.length} messages from thread`);

    return { threadId: thread.id, messages };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
