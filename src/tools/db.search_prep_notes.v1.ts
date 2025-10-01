import {
  prepNotesSearchSchemaV1,
  type PrepNote,
  type MCPToolContext
} from '../contracts/index.js';

export const name = 'db.search_prep_notes.v1';
export const version = 'v1';
export const inputSchema = prepNotesSearchSchemaV1;
export const description = 'Search previous call preparation notes from the database';

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<{ notes: PrepNote[]; query: string; total: number }> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);
    let allNotes: any[] = [];

    try {
      const { sql } = await import('drizzle-orm');
      const { db } = await import('../../../server/db.js');

      const query = `
        SELECT id, user_id, event_id, text, updated_at 
        FROM prep_notes 
        WHERE text ILIKE '%${params.query}%' 
        ${params.userId ? `AND user_id = '${params.userId}'` : ''}
        ORDER BY updated_at DESC 
        LIMIT ${params.limit}
      `;

      const results = await db.execute(sql.raw(query));
      allNotes = results.rows || [];
    } catch (error) {
      console.warn(`[MCP-Tool:${name}] Query failed:`, error);
      allNotes = [];
    }

    const transformedNotes: PrepNote[] = allNotes.map((note: any) => ({
      id: note.id,
      userId: note.user_id,
      eventId: note.event_id,
      text: note.text,
      updatedAt: new Date(note.updated_at)
    }));

    console.log(`[MCP-Tool:${name}] Found ${transformedNotes.length} prep notes`);

    return {
      notes: transformedNotes,
      query: params.query,
      total: transformedNotes.length
    };
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
