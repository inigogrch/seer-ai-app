// Unified arXiv adapter for Seer-AI
// Handles all arXiv RSS feeds: cs, stat, etc.
import Parser from 'rss-parser';
import type { ParsedItem } from '../types/adapter';

interface ArxivRssItem extends Record<string, unknown> {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
  categories?: string[];
  pubDate?: string;
  creator?: string;
  isoDate?: string;
  custom?: {
    'arxiv:announce_type'?: string;
    'dc:rights'?: string;
    'dc:creator'?: string;
  };
}

interface ArxivFeedConfig {
  slug: string;
  category: string;
  url: string;
}

const ARXIV_FEEDS: Record<string, ArxivFeedConfig> = {
  arxiv_cs: {
    slug: 'arxiv_cs',
    category: 'Computer Science',
    url: 'https://rss.arxiv.org/rss/cs'
  },
  arxiv_stat: {
    slug: 'arxiv_stat',
    category: 'Statistics',
    url: 'https://rss.arxiv.org/rss/stat'
  }
};

const parser = new Parser({
  customFields: {
    item: [
      ['dc:creator', 'creator'],
      ['arxiv:announce_type', 'announceType'],
      ['dc:rights', 'rights']
    ]
  }
});

export async function fetchAndParse(feedSlugs?: string[]): Promise<ParsedItem[]> {
  // If no feedSlugs provided, fetch all arXiv feeds
  if (!feedSlugs || feedSlugs.length === 0) {
    const allItems: ParsedItem[] = [];
    for (const slug of Object.keys(ARXIV_FEEDS)) {
      const items = await fetchSingleFeed(slug);
      allItems.push(...items);
    }
    return allItems;
  }
  
  // Process each requested feed slug
  const allItems: ParsedItem[] = [];
  for (const feedSlug of feedSlugs) {
    const items = await fetchSingleFeed(feedSlug);
    allItems.push(...items);
  }
  return allItems;
}

async function fetchSingleFeed(feedSlug: string): Promise<ParsedItem[]> {
  const feedConfig = ARXIV_FEEDS[feedSlug];
  
  if (!feedConfig) {
    console.error(`[arxiv] Unknown feed slug: ${feedSlug}`);
    return [];
  }
  
  try {
    console.log(`[${feedSlug}] Fetching arXiv ${feedConfig.category} RSS feed from ${feedConfig.url}`);
    
    // Fetch and parse RSS feed
    const feed = await parser.parseURL(feedConfig.url);
    
    console.log(`[${feedSlug}] Found ${feed.items.length} items in RSS feed`);
    
    const parsedItems: ParsedItem[] = [];
    
    for (const item of feed.items) {
      try {
        const parsedItem = normalizeItem(item as unknown as ArxivRssItem, feedSlug);
        
        if (parsedItem) {
          parsedItems.push(parsedItem);
        }
      } catch (itemError) {
        console.error(`[${feedSlug}] Error parsing item:`, itemError);
        // Continue processing other items
      }
    }
    
    console.log(`[${feedSlug}] Successfully parsed ${parsedItems.length} items`);
    return parsedItems;
    
  } catch (error) {
    console.error(`[${feedSlug}] Adapter error:`, error);
    // Return empty array to avoid blocking pipeline
    return [];
  }
}

function normalizeItem(item: ArxivRssItem, sourceSlug: string): ParsedItem | null {
  // Validate required fields
  if (!item.guid || !item.title || !item.link) {
    console.warn(`[${sourceSlug}] Skipping item missing required fields:`, {
      guid: !!item.guid,
      title: !!item.title,
      link: !!item.link
    });
    return null;
  }
  
  // Extract canonical arXiv ID from GUID
  // Format: oai:arXiv.org:2507.10572v1 → 2507.10572
  const external_id = extractCanonicalArxivId(item.guid);
  if (!external_id) {
    console.warn(`[${sourceSlug}] Skipping item with invalid arXiv ID format: ${item.guid}`);
    return null;
  }
  
  const title = normalizeString(item.title);
  const url = normalizeUrl(item.link);
  const content = normalizeContent(item.content || item.contentSnippet || '');
  const published_at = normalizeDate(item.pubDate || item.isoDate);
  const author = normalizeString(item.creator);
  
  // Validate URL
  if (!isValidUrl(url)) {
    console.warn(`[${sourceSlug}] Skipping item with invalid URL: ${url}`);
    return null;
  }
  
  return {
    external_id,
    source_slug: sourceSlug,
    title,
    url,
    content,
    published_at,
    author,
    // No image_url for arXiv RSS feeds
    original_metadata: item as Record<string, unknown>
  };
}

function extractCanonicalArxivId(guid: string): string | null {
  // Remove oai:arXiv.org: prefix and version suffix (vN)
  // Input: oai:arXiv.org:2507.10572v1
  // Output: 2507.10572
  const match = guid.match(/oai:arXiv\.org:(\d{4}\.\d{4,5})(?:v\d+)?$/);
  if (match) {
    return match[1];
  }
  
  // Fallback: try to extract just the arXiv ID pattern
  const directMatch = guid.match(/(\d{4}\.\d{4,5})(?:v\d+)?$/);
  if (directMatch) {
    return directMatch[1];
  }
  
  return null;
}

function normalizeString(str?: string): string {
  if (!str) return '';
  return str
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

function normalizeUrl(url?: string): string {
  if (!url) return '';
  const normalized = normalizeString(url);
  
  // Ensure absolute URL
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }
  
  // Relative URLs for arXiv should be prefixed
  if (normalized.startsWith('/')) {
    return `https://arxiv.org${normalized}`;
  }
  
  return normalized;
}

function normalizeContent(content: string): string {
  if (!content) return '';
  
  // Extract abstract from arXiv description format
  // Format: "arXiv:2507.10553v1 Announce Type: new \nAbstract: [actual content]"
  const abstractMatch = content.match(/Abstract:\s*(.*)/s);
  if (abstractMatch) {
    return normalizeString(abstractMatch[1]);
  }
  
  return normalizeString(content);
}

function normalizeDate(dateStr?: string): string {
  if (!dateStr) {
    return new Date().toISOString();
  }
  
  try {
    // Parse and convert to ISO 8601
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      console.warn(`Invalid date format: ${dateStr}, using current time`);
      return new Date().toISOString();
    }
    return date.toISOString();
  } catch (error) {
    console.warn(`Date parsing error for "${dateStr}":`, error);
    return new Date().toISOString();
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
}

// Export individual feed functions for backward compatibility
export async function fetchAndParseCs(): Promise<ParsedItem[]> {
  return fetchSingleFeed('arxiv_cs');
}

export async function fetchAndParseStat(): Promise<ParsedItem[]> {
  return fetchSingleFeed('arxiv_stat');
} 