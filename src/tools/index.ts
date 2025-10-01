import { Request, Response, NextFunction, Express } from 'express';
import { ZodSchema } from 'zod';
import { bearerAuth, AuthenticatedRequest } from '../auth.js';
import { badRequest, internalError, HttpError } from '../errors.js';
import { MCPToolContext } from '../contracts/index.js';

interface Tool {
  name: string;
  version: string;
  inputSchema: ZodSchema;
  description: string;
  handler: (args: unknown, context: MCPToolContext) => Promise<any>;
}

const tools: Tool[] = [];

async function loadTools() {
  const toolModules = [
    await import('./calendar.next_events.v1.js'),
    await import('./gmail.search_threads.v1.js'),
    await import('./gmail.read_thread.v1.js'),
    await import('./salesforce.lookup_account.v1.js'),
    await import('./salesforce.lookup_opportunity.v1.js'),
    await import('./db.search_prep_notes.v1.js'),
    await import('./db.call_history.v1.js'),
    await import('./prep.generate.v1.js')
  ];

  for (const module of toolModules) {
    tools.push({
      name: module.name,
      version: module.version,
      inputSchema: module.inputSchema,
      description: module.description,
      handler: module.handler
    });
  }

  console.log(`[MCP-Tools] Loaded ${tools.length} tools:`, tools.map(t => t.name));
}

export function getToolContracts() {
  return tools.map(tool => ({
    name: tool.name,
    version: tool.version,
    description: tool.description,
    inputSchemaSummary: summarizeSchema(tool.inputSchema),
    outputSchemaSummary: 'Tool-specific response object'
  }));
}

function summarizeSchema(schema: ZodSchema): any {
  try {
    const shape = (schema as any)._def?.shape?.();
    if (!shape) return { type: 'object' };

    const fields: Record<string, { type: string; required: boolean }> = {};
    for (const [key, value] of Object.entries(shape)) {
      const fieldDef = (value as any)._def;
      fields[key] = {
        type: fieldDef?.typeName || 'unknown',
        required: !fieldDef?.checks?.some((c: any) => c.kind === 'optional')
      };
    }
    return { type: 'object', fields };
  } catch {
    return { type: 'object' };
  }
}

export async function registerTools(app: Express) {
  await loadTools();

  const { storage } = await import('../../../server/storage.js');

  for (const tool of tools) {
    app.post(`/tools/${tool.name}`, bearerAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[MCP-Request:${requestId}] POST /tools/${tool.name}`);

      try {
        const validatedInput = tool.inputSchema.parse(req.body);

        const userId = validatedInput.userId || req.body.userId;
        if (!userId) {
          throw badRequest('userId is required in request body');
        }

        const context: MCPToolContext = {
          userId,
          storage,
          user: { id: userId }
        };

        const result = await tool.handler(validatedInput, context);

        console.log(`[MCP-Request:${requestId}] SUCCESS`);
        res.json(result);
      } catch (error) {
        console.error(`[MCP-Request:${requestId}] ERROR:`, error);

        if (error instanceof HttpError) {
          return next(error);
        }

        if ((error as any).name === 'ZodError') {
          const zodError = error as any;
          return next(badRequest('Invalid input', zodError.errors));
        }

        next(internalError(error instanceof Error ? error.message : 'Unexpected error'));
      }
    });
  }

  // Register the agent endpoint
  app.post('/agent/act', bearerAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[MCP-Agent:${requestId}] POST /agent/act`);

    try {
      const { handleAgentAction } = await import('../agent/prepAgent.js');

      const userId = req.body.userId;
      if (!userId) {
        throw badRequest('userId is required in request body');
      }

      const context: MCPToolContext = {
        userId,
        storage,
        user: { id: userId }
      };

      const result = await handleAgentAction(req.body, context);

      console.log(`[MCP-Agent:${requestId}] SUCCESS`);
      res.json(result);
    } catch (error) {
      console.error(`[MCP-Agent:${requestId}] ERROR:`, error);

      if (error instanceof HttpError) {
        return next(error);
      }

      if ((error as any).name === 'ZodError') {
        const zodError = error as any;
        return next(badRequest('Invalid input', zodError.errors));
      }

      next(internalError(error instanceof Error ? error.message : 'Unexpected error'));
    }
  });

  console.log(`[MCP-Tools] Registered ${tools.length} tool endpoints + agent endpoint`);
}
