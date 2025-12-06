import {
  companyResearchSchemaV1,
  type CompanyResearch,
  type MCPToolContext
} from '../contracts/index.js';
import { HttpError } from '../errors.js';

export const name = 'company.research.v1';
export const version = 'v1';
export const inputSchema = companyResearchSchemaV1;
export const description = 'Search the web for company information including industry, size, revenue, news, and social links';

// Simple in-memory cache with 24-hour TTL
interface CacheEntry {
  data: CompanyResearch;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCacheKey(company?: string, domain?: string): string {
  return (company?.toLowerCase() || domain?.toLowerCase() || '').trim();
}

function getCachedResult(cacheKey: string): CompanyResearch | null {
  const entry = cache.get(cacheKey);
  if (entry && entry.expiresAt > Date.now()) {
    console.log(`[MCP-Tool:${name}] Cache HIT for key: ${cacheKey}`);
    return entry.data;
  }
  if (entry) {
    cache.delete(cacheKey);
    console.log(`[MCP-Tool:${name}] Cache EXPIRED for key: ${cacheKey}`);
  }
  return null;
}

function setCachedResult(cacheKey: string, data: CompanyResearch): void {
  cache.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  console.log(`[MCP-Tool:${name}] Cached result for key: ${cacheKey}`);
}

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

async function searchWithGoogleAPI(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    throw new HttpError(
      500,
      'SEARCH_API_NOT_CONFIGURED',
      'Google Search API is not configured',
      {
        hint: 'Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables'
      }
    );
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', searchEngineId);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new HttpError(
      response.status,
      'SEARCH_API_ERROR',
      `Google Search API error: ${response.statusText}`
    );
  }

  const data = await response.json() as any;
  return (data.items || []).map((item: any) => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet
  }));
}

async function searchWeb(query: string, company?: string, domain?: string): Promise<SearchResult[]> {
  console.log(`[MCP-Tool:${name}] Searching web for: ${query}`);

  // Check if we're in development mode (no API key configured)
  const isDevelopmentMode = !process.env.GOOGLE_SEARCH_API_KEY;

  if (isDevelopmentMode) {
    console.log(`[MCP-Tool:${name}] Running in development mode - returning mock data`);
    return generateMockSearchResults(company || domain || 'unknown');
  }

  try {
    return await searchWithGoogleAPI(query);
  } catch (error) {
    console.error(`[MCP-Tool:${name}] Search error:`, error);
    throw error;
  }
}

function generateMockSearchResults(companyName: string): SearchResult[] {
  // Generate realistic mock data for development/testing
  return [
    {
      title: `${companyName} - Company Overview`,
      link: `https://www.${companyName.toLowerCase().replace(/\s+/g, '')}.com`,
      snippet: `${companyName} is a leading provider of innovative solutions. Founded in 2010, the company serves customers worldwide with cutting-edge technology.`
    },
    {
      title: `${companyName} | LinkedIn`,
      link: `https://www.linkedin.com/company/${companyName.toLowerCase().replace(/\s+/g, '-')}`,
      snippet: `${companyName} | 5,000+ employees | Technology & Software | Transforming the industry with innovative solutions.`
    },
    {
      title: `${companyName} announces record Q4 revenue`,
      link: `https://news.example.com/${companyName.toLowerCase()}-q4-revenue`,
      snippet: `${companyName} reported annual revenue of $500M, up 25% year-over-year. The company continues to expand its market presence.`
    },
    {
      title: `${companyName} launches new product line`,
      link: `https://techcrunch.example.com/${companyName.toLowerCase()}-product-launch`,
      snippet: `${companyName} unveiled its latest innovation today, expanding into new market segments. Industry experts predict strong adoption.`
    }
  ];
}

