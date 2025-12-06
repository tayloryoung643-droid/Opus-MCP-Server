import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from '../config.js';

interface EmailThread {
  threadId: string;
  subject: string;
  messages: Array<{
    from?: string;
    to?: string;
    date?: string;
    snippet?: string;
  }>;
}

interface ThreadEnrichment {
  keyTopics: string[];
  actionItems: string[];
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  context: string;
  relevanceScore: number;
}

export class ClaudeEnricher {
  private client: Anthropic | null = null;
  private enabled: boolean = false;

  constructor() {
    if (CONFIG.ANTHROPIC_API_KEY && CONFIG.ANTHROPIC_API_KEY.length > 0) {
      this.client = new Anthropic({
        apiKey: CONFIG.ANTHROPIC_API_KEY,
      });
      this.enabled = true;
      console.log('[ClaudeEnricher] Initialized with API key');
    } else {
      console.warn('[ClaudeEnricher] ANTHROPIC_API_KEY not configured - enrichment disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async enrichThreads(
    threads: EmailThread[],
    meetingTitle: string,
    meetingDate?: string
  ): Promise<Map<string, ThreadEnrichment>> {
    if (!this.enabled || !this.client) {
      console.log('[ClaudeEnricher] Enrichment skipped - not enabled');
      return new Map();
    }

    const enrichments = new Map<string, ThreadEnrichment>();

    // Process threads sequentially to avoid rate limits
    for (const thread of threads) {
      try {
        const enrichment = await this.enrichSingleThread(thread, meetingTitle, meetingDate);
        enrichments.set(thread.threadId, enrichment);
        console.log(`[ClaudeEnricher] Enriched thread ${thread.threadId}`);
      } catch (error) {
        console.error(`[ClaudeEnricher] Failed to enrich thread ${thread.threadId}:`, error);
        // Continue with other threads - don't fail entire process
      }
    }

    return enrichments;
  }

  private async enrichSingleThread(
    thread: EmailThread,
    meetingTitle: string,
    meetingDate?: string
  ): Promise<ThreadEnrichment> {
    const prompt = this.buildAnalysisPrompt(thread, meetingTitle, meetingDate);

    const message = await this.client!.messages.create({
      model: 'claude-sonnet-4-5-20250929', // Latest Sonnet model
      max_tokens: 1024,
      temperature: 0.3, // Lower temperature for more consistent analysis
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Parse Claude's response
    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    return this.parseEnrichmentResponse(responseText);
  }

  private buildAnalysisPrompt(
    thread: EmailThread,
    meetingTitle: string,
    meetingDate?: string
  ): string {
    // Limit content to last 5 messages to avoid token limits
    const recentMessages = thread.messages.slice(-5);

    const messagesText = recentMessages
      .map((msg, i) => {
        const from = msg.from || 'Unknown';
        const date = msg.date || 'Unknown date';
        const snippet = msg.snippet || '';
        return `Message ${i + 1} (${date}):\nFrom: ${from}\n${snippet}`;
      })
      .join('\n\n---\n\n');

    return `You are analyzing an email thread to provide context for an upcoming meeting.

Meeting Details:
- Title: ${meetingTitle}
${meetingDate ? `- Date: ${meetingDate}` : ''}

Email Thread:
Subject: ${thread.subject}
Recent Messages (up to 5):

${messagesText}

Analyze this email thread and provide a structured response in the following JSON format:

{
  "keyTopics": ["topic1", "topic2", "topic3"],
  "actionItems": ["item1", "item2"],
  "sentiment": "positive|neutral|negative|mixed",
  "context": "2-3 sentence summary of the most important context",
  "relevanceScore": 85
}

Guidelines:
- keyTopics: 2-4 main discussion themes (e.g., "Budget approval", "Technical requirements")
- actionItems: Open questions or pending decisions mentioned (0-3 items)
- sentiment: Overall tone of the exchange
- context: Concise summary focusing on what's most relevant to the upcoming meeting
- relevanceScore: 0-100, how relevant this thread is to the meeting (consider recency, participants, topics)

Respond ONLY with valid JSON, no additional text.`;
  }

  private parseEnrichmentResponse(responseText: string): ThreadEnrichment {
    try {
      // Extract JSON from response (Claude might include some text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and provide defaults
      return {
        keyTopics: Array.isArray(parsed.keyTopics)
          ? parsed.keyTopics.slice(0, 4).map(String)
          : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? parsed.actionItems.slice(0, 3).map(String)
          : [],
        sentiment: ['positive', 'neutral', 'negative', 'mixed'].includes(parsed.sentiment)
          ? parsed.sentiment
          : 'neutral',
        context: typeof parsed.context === 'string'
          ? parsed.context.slice(0, 500)
          : 'No context available',
        relevanceScore: typeof parsed.relevanceScore === 'number'
          ? Math.max(0, Math.min(100, parsed.relevanceScore))
          : 50
      };
    } catch (error) {
      console.error('[ClaudeEnricher] Failed to parse enrichment response:', error);
      // Return default/fallback enrichment
      return {
        keyTopics: [],
        actionItems: [],
        sentiment: 'neutral',
        context: 'Analysis unavailable',
        relevanceScore: 50
      };
    }
  }
}

// Singleton instance
export const claudeEnricher = new ClaudeEnricher();
