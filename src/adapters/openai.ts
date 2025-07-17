import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

// @cursor TASK: Implement OpenAI news adapter for RSS feed handling

interface RSSItem {
  title?: string;
  link?: string;
  pubDate?: string;
  guid?: string;
  description?: string;
  categories?: string[];
  category?: string | string[];
}

// OpenAI news feed configuration
const OPENAI_FEEDS = {
  'openai-news': 'https://openai.com/news/rss.xml',
} as const;

function normalizeDescription(item: RSSItem): string {
  // Extract description for metadata, but don't use as content
  if (item.description) {
    // Clean up CDATA and basic HTML entities
    return item.description
      .replace(/&nbsp;/g, ' ')   // Replace non-breaking spaces
      .replace(/&amp;/g, '&')    // Replace HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .trim();
  }
  
  return '';
}

function normalizeCategories(item: RSSItem): string[] {
  const categories: string[] = [];
  
  if (item.categories) {
    categories.push(...item.categories);
  }
  
  if (item.category) {
    if (Array.isArray(item.category)) {
      categories.push(...item.category);
    } else {
      categories.push(item.category);
    }
  }
  
  return categories;
}

function validateAndNormalizeItem(item: RSSItem, sourceSlug: string): ParsedItem | null {
  if (!item.title || !item.link || !item.guid) {
    return null;
  }

  const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
  const description = normalizeDescription(item);
  
  return {
    external_id: item.guid,
    source_slug: sourceSlug,
    title: item.title.trim(),
    url: item.link,
    content: '', // Leave empty - content will be scraped by ingestion agent
    published_at: publishedAt,
    author: undefined, // OpenAI RSS doesn't include author info
    image_url: undefined, // No image info in RSS feed
    original_metadata: {
      description,
      categories: normalizeCategories(item),
      raw_item: item
    }
  };
}

async function fetchSingleFeed(sourceSlug: string, feedUrl: string): Promise<ParsedItem[]> {
  const parser = new Parser();
  
  try {
    const feed = await parser.parseURL(feedUrl);
    const items: ParsedItem[] = [];
    
    for (const item of feed.items || []) {
      const normalizedItem = validateAndNormalizeItem(item as RSSItem, sourceSlug);
      if (normalizedItem) {
        items.push(normalizedItem);
      }
    }
    
    return items;
  } catch (error) {
    console.error(`Error fetching OpenAI feed ${sourceSlug}:`, error);
    return [];
  }
}

export async function fetchAndParse(feedSlugs?: string[]): Promise<ParsedItem[]> {
  const slugsToProcess = feedSlugs || Object.keys(OPENAI_FEEDS);
  const allItems: ParsedItem[] = [];
  
  // Process feeds in parallel (though only one feed currently)
  const feedPromises = slugsToProcess.map(async (slug) => {
    const feedUrl = OPENAI_FEEDS[slug as keyof typeof OPENAI_FEEDS];
    if (!feedUrl) {
      console.warn(`Unknown OpenAI feed slug: ${slug}`);
      return [];
    }
    
    return fetchSingleFeed(slug, feedUrl);
  });
  
  const results = await Promise.all(feedPromises);
  
  // Flatten results
  for (const items of results) {
    allItems.push(...items);
  }
  
  return allItems;
}

// Individual feed function for backward compatibility
export async function fetchOpenAINews(): Promise<ParsedItem[]> {
  return fetchSingleFeed('openai-news', OPENAI_FEEDS['openai-news']);
}

export const openaiAdapter = {
  name: 'OpenAI News',
  fetchAndParse,
  supportedSources: Object.keys(OPENAI_FEEDS)
};

export default openaiAdapter; 