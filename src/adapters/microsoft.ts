import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

// @cursor TASK: Implement Microsoft blogs adapter for unified RSS feed handling

interface RSSItem {
  title?: string;
  link?: string;
  pubDate?: string;
  guid?: string;
  creator?: string;
  'dc:creator'?: string;
  'dc:date'?: string;
  description?: string;
  content?: string;
  contentSnippet?: string;
  categories?: string[];
  category?: string | string[];
}

// Microsoft blog feed configuration
const MICROSOFT_FEEDS = {
  'microsoft-365-insider': 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=Microsoft365InsiderBlog',
  'microsoft-excel': 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=ExcelBlog',
} as const;

function normalizeContent(item: RSSItem): string {
  // Microsoft feeds use content field for main content, fallback to description
  const contentField = item.content || item.description;
  if (contentField) {
    // Strip HTML tags while preserving text structure
    return contentField
      .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
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

function normalizeAuthor(item: RSSItem): string | undefined {
  return item['dc:creator'] || item.creator || undefined;
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

function extractImageUrl(item: RSSItem): string | undefined {
  // Microsoft feeds typically include images in content
  const contentField = item.content || item.description || '';
  
  // Look for first image in content
  const imgMatch = contentField.match(/<img[^>]+src="([^"]+)"/i);
  if (imgMatch) {
    return imgMatch[1];
  }
  
  return undefined;
}

function validateAndNormalizeItem(item: RSSItem, sourceSlug: string): ParsedItem | null {
  if (!item.title || !item.link) {
    return null;
  }

  const content = normalizeContent(item);
  if (!content) {
    return null;
  }

  // Use dc:date if available, otherwise pubDate
  const dateString = item['dc:date'] || item.pubDate;
  const publishedAt = dateString ? new Date(dateString).toISOString() : new Date().toISOString();
  
  // Use guid if available, otherwise use link as external_id
  const externalId = item.guid || item.link;
  
  return {
    external_id: externalId,
    source_slug: sourceSlug,
    title: item.title.trim(),
    url: item.link,
    content,
    published_at: publishedAt,
    author: normalizeAuthor(item),
    image_url: extractImageUrl(item),
    original_metadata: {
      categories: normalizeCategories(item),
      description: item.description,
      content: item.content,
      contentSnippet: item.contentSnippet,
      dc_date: item['dc:date'],
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
    console.error(`Error fetching Microsoft feed ${sourceSlug}:`, error);
    return [];
  }
}

export async function fetchAndParse(feedSlugs?: string[]): Promise<ParsedItem[]> {
  const slugsToProcess = feedSlugs || Object.keys(MICROSOFT_FEEDS);
  const allItems: ParsedItem[] = [];
  
  // Process feeds in parallel
  const feedPromises = slugsToProcess.map(async (slug) => {
    const feedUrl = MICROSOFT_FEEDS[slug as keyof typeof MICROSOFT_FEEDS];
    if (!feedUrl) {
      console.warn(`Unknown Microsoft feed slug: ${slug}`);
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

// Individual feed functions for backward compatibility
export async function fetchMicrosoft365Insider(): Promise<ParsedItem[]> {
  return fetchSingleFeed('microsoft-365-insider', MICROSOFT_FEEDS['microsoft-365-insider']);
}

export async function fetchMicrosoftExcel(): Promise<ParsedItem[]> {
  return fetchSingleFeed('microsoft-excel', MICROSOFT_FEEDS['microsoft-excel']);
}

export const microsoftAdapter = {
  name: 'Microsoft Blogs',
  fetchAndParse,
  supportedSources: Object.keys(MICROSOFT_FEEDS)
};

export default microsoftAdapter; 