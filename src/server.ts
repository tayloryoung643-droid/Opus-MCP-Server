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
import { getOAuthClient, makeClientsFor } from './lib/google.js';
import { saveGoogleTokens, getGoogleTokens, clearGoogleTokens, listConnectedUsers } from './lib/tokenStore.js';

const app: Express = express();

// Trust proxy for Replit deployment
app.set("trust proxy", true);

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
  res.status(200).send('Opus MCP OK');
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

// Helper to resolve userId from query or header (dev auth)
function requireUserId(req: Request, res: Response, next: NextFunction) {
  const userId = req.query.userId || req.header('x-user-id');
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId (provide ?userId=... or x-user-id header)' });
  }
  (req as any).userId = String(userId);
  next();
}

// Google OAuth routes
app.get('/auth/google', requireUserId, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const oauth2 = getOAuthClient();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
      state: encodeURIComponent(JSON.stringify({ userId })),
    });
    res.redirect(url);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'OAuth init failed' });
  }
});

app.get('/auth/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code) {
      return res.status(400).send('Missing authorization code');
    }
    const { userId } = JSON.parse(decodeURIComponent(state || '{}'));
    if (!userId) {
      return res.status(400).send('Missing userId in state');
    }
    
    const oauth2 = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    
    await saveGoogleTokens(userId, {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiryDate: tokens.expiry_date,
    });
    
    res.status(200).send('✅ Google connected successfully! You can close this tab and return to your app.');
  } catch (error) {
    console.error('[OAuth] Callback error:', error);
    res.status(500).send(`OAuth callback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

app.post('/auth/google/disconnect', requireUserId, async (req: Request, res: Response) => {
  try {
    await clearGoogleTokens((req as any).userId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Disconnect failed' });
  }
});

app.get('/me/google', requireUserId, async (req: Request, res: Response) => {
  try {
    const tokens = await getGoogleTokens((req as any).userId);
    res.json({ connected: !!tokens });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Status check failed' });
  }
});

app.get('/admin/connections', async (req: Request, res: Response) => {
  try {
    const users = await listConnectedUsers();
    res.json({ connectedUsers: users });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list connections' });
  }
});

// Connect page for easy OAuth flow
app.get('/connect', (req: Request, res: Response) => {
  const userId = req.query.userId || 'test-user';
  const replitDomain = process.env.REPLIT_DOMAINS;
  const host = replitDomain ? `https://${replitDomain}` : (process.env.REPLIT_URL || `https://${req.headers['x-forwarded-host']}`);
  
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Connect Google - Opus MCP</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        h3 { color: #333; }
        code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
        a { color: #0066cc; text-decoration: none; padding: 10px 20px; background: #0066cc; color: white; border-radius: 5px; display: inline-block; }
        a:hover { background: #0052a3; }
        .status { margin-top: 30px; padding: 15px; background: #f9f9f9; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h3>🔗 Connect Google Services</h3>
      <p>User: <code>${userId}</code></p>
      <p>
        <a href="${host}/auth/google?userId=${userId}">Authorize Google Calendar & Gmail</a>
      </p>
      <div class="status">
        <h4>Connection Status</h4>
        <p>Check status: <a href="${host}/me/google?userId=${userId}" target="_blank" style="background: #666; padding: 5px 10px; font-size: 14px;">/me/google</a></p>
        <p>Disconnect: <code>POST ${host}/auth/google/disconnect?userId=${userId}</code></p>
      </div>
    </body>
    </html>
  `);
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
        const replitDomain = process.env.REPLIT_DOMAINS;
        const host = replitDomain ? `https://${replitDomain}` : (process.env.REPLIT_URL || process.env.RAILWAY_PUBLIC_DOMAIN || `http://0.0.0.0:${CONFIG.PORT}`);
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
