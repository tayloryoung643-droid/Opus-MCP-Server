interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate?: number;
}

let lastFetchStatus: {
  userId: string;
  status: 'ok' | 'miss' | 'error';
  ts: number;
} | null = null;

export async function fetchGoogleTokens(userId: string): Promise<GoogleTokens | null> {
  const url = process.env.MCP_TOKEN_PROVIDER_URL;
  const secret = process.env.MCP_TOKEN_PROVIDER_SECRET;
  
  if (!url || !secret) {
    console.log(`[TokenProvider] Not configured - skipping fetch for userId=${userId}`);
    return null;
  }

  try {
    console.log(`[TokenProvider] Fetching tokens for userId=${userId} from ${url}`);
    
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`
      },
      body: JSON.stringify({ userId })
    });

    if (!r.ok) {
      console.log(`[TokenProvider] Fetch failed: ${r.status} ${r.statusText}`);
      lastFetchStatus = { userId, status: 'error', ts: Date.now() };
      return null;
    }

    const json = await r.json();
    const g = json?.google;

    if (!g?.access_token || !g?.refresh_token) {
      console.log(`[TokenProvider] No valid Google tokens in response for userId=${userId}`);
      lastFetchStatus = { userId, status: 'miss', ts: Date.now() };
      return null;
    }

    console.log(`[TokenProvider] Successfully fetched Google tokens for userId=${userId}`);
    lastFetchStatus = { userId, status: 'ok', ts: Date.now() };

    return {
      accessToken: g.access_token as string,
      refreshToken: g.refresh_token as string,
      expiryDate: g.expiry_date as number | undefined,
    };
  } catch (error) {
    console.error(`[TokenProvider] Error fetching tokens:`, error);
    lastFetchStatus = { userId, status: 'error', ts: Date.now() };
    return null;
  }
}

export function getTokenProviderStatus() {
  return {
    tokenProviderUrlSet: !!process.env.MCP_TOKEN_PROVIDER_URL,
    secretSet: !!process.env.MCP_TOKEN_PROVIDER_SECRET,
    lastFetch: lastFetchStatus
  };
}
