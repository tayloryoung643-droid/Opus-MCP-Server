type Tokens = { 
  accessToken: string; 
  refreshToken: string; 
  expiryDate?: number;
};

// In-memory store for dev; swap to DB later
const mem = new Map<string, Tokens>();

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
