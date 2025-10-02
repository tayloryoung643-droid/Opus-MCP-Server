import http from 'http';
import express, { Request, Response, NextFunction, Express } from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { HttpError, configError } from './errors.js';
import { registerTools, getToolContracts } from './tools/index.js';
import { CONFIG } from './config.js';

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
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${requestId}] ${req.method} ${req.path}`);
  (req as any).requestId = requestId;
  next();
});

app.get('/', (req: Request, res: Response) => {
  res.type('text/plain').send('Opus MCP OK');
});

app.get('/healthz', (req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/contracts', (req: Request, res: Response) => {
  const tools = getToolContracts();
  res.json({ tools });
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
