import Anthropic from '@anthropic-ai/sdk';
import { CompanyResearch } from '../contracts/index.js';

/*
<important_code_snippet_instructions>
The newest Anthropic model is "claude-sonnet-4-20250514", not "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022" nor "claude-3-sonnet-20240229". 
If the user doesn't specify a model, always prefer using "claude-sonnet-4-20250514" as it is the latest model.
</important_code_snippet_instructions>
*/

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

export function isAnthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function researchCompanyWithClaude(
  domain?: string,
  companyName?: string
): Promise<CompanyResearch | null> {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[anthropicResearch] ANTHROPIC_API_KEY not configured, skipping Claude web search');
    return null;
  }

  const searchTarget = companyName || domain;
  if (!searchTarget) {
    console.log('[anthropicResearch] No company name or domain provided');
    return null;
  }

  console.log(`[anthropicResearch] Researching company: ${searchTarget} using Claude web_search`);

  try {
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system: `You are a sales intelligence researcher. Your task is to gather key business facts about companies for sales call preparation. 
Return ONLY a JSON object with the following structure (omit any fields you cannot find):
{
  "companyName": "string - official company name",
  "industry": "string - primary industry sector",
  "employeeCount": "string - employee count (e.g., '500+', '1,000-5,000')",
  "revenue": "string - annual revenue if available (e.g., '$50M', '$1B')",
  "description": "string - brief 1-2 sentence company description",
  "website": "string - company website URL",
  "linkedInUrl": "string - LinkedIn company page URL if found",
  "recentNews": [{"headline": "string", "date": "string", "url": "string"}] - up to 3 recent news items
}

Be concise and factual. Only include information you find via web search. Return valid JSON only, no markdown.`,
      messages: [
        {
          role: 'user',
          content: `Research this company for a sales call: ${searchTarget}${domain ? ` (domain: ${domain})` : ''}. Find their company info, size, revenue, industry, and any recent news.`
        }
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3
        }
      ]
    });

    console.log(`[anthropicResearch] Claude response received, stop_reason: ${response.stop_reason}`);

    let textContent = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      }
    }

    if (!textContent) {
      console.log('[anthropicResearch] No text content in response');
      return null;
    }

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[anthropicResearch] Could not extract JSON from response:', textContent.slice(0, 200));
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const result: CompanyResearch = {
      companyName: parsed.companyName,
      industry: parsed.industry,
      employeeCount: parsed.employeeCount,
      revenue: parsed.revenue,
      description: parsed.description,
      website: parsed.website,
      linkedInUrl: parsed.linkedInUrl,
      recentNews: (parsed.recentNews || []).slice(0, 3).map((n: any) => ({
        headline: n.headline || n.title,
        date: n.date,
        url: n.url
      })),
      lastUpdated: Date.now(),
      searchQuery: `Claude web_search: ${searchTarget}`
    };

    console.log(`[anthropicResearch] Successfully researched: ${result.companyName || searchTarget}`);
    return result;

  } catch (error) {
    console.error('[anthropicResearch] Error during Claude web search:', error);
    return null;
  }
}
