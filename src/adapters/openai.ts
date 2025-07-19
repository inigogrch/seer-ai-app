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
  content?: string;
  contentSnippet?: string;
}

// OpenAI news feed configuration
const OPENAI_FEEDS = {
  'openai-news': 'https://openai.com/news/rss.xml',
} as const;

// Mapping from database slugs (underscores) to internal feed keys (hyphens)
const SLUG_MAPPING: Record<string, string> = {
  // Database format → Internal format
  'openai_news': 'openai-news',
};

// Convert database slug to internal feed key
function mapSlugToFeedKey(slug: string): string {
  // If it's already in internal format, return as-is
  if (OPENAI_FEEDS.hasOwnProperty(slug)) {
    return slug;
  }
  
  // If it's in database format, convert it
  const mapped = SLUG_MAPPING[slug];
  if (mapped) {
    return mapped;
  }
  
  // Fallback: try converting underscores to hyphens
  const fallback = slug.replace(/_/g, '-');
  if (OPENAI_FEEDS.hasOwnProperty(fallback)) {
    return fallback;
  }
  
  // Return original if no mapping found
  return slug;
}

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
  
  // Store RSS content in metadata but set content to empty to trigger custom extraction
  const rssContent = item.content || item.contentSnippet || description || '';
  
  return {
    external_id: item.guid,
    source_slug: sourceSlug,
    title: item.title.trim(),
    url: item.link,
    content: '', // Empty to trigger custom OpenAI content extraction
    published_at: publishedAt,
    author: undefined, // OpenAI RSS doesn't include author info
    image_url: undefined, // No image info in RSS feed
    original_metadata: {
      description,
      categories: normalizeCategories(item),
      rss_content: rssContent, // Store RSS content for fallback
      rss_content_length: rssContent.length,
      raw_item: item
    }
  };
}

async function fetchSingleFeed(sourceSlug: string, feedUrl: string): Promise<ParsedItem[]> {
  const parser = new Parser();
  
  try {
    const feed = await parser.parseURL(feedUrl);
    const items: ParsedItem[] = [];
    
    // Filter for articles from 2025 onwards
    const targetYear = 2025;
    const jan1_2025 = new Date('2025-01-01T00:00:00Z');
    
    for (const item of feed.items || []) {
      const normalizedItem = validateAndNormalizeItem(item as RSSItem, sourceSlug);
      if (normalizedItem) {
        // Check if article is from 2025 onwards
        const publishDate = new Date(normalizedItem.published_at);
        if (publishDate >= jan1_2025) {
          items.push(normalizedItem);
        }
      }
    }
    
    // Sort by date (newest first) and limit to 200 recent items
    items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
    const limitedItems = items.slice(0, 200);
    
    console.log(`[OpenAI] Filtered to ${limitedItems.length} articles from ${targetYear} onwards (from ${feed.items?.length || 0} total)`);
    
    return limitedItems;
  } catch (error) {
    console.error(`Error fetching OpenAI feed ${sourceSlug}:`, error);
    return [];
  }
}

export async function fetchAndParse(feedSlugs?: string[]): Promise<ParsedItem[]> {
  const slugsToProcess = feedSlugs || Object.keys(OPENAI_FEEDS);
  const allItems: ParsedItem[] = [];
  
  // Process feeds in parallel (though only one feed currently)
  const feedPromises = slugsToProcess.map(async (originalSlug) => {
    const feedKey = mapSlugToFeedKey(originalSlug);
    const feedUrl = OPENAI_FEEDS[feedKey as keyof typeof OPENAI_FEEDS];
    
    if (!feedUrl) {
      console.warn(`Unknown OpenAI feed slug: ${originalSlug} (mapped to: ${feedKey})`);
      return [];
    }
    
    // Fetch with internal feed key but return items with original database slug
    const items = await fetchSingleFeed(feedKey, feedUrl);
    
    // Convert source_slug back to original database format
    return items.map(item => ({
      ...item,
      source_slug: originalSlug // Use the original database format
    }));
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