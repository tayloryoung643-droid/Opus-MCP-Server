export async function listRecentThreads() {
  console.warn('[GmailService] listRecentThreads called but Gmail integration not yet implemented');
  return [];
}

export async function readThread() {
  console.warn('[GmailService] readThread called but Gmail integration not yet implemented');
  return null;
}

export function extractMessageParts() {
  console.warn('[GmailService] extractMessageParts called but Gmail integration not yet implemented');
  return { messages: [] };
}

export const gmailService = {
  listRecentThreads,
  readThread,
  extractMessageParts
};

export default gmailService;
