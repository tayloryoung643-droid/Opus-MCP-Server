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
import { getLastFetch } from './tokenProvider.js';
import { execSync } from 'child_process';

const app: Express = express();

// Capture build time at server start
const BUILD_TIME = new Date().toISOString();

// Get git SHA dynamically
function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return process.env.REPL_SLUG ? 'replit-deployment' : 'unknown';
  }
}

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
  const toolsWithPaths = tools.map(name => ({
    name,
    path: `/mcp/${name}`
  }));
  res.json({ tools: toolsWithPaths });
});

app.get('/debug/version', (req: Request, res: Response) => {
  res.json({
    gitSha: getGitSha(),
    buildTime: BUILD_TIME,
    env: {
      TOKEN_PROVIDER_URL: Boolean(CONFIG.TOKEN_PROVIDER_URL),
      MCP_TOKEN_PROVIDER_SECRET: Boolean(CONFIG.MCP_TOKEN_PROVIDER_SECRET)
    }
  });
});

app.get('/debug/token-provider', (req: Request, res: Response) => {
  const lastFetch = getLastFetch();
  
  let urlHost: string | null = null;
  if (CONFIG.TOKEN_PROVIDER_URL) {
    try {
      urlHost = new URL(CONFIG.TOKEN_PROVIDER_URL).host;
    } catch {
      urlHost = 'invalid-url';
    }
  }
  
  res.json({
    tokenProviderUrlSet: Boolean(CONFIG.TOKEN_PROVIDER_URL),
    secretSet: Boolean(CONFIG.MCP_TOKEN_PROVIDER_SECRET),
    urlHost,
    lastFetch: lastFetch.rid ? {
      rid: lastFetch.rid,
      userId: lastFetch.userId,
      status: lastFetch.status,
      receivedKeys: lastFetch.receivedKeys,
      timestamp: lastFetch.timestamp
    } : null
  });
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
    // Extract userId from x-effective-user header or body
    const effectiveUser = req.header('x-effective-user');
    const bodyWithUser = effectiveUser 
      ? { ...req.body, userId: effectiveUser }
      : req.body;
    
    const validatedInput = tool.inputSchema.parse(bodyWithUser);
    
    const userId = validatedInput.userId || req.body.userId;
    if (!userId) {
      throw badRequest('userId is required in request body or x-effective-user header');
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

    const httpServer = http.createServer(app);
    
    // IMPORTANT: Attach WS to existing HTTP server (NO second listen)
    const wss = new WebSocketServer({ server: httpServer, path: '/ws/voice' });

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

    // Guard against duplicate listen on dev reload
    if (!(globalThis as any).__MCP_SERVER_STARTED__) {
      (globalThis as any).__MCP_SERVER_STARTED__ = true;
      
      httpServer.listen(CONFIG.PORT, "0.0.0.0", () => {
        const host = process.env.REPLIT_URL || process.env.RAILWAY_PUBLIC_DOMAIN || `http://0.0.0.0:${CONFIG.PORT}`;
        console.log(`[MCP-Server] Listening on ${host} (source: PORT)`);
        console.log(`[MCP-Server] Public URL: ${host}`);
        console.log(`[MCP-Server] Health: GET /healthz   Contracts: GET /contracts`);
        console.log(`[MCP-Server] WebSocket: WS /ws/voice`);
      });

      httpServer.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.error(`[MCP-Server] ❌ Port ${CONFIG.PORT} is already in use. Set PORT to a free port (e.g., 4000) and try again.`);
          process.exit(1);
        }
        throw err;
      });
    } else {
      console.log("[MCP-Server] Already started; skipping listen()");
    }
  } catch (error) {
    console.error('[MCP-Server] ❌ Failed to start:', error);
    process.exit(1);
  }
}

startServer();