function extractCompanyInfo(searchResults: SearchResult[], searchQuery: string, company?: string, domain?: string): CompanyResearch {
  console.log(`[MCP-Tool:${name}] Extracting info from ${searchResults.length} search results`);

  let companyName: string | undefined;
  let industry: string | undefined;
  let employeeCount: string | undefined;
  let revenue: string | undefined;
  let description: string | undefined;
  let website: string | undefined;
  let linkedInUrl: string | undefined;
  const recentNews: Array<{ headline: string; date?: string; url?: string }> = [];

  // Extract company name (from input or first result)
  companyName = company;

  // Process each search result
  for (const result of searchResults) {
    const lowerTitle = result.title.toLowerCase();
    const lowerSnippet = result.snippet.toLowerCase();
    const combinedText = `${result.title} ${result.snippet}`.toLowerCase();

    // Extract LinkedIn URL
    if (result.link.includes('linkedin.com/company') && !linkedInUrl) {
      linkedInUrl = result.link;

      // Try to extract employee count from LinkedIn snippet
      const employeeMatch = result.snippet.match(/(\d{1,3}(?:,\d{3})*\+?)\s*employees?/i);
      if (employeeMatch && !employeeCount) {
        employeeCount = employeeMatch[1];
      }

      // Try to extract industry from LinkedIn snippet
      const parts = result.snippet.split('|');
      if (parts.length > 1 && !industry) {
        industry = parts[1].trim().split('|')[0].trim();
      }
    }

    // Extract website (non-LinkedIn, non-news sites)
    if (!website &&
        !result.link.includes('linkedin.com') &&
        !result.link.includes('news') &&
        !result.link.includes('crunchbase') &&
        (lowerTitle.includes(company?.toLowerCase() || domain?.toLowerCase() || '') ||
         result.link.includes(domain || ''))) {
      website = result.link;
    }

    // Extract company description (from main company page)
    if (!description &&
        (lowerTitle.includes('about') || lowerTitle.includes('overview') || lowerTitle === (company?.toLowerCase() || ''))) {
      description = result.snippet.split('.').slice(0, 2).join('.').trim();
      if (description.length > 200) {
        description = description.substring(0, 200) + '...';
      }
    }

    // Extract revenue information
    if (!revenue && (combinedText.includes('revenue') || combinedText.includes('annual'))) {
      const revenueMatch = result.snippet.match(/\$(\d+(?:\.\d+)?)\s*(million|billion|m|b)/i);
      if (revenueMatch) {
        revenue = `$${revenueMatch[1]}${revenueMatch[2].charAt(0).toUpperCase()}`;
      }
    }

    // Extract employee headcount if not found yet
    if (!employeeCount) {
      const empMatch = result.snippet.match(/(\d{1,3}(?:,\d{3})*)\s*employees?/i);
      if (empMatch) {
        employeeCount = empMatch[1];
      }
    }

    // Collect recent news (articles with dates or news-related keywords)
    if (recentNews.length < 3 &&
        (lowerTitle.includes('announces') ||
         lowerTitle.includes('launches') ||
         lowerTitle.includes('news') ||
         result.link.includes('news') ||
         result.link.includes('blog') ||
         result.link.includes('press'))) {

      // Try to extract date
      const dateMatch = result.snippet.match(/(\w+ \d{1,2},? \d{4})|(\d{1,2}\/\d{1,2}\/\d{4})/);

      recentNews.push({
        headline: result.title,
        date: dateMatch ? dateMatch[0] : undefined,
        url: result.link
      });
    }
  }

  // Use domain as website fallback
  if (!website && domain) {
    website = domain.startsWith('http') ? domain : `https://${domain}`;
  }

  return {
    companyName,
    industry,
    employeeCount,
    revenue,
    description,
    website,
    linkedInUrl,
    recentNews,
    lastUpdated: Date.now(),
    searchQuery
  };
}

export async function handler(
  args: unknown,
  context: MCPToolContext
): Promise<CompanyResearch> {
  console.log(`[MCP-Tool:${name}] called with args:`, JSON.stringify(args));

  try {
    const params = inputSchema.parse(args);
    const cacheKey = getCacheKey(params.company, params.domain);

    // Check cache first
    const cachedResult = getCachedResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Build search query
    let searchQuery: string;
    if (params.domain) {
      searchQuery = `site:${params.domain} OR ${params.domain} company information`;
    } else if (params.company) {
      searchQuery = `"${params.company}" company information`;
    } else {
      throw new HttpError(
        400,
        'INVALID_INPUT',
        'Either company name or domain must be provided'
      );
    }

    console.log(`[MCP-Tool:${name}] Search query: ${searchQuery}`);

    // Perform web search
    const searchResults = await searchWeb(searchQuery, params.company, params.domain);

    // Extract structured information from results
    const companyInfo = extractCompanyInfo(searchResults, searchQuery, params.company, params.domain);

    // Cache the result
    setCachedResult(cacheKey, companyInfo);

    console.log(`[MCP-Tool:${name}] Successfully researched company: ${params.company || params.domain}`);

    return companyInfo;
  } catch (error) {
    console.error(`[MCP-Tool:${name}] ERROR:`, error);
    throw error;
  }
}
