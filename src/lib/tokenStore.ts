import crypto from 'crypto';

type Tokens = { 
  accessToken: string; 
  refreshToken: string; 
  expiryDate?: number;
};

// OAuth state for CSRF protection
interface OAuthState {
  userId: string;
  createdAt: number;
}

// In-memory store for dev; swap to DB later
const mem = new Map<string, Tokens>();
const stateStore = new Map<string, OAuthState>();

// State TTL: 10 minutes
const STATE_TTL_MS = 10 * 60 * 1000;

export function generateOAuthState(userId: string): string {
  const state = crypto.randomBytes(32).toString('hex');
  stateStore.set(state, {
    userId,
    createdAt: Date.now(),
  });
  console.log(`[TokenStore] Generated OAuth state for userId=${userId}`);
  return state;
}

export function validateOAuthState(state: string): { valid: true; userId: string } | { valid: false } {
  const stateData = stateStore.get(state);
  
  if (!stateData) {
    console.warn(`[TokenStore] Invalid state: not found`);
    return { valid: false };
  }

  // Check if state has expired
  if (Date.now() - stateData.createdAt > STATE_TTL_MS) {
    stateStore.delete(state);
    console.warn(`[TokenStore] Invalid state: expired`);
    return { valid: false };
  }

  // Clean up used state (one-time use)
  stateStore.delete(state);
  
  console.log(`[TokenStore] Valid state for userId=${stateData.userId}`);
  return { valid: true, userId: stateData.userId };
}

export async function saveGoogleTokens(userId: string, t: Tokens) {
  mem.set(userId, t);
}

export async function getGoogleTokens(userId: string) {
  return mem.get(userId) || null;
}

export async function clearGoogleTokens(userId: string) {
  mem.delete(userId);
}

export async function listConnectedUsers(): Promise<string[]> {
  return Array.from(mem.keys());
}
