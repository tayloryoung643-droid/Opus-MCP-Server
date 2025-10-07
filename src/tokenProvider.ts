import { CONFIG } from './config.js';

interface CachedTokens {
  google?: {
    accessToken: string;
    refreshToken: string;
    tokenExpiry: Date;
    isActive: boolean;
  };
  salesforce?: {
    accessToken: string;
    refreshToken: string;
    instanceUrl: string;
    isActive: boolean;
  };
  fetchedAt: number;
}

interface TokenProviderResponse {
  google?: {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
  };
  salesforce?: {
    access_token: string;
    refresh_token: string;
    instance_url: string;
  };
}

// In-memory cache with 10-minute TTL
const tokenCache = new Map<string, CachedTokens>();
const CACHE_TTL_MS = 600_000; // 10 minutes

/**
 * Fetch tokens for a user from the App's token provider
 * @param userId - User ID to fetch tokens for
 * @param requestId - Optional request ID for tracing
 * @returns Tokens or null if not available
 */
export async function getTokensFor(
  userId: string,
  requestId?: string
): Promise<CachedTokens | null> {
  const rid = requestId ?? 'no-rid';
  const now = Date.now();

  // Check cache first
  const cached = tokenCache.get(userId);
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    console.log(`[TokenProvider:${rid}] Cache HIT for userId=${userId}, age=${Math.floor((now - cached.fetchedAt) / 1000)}s`);
    return cached;
  }

  // Cache miss or expired
  if (!CONFIG.TOKEN_PROVIDER_URL) {
    console.log(`[TokenProvider:${rid}] No TOKEN_PROVIDER_URL configured, returning null for userId=${userId}`);
    return null;
  }

  try {
    const url = `${CONFIG.TOKEN_PROVIDER_URL}?userId=${encodeURIComponent(userId)}`;
    console.log(`[TokenProvider:${rid}] Fetching tokens for userId=${userId} from provider`);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${CONFIG.MCP_TOKEN_PROVIDER_SECRET}`
    };
    
    if (requestId) {
      headers['x-request-id'] = requestId;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      console.warn(`[TokenProvider:${rid}] Provider returned ${response.status} for userId=${userId}`);
      return null;
    }

    const data = await response.json() as TokenProviderResponse;

    // Check if we got any tokens
    if (!data.google && !data.salesforce) {
      console.log(`[TokenProvider:${rid}] Provider returned empty tokens for userId=${userId}`);
      return null;
    }

    // Transform and cache the tokens
    const tokens: CachedTokens = {
      fetchedAt: now
    };

    if (data.google) {
      tokens.google = {
        accessToken: data.google.access_token,
        refreshToken: data.google.refresh_token,
        tokenExpiry: new Date(data.google.expiry_date),
        isActive: true
      };
      console.log(`[TokenProvider:${rid}] Cached Google tokens for userId=${userId}, expires=${tokens.google.tokenExpiry.toISOString()}`);
    }

    if (data.salesforce) {
      tokens.salesforce = {
        accessToken: data.salesforce.access_token,
        refreshToken: data.salesforce.refresh_token,
        instanceUrl: data.salesforce.instance_url,
        isActive: true
      };
      console.log(`[TokenProvider:${rid}] Cached Salesforce tokens for userId=${userId}`);
    }

    // Store in cache
    tokenCache.set(userId, tokens);

    return tokens;
  } catch (error) {
    console.error(`[TokenProvider:${rid}] Error fetching tokens for userId=${userId}:`, error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/**
 * Clear the token cache for a specific user or all users
 */
export function clearTokenCache(userId?: string): void {
  if (userId) {
    tokenCache.delete(userId);
    console.log(`[TokenProvider] Cleared cache for userId=${userId}`);
  } else {
    tokenCache.clear();
    console.log(`[TokenProvider] Cleared all cached tokens`);
  }
}
