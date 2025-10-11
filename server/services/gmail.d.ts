export function listRecentThreads(...args: any[]): Promise<any[]>;
export function readThread(...args: any[]): Promise<any | null>;
export function extractMessageParts(...args: any[]): any;

export interface GmailService {
  listRecentThreads: typeof listRecentThreads;
  readThread: typeof readThread;
  extractMessageParts: typeof extractMessageParts;
}

export const gmailService: GmailService;
export default gmailService;
