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
import { saveGoogleTokens, getGoogleTokens, clearGoogleTokens, listConnectedUsers, generateOAuthState, validateOAuthState } from './lib/tokenStore.js';
import { fetchGoogleTokens, getTokenProviderStatus } from './lib/tokenProvider.js';
import { savePrep, getPrep, listPreps, saveMinimalPrep } from './lib/prepStore.js';
import { buildMinimalPrep, buildGmailQuery } from './lib/minimalPrepBuilder.js';
import { devToolAuth } from './middleware/devToolAuth.js';

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
  
  // Add direct route tool (prep.save.v1)
  // Note: prep.generate.v1 is already in the tool registry
  toolsWithPaths.push(
    { name: 'prep.save.v1', path: '/mcp/prep.save.v1' }
  );
  
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
  const oldLastFetch = getLastFetch();
  const newProviderStatus = getTokenProviderStatus();
  
  let urlHost: string | null = null;
  if (CONFIG.TOKEN_PROVIDER_URL) {
    try {
      urlHost = new URL(CONFIG.TOKEN_PROVIDER_URL).host;
    } catch {
      urlHost = 'invalid-url';
    }
  }
  
  res.json({
    tokenProviderUrlSet: newProviderStatus.tokenProviderUrlSet,
    secretSet: newProviderStatus.secretSet,
    urlHost,
    // Include both old and new last fetch data for debugging
    lastFetch: newProviderStatus.lastFetch || (oldLastFetch.rid ? {
      rid: oldLastFetch.rid,
      userId: oldLastFetch.userId,
      status: oldLastFetch.status,
      receivedKeys: oldLastFetch.receivedKeys,
      timestamp: oldLastFetch.timestamp
    } : null)
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
    const state = generateOAuthState(userId);
    const oauth2 = getOAuthClient();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
      state,
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
    
    if (!state) {
      return res.status(400).send('Missing state parameter');
    }
    
    // Validate state to prevent CSRF attacks
    const validation = validateOAuthState(state);
    if (!validation.valid) {
      return res.status(403).send('Invalid or expired OAuth state. Please try connecting again.');
    }
    
    const userId = validation.userId;
    
    const oauth2 = getOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    
    await saveGoogleTokens(userId, {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiryDate: tokens.expiry_date ?? undefined,
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
    const userId = (req as any).userId;
    let tokens = await getGoogleTokens(userId);
    
    // Try token provider if no local tokens
    if (!tokens) {
      console.log(`[/me/google] No local tokens for userId=${userId}, trying token provider...`);
      tokens = await fetchGoogleTokens(userId);
      
      if (tokens) {
        console.log(`[/me/google] Token provider returned tokens, saving locally`);
        await saveGoogleTokens(userId, tokens);
      }
    }
    
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

// Prep endpoints
app.get('/prep/:id', (req: Request, res: Response) => {
  const p = getPrep(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

app.get('/prep', (req: Request, res: Response) => {
  const userId = String(req.query.userId || '');
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  res.json({ preps: listPreps(userId) });
});

// MCP tool: prep.save.v1
app.post('/mcp/prep.save.v1', devToolAuth, async (req: Request, res: Response) => {
  const { userId, eventId, sections } = req.body || {};
  if (!userId || !eventId || !sections) {
    return res.status(400).json({ error: 'Missing input' });
  }
  const saved = savePrep({ userId, eventId, sections });
  res.json({ prepId: saved.id, url: `/prep/${saved.id}` });
});

// MCP tool: prep.generate.v1 (orchestration)
app.post('/mcp/prep.generate.v1', devToolAuth, async (req: Request, res: Response) => {
  const requestId = req.header('x-request-id') || crypto.randomUUID();
  const startTime = Date.now();
  
  try {
    const { userId, eventId } = req.body || {};
    if (!userId || !eventId) {
      return res.status(400).json({ 
        error: { 
          code: 'MISSING_PARAMETERS', 
          message: 'Missing userId/eventId',
          requestId 
        } 
      });
    }
    
    console.log(`[${requestId}] prep.generate.v1 started for user=${userId}, event=${eventId}`);

    const tokens = await getGoogleTokens(userId);
    if (!tokens) {
      console.log(`[${requestId}] Google not connected for user=${userId}`);
      return res.status(401).json({ 
        error: { 
          code: 'GOOGLE_NOT_CONNECTED',
          message: 'Google account not connected. Please connect your Google account.',
          requestId 
        }
      });
    }

    console.log(`[${requestId}] Step 1: Creating Google clients...`);
    const { calendar, gmail } = await makeClientsFor(userId, {
      access_token: tokens.accessToken, 
      refresh_token: tokens.refreshToken, 
      expiry_date: tokens.expiryDate,
    });

    // 1) Pull the event
    console.log(`[${requestId}] Step 2: Fetching calendar event...`);
    const ev = await calendar.events.get({ calendarId: 'primary', eventId });
  
    if (CONFIG.PREP_MODE === 'minimal') {
      // Minimal mode: facts-only prep
      const attendees = (ev.data.attendees || []).map(a => a.email!).filter(Boolean);
      const eventTitle = ev.data.summary || '';
      console.log(`[${requestId}] Step 3: Searching Gmail (${attendees.length} attendees)...`);
      
      // 2) Build tightened Gmail query
      const q = buildGmailQuery({ attendees, eventTitle, recencyDays: 180 });
      
      // 3) Fetch Gmail threads with full message details
      const gmailStart = Date.now();
      const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 10 });
      console.log(`[${requestId}] Step 3a: Found ${list.data.threads?.length || 0} threads in ${Date.now() - gmailStart}ms`);
      
      const threadStart = Date.now();
      const threads = await Promise.all((list.data.threads || []).map(async t => {
        const full = await gmail.users.threads.get({ userId: 'me', id: t.id!, format: 'full' });
        return full.data;
      }));
      console.log(`[${requestId}] Step 3b: Fetched thread details in ${Date.now() - threadStart}ms`);

    // 3.5) Enrich threads with Claude AI analysis
    let enrichments: Map<string, any> | undefined;
    try {
      const { claudeEnricher } = await import('./lib/claudeEnricher.js');

      if (claudeEnricher.isEnabled()) {
        console.log('[prep.generate.v1] Enriching Gmail threads with Claude AI...');

        // Transform threads to format expected by enricher
        const enricherThreads = threads.map(t => ({
          threadId: t.id!,
          subject: t.messages?.[0]?.payload?.headers?.find(h => h.name === 'Subject')?.value || '',
          messages: (t.messages || []).map(m => ({
            from: m.payload?.headers?.find(h => h.name === 'From')?.value || undefined,
            to: m.payload?.headers?.find(h => h.name === 'To')?.value || undefined,
            date: m.payload?.headers?.find(h => h.name === 'Date')?.value || undefined,
            snippet: m.snippet || undefined
          }))
        }));

        enrichments = await claudeEnricher.enrichThreads(
          enricherThreads,
          ev.data.summary || 'Untitled Meeting',
          ev.data.start?.dateTime || ev.data.start?.date || undefined
        );

        console.log(`[prep.generate.v1] Enriched ${enrichments.size} threads`);
      }
    } catch (enrichError) {
      console.error('[prep.generate.v1] Enrichment failed, continuing without:', enrichError);
      // Continue without enrichment - don't break the workflow
    }

    // 4) Fetch Salesforce data (if available)
    console.log(`[${requestId}] Step 4: Checking Salesforce...`);
    let salesforceData;
    try {
      const { storage } = await import('../server/storage.js');
      const salesforceIntegration = await storage.getSalesforceIntegration(userId, req.header('x-request-id') || 'prep-gen');
      
      if (salesforceIntegration?.isActive) {
        const { salesforceCrmService } = await import('../server/services/salesforceCrm.js');
        
        // Try to find account by domain from attendee emails
        const attendeeDomains = attendees
          .map(email => email.split('@')[1])
          .filter(d => d && !d.includes('gmail.com') && !d.includes('outlook.com'));
        
        let account: any = undefined;
        let opportunity: any = undefined;
        let contacts: any = undefined;
        
        if (attendeeDomains.length > 0) {
          const accountSearch = await salesforceCrmService.searchRecords(userId, attendeeDomains[0], ['Account']);
          account = accountSearch.find((r: any) => r.attributes.type === 'Account');
          
          if (account) {
            const oppSearch = await salesforceCrmService.getOpportunities(userId);
            opportunity = oppSearch.find((opp: any) => opp.AccountId === account.Id);
          }
        }
        
        // Search for contacts by email
        if (attendees.length > 0) {
          const contactSearches = await Promise.all(
            attendees.slice(0, 3).map(email => 
              salesforceCrmService.searchRecords(userId, email, ['Contact'])
            )
          );
          contacts = contactSearches.flat().filter((r: any) => r.attributes.type === 'Contact');
        }
        
        salesforceData = { account, opportunity, contacts };
      }
    } catch (sfError) {
      console.warn('[prep.generate.v1] Salesforce lookup failed:', sfError);
    }
    
    // 5) Build minimal prep
    const minimalPrep = buildMinimalPrep({
      userId,
      event: {
        id: ev.data.id ?? eventId,
        summary: ev.data.summary ?? undefined,
        start: ev.data.start ? {
          dateTime: ev.data.start.dateTime ?? undefined,
          date: ev.data.start.date ?? undefined
        } : undefined,
        end: ev.data.end ? {
          dateTime: ev.data.end.dateTime ?? undefined,
          date: ev.data.end.date ?? undefined
        } : undefined,
        attendees: ev.data.attendees?.map(a => ({
          email: a.email ?? undefined,
          displayName: a.displayName ?? undefined,
          responseStatus: a.responseStatus ?? undefined
        }))
      },
      gmailThreads: threads as any,
      salesforce: salesforceData,
      enrichments
    });
    
    // 6) Save
    const saved = saveMinimalPrep(minimalPrep);
    const totalTime = Date.now() - startTime;
    console.log(`[${requestId}] prep.generate.v1 completed in ${totalTime}ms`);
    return res.json(saved);
  } else {
    // Full mode: template-based prep (legacy)
    const attendees = (ev.data.attendees || []).map(a => a.email!).filter(Boolean);
    const subject = (ev.data.summary || '').slice(0, 80);

    // 2) Find 3 recent threads by attendee email + subject keywords
    const q = `${attendees.map(a => `from:${a}`).join(' OR ')} ${subject ? `subject:("${subject}")` : ''}`;
    const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 3 });
    const threads = await Promise.all((list.data.threads || []).map(async t => {
      const full = await gmail.users.threads.get({ userId: 'me', id: t.id! });
      const last = full.data.messages?.at(-1);
      return { id: t.id, snippet: last?.snippet || '' };
    }));

    // 3) Compose naive sections (placeholder—Agent will do the smart version)
    const sections = {
      snapshot: `Meeting: ${ev.data.summary || 'Untitled'}\nParticipants: ${attendees.join(', ')}`,
      lastContact: threads.map(t => `• ${t.snippet}`),
      priorities: ['Improve efficiency', 'De-risk project', 'Hit KPIs'],
      risks: [
        { risk: 'No budget', counter: 'Prove ROI with pilot' }, 
        { risk: 'Competing vendor', counter: 'Differentiate on speed' }, 
        { risk: 'Timing', counter: 'Offer fast start' }
      ],
      questions: [
        'What triggered this meeting?', 
        'Who is the economic buyer?', 
        'What does success look like?', 
        'Timeline?', 
        'Risks?'
      ],
      agenda: [
        'Context (5m)', 
        'Discovery (15m)', 
        'Solution preview (10m)', 
        'Next steps (5m)'
      ],
      notes: '',
    };

    // 4) Save
    const saved = savePrep({ userId, eventId, sections });
    res.json({ prepId: saved.id, url: `/prep/${saved.id}` });
  }
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error(`[${requestId}] prep.generate.v1 FAILED after ${elapsed}ms:`, errorMessage);
    if (errorStack) {
      console.error(`[${requestId}] Stack trace:`, errorStack);
    }
    
    // Check for specific error types using status codes and structured fields
    const statusCode = error?.response?.status || error?.code || error?.status;
    const errorReason = error?.errors?.[0]?.reason;
    
    // Token expiry detection - check status code, error reason, or message patterns
    const isTokenExpired = statusCode === 401 || 
      errorReason === 'authError' ||
      errorMessage.includes('invalid_grant') || 
      errorMessage.includes('Token has been expired') ||
      errorMessage.includes('Invalid Credentials');
    
    if (isTokenExpired) {
      return res.status(401).json({
        error: {
          code: 'GOOGLE_TOKEN_EXPIRED',
          message: 'Google authentication has expired. Please reconnect your Google account.',
          requestId
        }
      });
    }
    
    // Event not found detection
    const isNotFound = statusCode === 404 || 
      errorMessage.includes('Not Found') || 
      errorMessage.includes('notFound');
    
    if (isNotFound) {
      return res.status(404).json({
        error: {
          code: 'EVENT_NOT_FOUND',
          message: 'Calendar event not found',
          requestId
        }
      });
    }
    
    return res.status(500).json({
      error: {
        code: 'PREP_GENERATION_FAILED',
        message: errorMessage,
        requestId
      }
    });
  }
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
