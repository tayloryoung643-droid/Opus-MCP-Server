import { MinimalPrepV1 } from '../contracts/index.js';

interface BuildMinimalPrepParams {
  userId: string;
  event: {
    id: string;
    summary?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{
      email?: string;
      displayName?: string;
      responseStatus?: string;
    }>;
  };
  gmailThreads: Array<{
    id: string;
    messages?: Array<{
      payload?: {
        headers?: Array<{ name?: string; value?: string }>;
      };
      snippet?: string;
      internalDate?: string;
    }>;
  }>;
  salesforce?: {
    account?: any;
    opportunity?: any;
    contacts?: any[];
  };
  enrichments?: Map<string, {
    keyTopics: string[];
    actionItems: string[];
    sentiment: "positive" | "neutral" | "negative" | "mixed";
    context: string;
    relevanceScore: number;
  }>;
  companyResearch?: Array<any>;
}

function normalizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(re|fw|fwd):\s*/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSentences(text: string, maxSentences: number = 2): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const unique = [...new Set(sentences.map(s => s.trim()))];
  return unique.slice(0, maxSentences);
}

function trimSnippet(snippet: string, maxLength: number = 280): string {
  const sentences = extractSentences(snippet);
  let result = sentences.join(' ').trim();
  
  if (result.length > maxLength) {
    result = result.slice(0, maxLength - 1) + '…';
  }
  
  return result;
}

function extractEmailsFromHeader(header: string): string[] {
  const emailRegex = /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
  return (header.match(emailRegex) || []).map(e => e.toLowerCase());
}

function deduplicateAttendees(attendees: Array<{ email?: string; displayName?: string; responseStatus?: string }>) {
  const seen = new Set<string>();
  const deduplicated: Array<{
    name?: string;
    email: string;
    response?: "accepted" | "declined" | "tentative" | "needsAction";
  }> = [];

  for (const attendee of attendees) {
    if (!attendee.email) continue;
    
    const email = attendee.email.toLowerCase();
    if (seen.has(email)) continue;
    
    seen.add(email);
    deduplicated.push({
      name: attendee.displayName,
      email,
      response: attendee.responseStatus as any
    });
  }

  return deduplicated;
}

function deduplicateGmailThreads(threads: Array<{
  id: string;
  messages?: Array<{
    payload?: { headers?: Array<{ name?: string; value?: string }> };
    snippet?: string;
    internalDate?: string;
  }>;
}>) {
  const threadsBySubject = new Map<string, typeof threads[0]>();
  
  for (const thread of threads) {
    if (!thread.messages || thread.messages.length === 0) continue;
    
    const lastMessage = thread.messages[thread.messages.length - 1];
    const headers = lastMessage?.payload?.headers || [];
    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
    const normalizedSubject = normalizeSubject(subject);
    
    const existingThread = threadsBySubject.get(normalizedSubject);
    const currentDate = parseInt(lastMessage?.internalDate || '0');
    const existingDate = existingThread?.messages?.[existingThread.messages.length - 1]?.internalDate
      ? parseInt(existingThread.messages[existingThread.messages.length - 1].internalDate!)
      : 0;
    
    if (!existingThread || currentDate > existingDate) {
      threadsBySubject.set(normalizedSubject, thread);
    }
  }
  
  return Array.from(threadsBySubject.values())
    .sort((a, b) => {
      const dateA = parseInt(a.messages?.[a.messages.length - 1]?.internalDate || '0');
      const dateB = parseInt(b.messages?.[b.messages.length - 1]?.internalDate || '0');
      return dateB - dateA;
    })
    .slice(0, 3);
}

