import { ParsedItem } from '../types/adapter';
import * as cheerio from 'cheerio';

const GOOGLE_RESEARCH_URL = 'https://research.google/blog/';

interface GoogleResearchPost {
  title: string;
  url: string;
  dateText: string;
  publishedAt: Date;
  tags: string[];
}

async function fetchGoogleResearchPage(): Promise<string> {
  console.log('[Google Research] Fetching research blog page');
  
  try {
    const response = await fetch(GOOGLE_RESEARCH_URL, {
      headers: {
        'User-Agent': 'Seer-AI/1.0 (+https://seer-ai.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Rate limiting delay (1 second)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return html;
  } catch (error) {
    console.error('[Google Research] Error fetching research blog:', error);
    throw error;
  }
}

function parseDate(dateString: string): Date {
  try {
    // Handle format: "July 10, 2025" or similar
    const cleanDateString = dateString.trim();
    
    // Try parsing with JavaScript Date constructor
    const parsed = new Date(cleanDateString);
    
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    console.warn(`[Google Research] Could not parse date: "${dateString}". Using current date.`);
    return new Date();
  } catch (error) {
    console.warn(`[Google Research] Date parsing error for "${dateString}":`, error);
    return new Date();
  }
}

function extractTags($: cheerio.Root, cardElement: cheerio.Cheerio): string[] {
  const tags = ['google-research', 'ai-research']; // Default tags
  
  try {
    // Look for tags in various possible locations
    const tagElements = cardElement.find('.glue-card__link-list .not-glue.caption, .tag, .category');
    
    tagElements.each((_: number, element: any) => {
      const tagText = $(element).text().trim();
      if (tagText && tagText !== '·' && tagText !== '&183;' && tagText !== '&#183;') {
        // Clean up the tag text and convert to lowercase
        const cleanTag = tagText
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .replace(/·/g, '') // Remove bullet separators
          .replace(/\s+·\s+/g, ' ') // Remove spaced bullets
          .replace(/^\s*·\s*/, '') // Remove leading bullets
          .replace(/\s*·\s*$/, '') // Remove trailing bullets
          .toLowerCase()
          .trim();
        
        if (cleanTag && cleanTag.length > 2 && !tags.includes(cleanTag)) {
          tags.push(cleanTag);
        }
      }
    });
  } catch (error) {
    console.warn('[Google Research] Failed to extract tags:', error);
  }
  
  // Add some common research tags based on title content
  return tags.slice(0, 5);
}

function extractPostsFromHTML(html: string): GoogleResearchPost[] {
  const $ = cheerio.load(html);
  const posts: GoogleResearchPost[] = [];
  
  console.log('[Google Research] Parsing HTML for blog posts');
  
  // Try multiple selectors for blog post cards
  const cardSelectors = [
    'a.glue-card.not-glue',
    '.blog-post-card',
    '.research-post',
    'a[href*="/blog/"]',
    '.glue-card'
  ];
  
  let cards: cheerio.Cheerio | null = null;
  let usedSelector = '';
  
  for (const selector of cardSelectors) {
    cards = $(selector);
    if (cards.length > 0) {
      usedSelector = selector;
      break;
    }
  }
  
  if (!cards || cards.length === 0) {
    console.warn('[Google Research] No blog post cards found with any selector');
    return [];
  }
  
  console.log(`[Google Research] Found ${cards.length} blog post cards using selector: ${usedSelector}`);
  
  cards.each((index: number, element: any) => {
    try {
      const $card = $(element);
      
      // Extract URL (make absolute)
      const relativeUrl = $card.attr('href');
      if (!relativeUrl) {
        console.warn(`[Google Research] Card ${index + 1}: No href found`);
        return; // Skip this card
      }
      
      const url = new URL(relativeUrl, GOOGLE_RESEARCH_URL).toString();
      
      // Extract title - try multiple selectors
      const titleSelectors = [
        '.headline-5.js-gt-item-id',
        '.headline-5',
        '.title',
        'h3',
        'h2',
        '.glue-card__title'
      ];
      
      let title = '';
      for (const titleSelector of titleSelectors) {
        const titleElement = $card.find(titleSelector);
        title = titleElement.text().trim();
        if (title) break;
      }
      
      if (!title) {
        console.warn(`[Google Research] Card ${index + 1}: No title found`);
        return; // Skip this card
      }
      
      // Extract date - try multiple selectors
      const dateSelectors = [
        '.glue-label.glue-spacer-1-bottom',
        '.date',
        '.published-date',
        '.glue-label',
        'time'
      ];
      
      let dateText = '';
      for (const dateSelector of dateSelectors) {
        const dateElement = $card.find(dateSelector);
        dateText = dateElement.text().trim();
        if (dateText) break;
      }
      
      if (!dateText) {
        console.warn(`[Google Research] Card ${index + 1}: No date found for "${title}"`);
        dateText = new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
      
      const publishedAt = parseDate(dateText);
      
      // Extract tags
      const tags = extractTags($, $card);
      
      posts.push({
        title,
        url,
        dateText,
        publishedAt,
        tags
      });
      
      console.log(`[Google Research] Parsed: "${title}" (${dateText})`);
      
    } catch (itemError) {
      console.warn(`[Google Research] Failed to parse card ${index + 1}:`, itemError);
    }
  });
  
  return posts;
}

function createExternalId(url: string): string {
  // Use the URL path as external ID for Google Research posts
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.replace('/blog/', '').replace(/\/$/, '') || url;
  } catch {
    return url;
  }
}

function generateTags(title: string, existingTags: string[]): string[] {
  const allTags = [...existingTags];
  
  const titleLower = title.toLowerCase();
  
  // Add tags based on title content
  const tagMappings = [
    { keywords: ['llm', 'language model', 'large language'], tag: 'llm' },
    { keywords: ['neural network', 'deep learning'], tag: 'deep-learning' },
    { keywords: ['computer vision', 'image', 'visual'], tag: 'computer-vision' },
    { keywords: ['natural language', 'nlp'], tag: 'nlp' },
    { keywords: ['machine learning', 'ml'], tag: 'machine-learning' },
    { keywords: ['ai', 'artificial intelligence'], tag: 'artificial-intelligence' },
    { keywords: ['research', 'study'], tag: 'research' },
    { keywords: ['algorithm', 'model'], tag: 'algorithms' },
    { keywords: ['data', 'dataset'], tag: 'data-science' },
    { keywords: ['robotics', 'robot'], tag: 'robotics' },
    { keywords: ['quantum', 'quantum computing'], tag: 'quantum-computing' },
    { keywords: ['healthcare', 'medical', 'health'], tag: 'ai-healthcare' },
    { keywords: ['climate', 'environment', 'sustainability'], tag: 'ai-climate' }
  ];
  
  for (const mapping of tagMappings) {
    if (mapping.keywords.some(keyword => titleLower.includes(keyword))) {
      if (!allTags.includes(mapping.tag)) {
        allTags.push(mapping.tag);
      }
    }
  }
  
  return allTags.slice(0, 5);
}

export async function fetchAndParse(): Promise<ParsedItem[]> {
  console.log('[Google Research] Starting fetch from Google Research Blog');
  
  try {
    // Fetch the blog page
    const html = await fetchGoogleResearchPage();
    
    // Extract posts from HTML
    const posts = extractPostsFromHTML(html);
    
    if (posts.length === 0) {
      console.warn('[Google Research] No posts extracted from page');
      return [];
    }
    
    console.log(`[Google Research] Successfully extracted ${posts.length} posts`);
    
    // Convert to ParsedItem format with deduplication
    const items: ParsedItem[] = [];
    const seenIds = new Set<string>();
    
    for (const post of posts) {
      const tags = generateTags(post.title, post.tags);
      const externalId = createExternalId(post.url);
      
      // Skip duplicates
      if (seenIds.has(externalId)) {
        console.log(`[Google Research] Skipping duplicate: "${post.title}"`);
        continue;
      }
      seenIds.add(externalId);
      
      items.push({
        external_id: externalId,
        source_slug: 'google-research',
        title: post.title,
        url: post.url,
        content: '', // Leave empty - ingestion agent will scrape full content
        published_at: post.publishedAt.toISOString(),
        author: undefined, // Google Research posts don't typically have individual authors
        image_url: undefined,
        original_metadata: {
          google_title: post.title,
          google_url: post.url,
          google_date_text: post.dateText,
          google_extracted_tags: post.tags,
          google_generated_tags: tags,
          processing_timestamp: new Date().toISOString(),
          processing_source: 'Google Research Blog Scraper'
        }
      });
    }
    
    // Sort by publication date (newest first)
    items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
    
    console.log(`[Google Research] Successfully parsed ${items.length} unique research posts`);
    return items;
    
  } catch (error) {
    console.error('[Google Research] Adapter error:', error);
    // Return empty array to avoid blocking pipeline
    return [];
  }
} 