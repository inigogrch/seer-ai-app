// Unified MIT News adapter for Seer-AI
// Handles MIT News RSS feeds: research, data, AI
import Parser from 'rss-parser';
import type { ParsedItem } from '../types/adapter';

interface MitRssItem extends Record<string, unknown> {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  'content:encoded'?: string;
  guid?: string;
  categories?: string[];
  pubDate?: string;
  creator?: string;
  'dc:creator'?: string;
  isoDate?: string;
  enclosure?: {
    url?: string;
    type?: string;
  };
  custom?: {
    'media:content'?: Array<{
      $?: {
        url?: string;
        medium?: string;
        type?: string;
        width?: string;
        height?: string;
      };
    }>;
  };
}

interface MitFeedConfig {
  slug: string;
  category: string;
  url: string;
}

const MIT_FEEDS: Record<string, MitFeedConfig> = {
  mit_research: {
    slug: 'mit_research',
    category: 'Research',
    url: 'https://news.mit.edu/rss/research'
  },
  mit_data: {
    slug: 'mit_data', 
    category: 'Data',
    url: 'https://news.mit.edu/topic/mitdata-rss.xml'
  },
  mit_ai: {
    slug: 'mit_ai',
    category: 'AI',
    url: 'https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml'
  }
};

const parser = new Parser({
  customFields: {
    item: [
      ['dc:creator', 'creator'],
      ['content:encoded', 'contentEncoded'],
      ['media:content', 'mediaContent']
    ]
  }
});

export async function fetchAndParse(feedSlugs?: string[]): Promise<ParsedItem[]> {
  // If no feedSlugs provided, fetch all MIT feeds
  if (!feedSlugs || feedSlugs.length === 0) {
    const allItems: ParsedItem[] = [];
    for (const slug of Object.keys(MIT_FEEDS)) {
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
  const feedConfig = MIT_FEEDS[feedSlug];
  
  if (!feedConfig) {
    console.error(`[mit] Unknown feed slug: ${feedSlug}`);
    return [];
  }
  
  try {
    console.log(`[${feedSlug}] Fetching MIT ${feedConfig.category} RSS feed from ${feedConfig.url}`);
    
    // Fetch and parse RSS feed
    const feed = await parser.parseURL(feedConfig.url);
    
    console.log(`[${feedSlug}] Found ${feed.items.length} items in RSS feed`);
    
    const parsedItems: ParsedItem[] = [];
    
    for (const item of feed.items) {
      try {
        const parsedItem = normalizeItem(item as unknown as MitRssItem, feedSlug);
        
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

function normalizeItem(item: MitRssItem, sourceSlug: string): ParsedItem | null {
  // Validate required fields
  if (!item.guid || !item.title || !item.link) {
    console.warn(`[${sourceSlug}] Skipping item missing required fields:`, {
      guid: !!item.guid,
      title: !!item.title,
      link: !!item.link
    });
    return null;
  }
  
  // Normalize and validate fields
  const external_id = normalizeString(item.guid);
  const title = normalizeString(item.title);
  const url = normalizeUrl(item.link);
  const content = normalizeContent(item);
  const published_at = normalizeDate(item.pubDate || item.isoDate);
  const author = normalizeString(item.creator || item['dc:creator']);
  const image_url = extractImageUrl(item);
  
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
    image_url,
    original_metadata: item as Record<string, unknown>
  };
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
  
  // Relative URLs for MIT should be prefixed
  if (normalized.startsWith('/')) {
    return `https://news.mit.edu${normalized}`;
  }
  
  return normalized;
}

function normalizeContent(item: MitRssItem): string {
  // MIT feeds provide different content fields:
  // 1. content:encoded (full HTML article) - PREFER THIS
  // 2. content (summary)
  // 3. contentSnippet (plain text summary)
  
  // First try to get the full article content from content:encoded
  const fullContent = item['content:encoded'] || '';
  if (fullContent) {
    // Strip HTML tags and clean up the text
    const stripped = fullContent
      .replace(/<[^>]*>/g, ' ') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
      .replace(/&[a-zA-Z]+;/g, ' ') // Replace other HTML entities
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    if (stripped.length > 100) { // Only use if we got substantial content
      return normalizeString(stripped);
    }
  }
  
  // Fallback to description/summary fields
  const description = item.content || item.contentSnippet || '';
  return normalizeString(description);
}

function extractImageUrl(item: MitRssItem): string | undefined {
  // Try media:content from custom fields (rss-parser extracts this)
  if (item.custom?.['media:content']) {
    const mediaContent = item.custom['media:content'];
    if (Array.isArray(mediaContent) && mediaContent.length > 0) {
      const imageUrl = mediaContent[0]?.$?.url;
      if (imageUrl && isValidUrl(imageUrl)) {
        return imageUrl;
      }
    }
  }
  
  // Try mediaContent directly (alternate parsing structure)
  if ((item as any).mediaContent?.$?.url) {
    const imageUrl = (item as any).mediaContent.$.url;
    if (isValidUrl(imageUrl)) {
      return imageUrl;
    }
  }
  
  // Try enclosure
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
    const imageUrl = item.enclosure.url;
    if (isValidUrl(imageUrl)) {
      return imageUrl;
    }
  }
  
  return undefined;
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
export async function fetchAndParseResearch(): Promise<ParsedItem[]> {
  return fetchSingleFeed('mit_research');
}

export async function fetchAndParseData(): Promise<ParsedItem[]> {
  return fetchSingleFeed('mit_data');
}

export async function fetchAndParseAI(): Promise<ParsedItem[]> {
  return fetchSingleFeed('mit_ai');
} 