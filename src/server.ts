import http from 'http';
import express, { Request, Response, NextFunction, Express } from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import crypto from 'crypto';
import { HttpError, configError, badRequest, internalError } from './errors.js';
import { registerTools, getToolContracts, getToolNames, getToolByName } from './tools/index.js';
import { bearerAuth, AuthenticatedRequest } from './auth.js';
import { CONFIG } from './config.js';
import { MCPToolContext } from './contracts/index.js';

const app: Express = express();

const allowedOrigins = [
  process.env.APP_ORIGIN,
  process.env.API_ORIGIN,
  'http://localhost:5000',
  'http://localhost:4000'
].filter((origin): origin is string => Boolean(origin));

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  credentials: false
}));
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = req.header('x-request-id') || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${requestId}] ${req.method} ${req.path}`);
  (req as any).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

app.get('/', (req: Request, res: Response) => {
  res.type('text/plain').send('Opus MCP OK');
});

app.get('/healthz', (req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/contracts', (req: Request, res: Response) => {
  const tools = getToolNames();
  res.json({ tools });
});

app.post('/mcp/:tool', bearerAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const rid = String(req.header('x-request-id') || crypto.randomUUID());
  const toolName = req.params.tool;
  const t0 = Date.now();
  
  res.setHeader('x-request-id', rid);
  
  const tool = getToolByName(toolName);
  
  if (!tool) {
    console.log('[MCP]', { rid, route: `/mcp/${toolName}`, status: 404, ms: Date.now() - t0 });
    return res.status(404).json({ 
      error: { 
        code: 'UNKNOWN_TOOL', 
        message: toolName 
      } 
    });
  }
  
  try {
    const validatedInput = tool.inputSchema.parse(req.body);
    
    const userId = validatedInput.userId || req.body.userId;
    if (!userId) {
      throw badRequest('userId is required in request body');
    }

    const { storage } = await import('../server/storage.js');
    
    const context: MCPToolContext = {
      userId,
      storage,
      user: { id: userId },
      requestId: rid
    };
    
    const result = await tool.handler(validatedInput, context);
    
    console.log('[MCP]', { rid, route: `/mcp/${toolName}`, status: 200, ms: Date.now() - t0 });
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      console.log('[MCP]', { rid, route: `/mcp/${toolName}`, status: error.statusCode, ms: Date.now() - t0 });
      return next(error);
    }

    if ((error as any).name === 'ZodError') {
      const zodError = error as any;
      console.log('[MCP]', { rid, route: `/mcp/${toolName}`, status: 400, ms: Date.now() - t0 });
      return next(badRequest('Invalid input', zodError.errors));
    }

    const errorMessage = error instanceof Error ? error.message : 'Internal Error';
    console.error('[MCP]', { rid, route: `/mcp/${toolName}`, err: errorMessage });
    console.log('[MCP]', { rid, route: `/mcp/${toolName}`, status: 500, ms: Date.now() - t0 });
    
    res.status(500).json({ 
      error: { 
        code: 'TOOL_ERROR', 
        message: errorMessage 
      } 
    });
  }
});

// Agent endpoint will be registered after tools are loaded

app.use((error: Error | HttpError, req: Request, res: Response, next: NextFunction) => {
  const requestId = (req as any).requestId || 'unknown';

  if (error instanceof HttpError) {
    console.error(`[${requestId}] HTTP Error ${error.statusCode}:`, error.message);
    return res.status(error.statusCode).json(error.toJSON());
  }

  console.error(`[${requestId}] Unexpected error:`, error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
});

async function startServer() {
  try {
    console.log('[MCP-Server] Registering tools...');
    await registerTools(app);

    const server = http.createServer(app);
    const wss = new WebSocketServer({ server, path: '/ws/voice' });

    wss.on('connection', (ws) => {
      console.log('[WebSocket] Client connected to /ws/voice');
      
      ws.on('message', (message) => {
        console.log('[WebSocket] Received:', message.toString());
      });

      ws.on('close', () => {
        console.log('[WebSocket] Client disconnected');
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
      });
    });

    server.listen(CONFIG.PORT, "0.0.0.0", () => {
      console.log(`[MCP-Server] Listening on http://0.0.0.0:${CONFIG.PORT} (source: PORT)`);
      console.log(`[MCP-Server] Health: GET /healthz   Contracts: GET /contracts`);
      console.log(`[MCP-Server] WebSocket: WS /ws/voice`);
    });

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[MCP-Server] ❌ Port ${CONFIG.PORT} is already in use. Set PORT to a free port (e.g., 4000) and try again.`);
        process.exit(1);
      }
      throw err;
    });
  } catch (error) {
    console.error('[MCP-Server] ❌ Failed to start:', error);
    process.exit(1);
  }
}

startServer();
