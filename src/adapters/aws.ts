import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

// @cursor TASK: Implement AWS blogs adapter for unified RSS feed handling

interface RSSItem {
  title?: string;
  link?: string;
  pubDate?: string;
  guid?: string;
  creator?: string;
  'dc:creator'?: string;
  description?: string;
  'content:encoded'?: string;
  contentEncoded?: string;
  categories?: string[];
  category?: string | string[];
}

// AWS blog feed configuration
const AWS_FEEDS = {
  'aws-big-data': 'https://aws.amazon.com/blogs/big-data/feed/',
  'aws-machine-learning': 'https://aws.amazon.com/blogs/machine-learning/feed/',
  'aws-startups': 'https://aws.amazon.com/blogs/startups/feed/',
  'aws-developer': 'https://aws.amazon.com/blogs/developer/feed/',
  'aws-database': 'https://aws.amazon.com/blogs/database/feed/',
} as const;

// Mapping from database slugs (underscores) to internal feed keys (hyphens)
const SLUG_MAPPING: Record<string, string> = {
  // Database format → Internal format
  'aws_big_data': 'aws-big-data',
  'aws_ml': 'aws-machine-learning', 
  'aws_startups': 'aws-startups',
  'aws_developer': 'aws-developer',
  'aws_database': 'aws-database',
};

// Convert database slug to internal feed key
function mapSlugToFeedKey(slug: string): string {
  // If it's already in internal format, return as-is
  if (AWS_FEEDS.hasOwnProperty(slug)) {
    return slug;
  }
  
  // If it's in database format, convert it
  const mapped = SLUG_MAPPING[slug];
  if (mapped) {
    return mapped;
  }
  
  // Fallback: try converting underscores to hyphens
  const fallback = slug.replace(/_/g, '-');
  if (AWS_FEEDS.hasOwnProperty(fallback)) {
    return fallback;
  }
  
  // Return original if no mapping found
  return slug;
}

function normalizeContent(item: RSSItem): string {
  // Prioritize content:encoded for full article content
  const fullContent = item['content:encoded'] || item.contentEncoded;
  if (fullContent) {
    // Strip HTML tags while preserving text structure
    return fullContent
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
  
  // Fallback to description if no full content
  return item.description?.trim() || '';
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
  // AWS blogs typically include images in content:encoded
  const content = item['content:encoded'] || item.contentEncoded || '';
  
  // Look for first image in content
  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/i);
  if (imgMatch) {
    return imgMatch[1];
  }
  
  return undefined;
}

function validateAndNormalizeItem(item: RSSItem, sourceSlug: string): ParsedItem | null {
  if (!item.title || !item.link || !item.guid) {
    return null;
  }

  const content = normalizeContent(item);
  if (!content) {
    return null;
  }

  const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
  
  return {
    external_id: item.guid,
          source_slug: sourceSlug, // Already correct - uses the feed key
    title: item.title.trim(),
    url: item.link,
    content,
    published_at: publishedAt,
    author: normalizeAuthor(item),
    image_url: extractImageUrl(item),
    original_metadata: {
      categories: normalizeCategories(item),
      description: item.description,
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
    console.error(`Error fetching AWS feed ${sourceSlug}:`, error);
    return [];
  }
}

export async function fetchAndParse(feedSlugs?: string[]): Promise<ParsedItem[]> {
  const slugsToProcess = feedSlugs || Object.keys(AWS_FEEDS);
  const allItems: ParsedItem[] = [];
  
  // Process feeds in parallel
  const feedPromises = slugsToProcess.map(async (originalSlug) => {
    const feedKey = mapSlugToFeedKey(originalSlug);
    const feedUrl = AWS_FEEDS[feedKey as keyof typeof AWS_FEEDS];
    
    if (!feedUrl) {
      console.warn(`Unknown AWS feed slug: ${originalSlug} (mapped to: ${feedKey})`);
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

// Individual feed functions for backward compatibility
export async function fetchAwsBigData(): Promise<ParsedItem[]> {
  return fetchSingleFeed('aws-big-data', AWS_FEEDS['aws-big-data']);
}

export async function fetchAwsMachineLearning(): Promise<ParsedItem[]> {
  return fetchSingleFeed('aws-machine-learning', AWS_FEEDS['aws-machine-learning']);
}

export async function fetchAwsStartups(): Promise<ParsedItem[]> {
  return fetchSingleFeed('aws-startups', AWS_FEEDS['aws-startups']);
}

export async function fetchAwsDeveloper(): Promise<ParsedItem[]> {
  return fetchSingleFeed('aws-developer', AWS_FEEDS['aws-developer']);
}

export async function fetchAwsDatabase(): Promise<ParsedItem[]> {
  return fetchSingleFeed('aws-database', AWS_FEEDS['aws-database']);
}

export const awsAdapter = {
  name: 'AWS Blogs',
  fetchAndParse,
  supportedSources: Object.keys(AWS_FEEDS)
};

export default awsAdapter; 