export function buildMinimalPrep(params: BuildMinimalPrepParams): Omit<MinimalPrepV1, 'id' | 'createdAt'> {
  const attendees = deduplicateAttendees(params.event.attendees || []);
  
  const deduplicatedThreads = deduplicateGmailThreads(params.gmailThreads);
  
  const gmail = deduplicatedThreads.map(thread => {
    const lastMessage = thread.messages?.[thread.messages.length - 1];
    const headers = lastMessage?.payload?.headers || [];
    
    const getHeader = (name: string) => 
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
    
    const subject = getHeader('subject');
    const from = getHeader('from');
    const to = getHeader('to');
    const cc = getHeader('cc');
    
    const participants = [
      ...extractEmailsFromHeader(from),
      ...extractEmailsFromHeader(to),
      ...extractEmailsFromHeader(cc)
    ];
    const uniqueParticipants = [...new Set(participants)];
    
    const snippet = trimSnippet(lastMessage?.snippet || '');
    const dateMs = parseInt(lastMessage?.internalDate || '0');
    const lastMessageDate = dateMs ? new Date(dateMs).toISOString() : '';

    const baseThread = {
      threadId: thread.id,
      subject,
      participants: uniqueParticipants,
      lastMessageSnippet: snippet,
      lastMessageDate
    };

    // Add enrichment if available
    const enrichment = params.enrichments?.get(thread.id);
    if (enrichment) {
      return {
        ...baseThread,
        enrichment
      };
    }

    return baseThread;
  });
  
  const salesforce = params.salesforce && (params.salesforce.account || params.salesforce.opportunity || params.salesforce.contacts?.length)
    ? {
        ...(params.salesforce.account ? {
          account: {
            id: params.salesforce.account.Id,
            name: params.salesforce.account.Name,
            ...(params.salesforce.account.Industry && { industry: params.salesforce.account.Industry }),
            ...(params.salesforce.account.NumberOfEmployees && { employees: params.salesforce.account.NumberOfEmployees }),
            ...(params.salesforce.account.Website && { website: params.salesforce.account.Website })
          }
        } : {}),
        ...(params.salesforce.opportunity ? {
          opportunity: {
            id: params.salesforce.opportunity.Id,
            name: params.salesforce.opportunity.Name,
            ...(params.salesforce.opportunity.StageName && { stageName: params.salesforce.opportunity.StageName }),
            ...(params.salesforce.opportunity.Amount && { amount: params.salesforce.opportunity.Amount }),
            ...(params.salesforce.opportunity.CloseDate && { closeDate: params.salesforce.opportunity.CloseDate }),
            ...(params.salesforce.opportunity.Owner?.Name && { owner: params.salesforce.opportunity.Owner.Name })
          }
        } : {}),
        ...(params.salesforce.contacts?.length ? {
          contacts: params.salesforce.contacts.map(c => ({
            id: c.Id,
            ...(c.Name && { name: c.Name }),
            ...(c.Email && { email: c.Email }),
            ...(c.Title && { title: c.Title })
          }))
        } : {})
      }
    : undefined;
  
  return {
    userId: params.userId,
    eventId: params.event.id,
    meeting: {
      title: params.event.summary || 'Untitled Meeting',
      start: params.event.start?.dateTime || params.event.start?.date,
      end: params.event.end?.dateTime || params.event.end?.date
    },
    attendees,
    gmail,
    ...(salesforce && { salesforce }),
    ...(params.companyResearch && { companyResearch: params.companyResearch })
  };
}

export function buildGmailQuery(params: {
  attendees: string[];
  eventTitle: string;
  recencyDays?: number;
}): string {
  const { attendees, eventTitle, recencyDays = 180 } = params;
  
  const normalizedTitle = normalizeSubject(eventTitle);
  const titleWords = normalizedTitle.split(' ').filter(w => w.length > 3);
  
  const peopleQueries = attendees.map(email => 
    `(from:${email} OR to:${email})`
  );
  
  const parts: string[] = [];
  
  if (peopleQueries.length > 0) {
    parts.push(`(${peopleQueries.join(' OR ')})`);
  }
  
  if (titleWords.length > 0) {
    const titleQuery = titleWords.map(word => `"${word}"`).join(' ');
    parts.push(`subject:(${titleQuery})`);
  }
  
  parts.push(`newer_than:${recencyDays}d`);
  
  return parts.join(' ');
}
