import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

// @cursor TASK: Implement NVIDIA Developer Blog adapter for Atom feed handling

interface AtomItem {
  title?: string;
  link?: string;
  published?: string;
  updated?: string;
  id?: string;
  guid?: string;
  author?: string;
  creator?: string;
  'dc:creator'?: string;
  summary?: string;
  content?: string;
  'content:encoded'?: string;
  contentEncoded?: string;
  categories?: string[];
  category?: string | string[];
}

// NVIDIA blog feed configuration
const NVIDIA_FEEDS = {
  'nvidia-developer': 'https://developer.nvidia.com/blog/feed',
} as const;

// Mapping from database slugs (underscores) to internal feed keys (hyphens)
const SLUG_MAPPING: Record<string, string> = {
  // Database format → Internal format
  'nvidia_developer': 'nvidia-developer',
};

// Convert database slug to internal feed key
function mapSlugToFeedKey(slug: string): string {
  // If it's already in internal format, return as-is
  if (NVIDIA_FEEDS.hasOwnProperty(slug)) {
    return slug;
  }
  
  // If it's in database format, convert it
  const mapped = SLUG_MAPPING[slug];
  if (mapped) {
    return mapped;
  }
  
  // Fallback: try converting underscores to hyphens
  const fallback = slug.replace(/_/g, '-');
  if (NVIDIA_FEEDS.hasOwnProperty(fallback)) {
    return fallback;
  }
  
  // Return original if no mapping found
  return slug;
}

function normalizeContent(item: AtomItem): string {
  // For Atom feeds, prioritize content over summary
  const fullContent = item.content || item['content:encoded'] || item.contentEncoded;
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
  
  // Fallback to summary if no full content
  return item.summary?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';
}

function normalizeAuthor(item: AtomItem): string | undefined {
  return item.author || item['dc:creator'] || item.creator || undefined;
}

function normalizeCategories(item: AtomItem): string[] {
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

function extractImageUrl(item: AtomItem): string | undefined {
  // NVIDIA blog posts typically include images in content
  const content = item.content || item['content:encoded'] || item.contentEncoded || '';
  
  // Look for first image in content
  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/i);
  if (imgMatch) {
    return imgMatch[1];
  }
  
  return undefined;
}

function extractUrl(item: AtomItem): string | undefined {
  // Handle both RSS-style link and Atom-style link
  if (typeof item.link === 'string') {
    return item.link;
  }
  
  // For Atom feeds, link might be an object or array
  if (item.link && typeof item.link === 'object') {
    const linkObj = item.link as any;
    if (linkObj.href) {
      return linkObj.href;
    }
    if (Array.isArray(linkObj) && linkObj[0]?.href) {
      return linkObj[0].href;
    }
  }
  
  return undefined;
}

function validateAndNormalizeItem(item: AtomItem, sourceSlug: string): ParsedItem | null {
  const url = extractUrl(item);
  const externalId = item.id || item.guid;
  
  if (!item.title || !url || !externalId) {
    return null;
  }

  const content = normalizeContent(item);
  if (!content) {
    return null;
  }

  // Use published date for Atom, fallback to updated
  const publishedAt = item.published ? new Date(item.published).toISOString() : 
                     item.updated ? new Date(item.updated).toISOString() : 
                     new Date().toISOString();
  
  return {
    external_id: externalId,
    source_slug: sourceSlug,
    title: item.title.trim(),
    url,
    content,
    published_at: publishedAt,
    author: normalizeAuthor(item),
    image_url: extractImageUrl(item),
    original_metadata: {
      categories: normalizeCategories(item),
      summary: item.summary,
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
      const normalizedItem = validateAndNormalizeItem(item as AtomItem, sourceSlug);
      if (normalizedItem) {
        items.push(normalizedItem);
      }
    }
    
    return items;
  } catch (error) {
    console.error(`Error fetching NVIDIA feed ${sourceSlug}:`, error);
    return [];
  }
}

export async function fetchAndParse(feedSlugs?: string[]): Promise<ParsedItem[]> {
  const slugsToProcess = feedSlugs || Object.keys(NVIDIA_FEEDS);
  const allItems: ParsedItem[] = [];
  
  // Process feeds in parallel (though only one feed currently)
  const feedPromises = slugsToProcess.map(async (originalSlug) => {
    const feedKey = mapSlugToFeedKey(originalSlug);
    const feedUrl = NVIDIA_FEEDS[feedKey as keyof typeof NVIDIA_FEEDS];
    
    if (!feedUrl) {
      console.warn(`Unknown NVIDIA feed slug: ${originalSlug} (mapped to: ${feedKey})`);
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
export async function fetchNVIDIADeveloper(): Promise<ParsedItem[]> {
  return fetchSingleFeed('nvidia-developer', NVIDIA_FEEDS['nvidia-developer']);
}

export const nvidiaAdapter = {
  name: 'NVIDIA Developer Blog',
  fetchAndParse,
  supportedSources: Object.keys(NVIDIA_FEEDS)
};

export default nvidiaAdapter; 