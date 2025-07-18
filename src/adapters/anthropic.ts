import { ParsedItem } from '../types/adapter';
import * as cheerio from 'cheerio';

const ANTHROPIC_NEWS_URL = 'https://www.anthropic.com/news';

interface AnthropicPost {
  title: string;
  url: string;
  dateText: string;
  publishedAt: Date;
  category: string;
  description?: string;
}

async function fetchAnthropicNewsPage(): Promise<string> {
  console.log('[Anthropic] Fetching news page');
  
  try {
    const response = await fetch(ANTHROPIC_NEWS_URL, {
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
    
    // Rate limiting delay (2 seconds for politeness)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return html;
  } catch (error) {
    console.error('[Anthropic] Error fetching news page:', error);
    throw error;
  }
}

function parseDate(dateString: string): Date {
  try {
    // Handle formats like "Jul 15, 2025", "May 22, 2025", etc.
    const cleanDateString = dateString.trim();
    
    // Parse using JavaScript Date constructor
    const parsed = new Date(cleanDateString);
    
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    console.warn(`[Anthropic] Could not parse date: "${dateString}". Using current date.`);
    return new Date();
  } catch (error) {
    console.warn(`[Anthropic] Date parsing error for "${dateString}":`, error);
    return new Date();
  }
}

function extractCategory(categoryText: string): string {
  if (!categoryText) return 'announcement';
  
  const category = categoryText.toLowerCase().trim();
  
  // Map common categories
  const categoryMap: Record<string, string> = {
    'announcements': 'announcement',
    'product': 'product',
    'policy': 'policy',
    'research': 'research',
    'alignment': 'research',
    'interpretability': 'research',
    'societal impacts': 'societal-impact',
    'education': 'education',
    'event': 'event'
  };
  
  return categoryMap[category] || 'announcement';
}

function extractPostsFromHTML(html: string): AnthropicPost[] {
  const $ = cheerio.load(html);
  const posts: AnthropicPost[] = [];
  
  console.log('[Anthropic] Parsing HTML for news posts');
  
  // Try multiple selectors for news items
  const articleSelectors = [
    'article',
    '.news-item',
    '.post-item',
    'a[href*="/news/"]',
    '[data-testid*="news"]',
    '.grid > a', // Grid layout items
    'a[href^="/"]' // Internal links
  ];
  
  let articles: cheerio.Cheerio | null = null;
  let usedSelector = '';
  
  // First, try to find the main content area and news items within it
  const mainContent = $('main, .main-content, #main, .content');
  
  for (const selector of articleSelectors) {
    if (mainContent.length > 0) {
      articles = mainContent.find(selector);
    } else {
      articles = $(selector);
    }
    
    // Filter for items that look like news articles
    articles = articles.filter((_, el) => {
      const $el = $(el);
      const href = $el.attr('href');
      const text = $el.text().trim();
      
      // Must have href and some text content
      return !!(href && text.length > 10 && 
               (href.includes('/news/') || 
                href.includes('announcing') || 
                href.includes('introducing') ||
                text.toLowerCase().includes('claude') ||
                text.toLowerCase().includes('anthropic')));
    });
    
    if (articles.length > 0) {
      usedSelector = selector;
      break;
    }
  }
  
  if (!articles || articles.length === 0) {
    console.warn('[Anthropic] No news articles found with any selector');
    return [];
  }
  
  console.log(`[Anthropic] Found ${articles.length} potential news items using selector: ${usedSelector}`);
  
  articles.each((index: number, element: any) => {
    try {
      const $article = $(element);
      
      // Extract URL
      let url = $article.attr('href') || '';
      if (!url) {
        // Try to find link within the article
        const link = $article.find('a').first();
        url = link.attr('href') || '';
      }
      
      if (!url) {
        console.warn(`[Anthropic] Article ${index + 1}: No URL found`);
        return;
      }
      
      // Make URL absolute
      if (url.startsWith('/')) {
        url = `https://www.anthropic.com${url}`;
      }
      
      // Skip non-news URLs
      if (!url.includes('anthropic.com') || url === ANTHROPIC_NEWS_URL) {
        return;
      }
      
      // Extract title - try multiple selectors
      const titleSelectors = [
        'h1', 'h2', 'h3', 'h4', 
        '.title', '.headline', 
        '[data-testid*="title"]',
        'a'
      ];
      
      let title = '';
      for (const titleSelector of titleSelectors) {
        const titleElement = $article.find(titleSelector).first();
        if (titleElement.length === 0 && titleSelector === 'a') {
          // If it's an 'a' selector and we're already on an 'a' element
          title = $article.text().trim();
        } else {
          title = titleElement.text().trim();
        }
        if (title && title.length > 5) break;
      }
      
      if (!title) {
        title = $article.text().trim();
      }
      
      // Clean up title
      title = title
        .replace(/\s+/g, ' ')
        .replace(/^\s*[•·]\s*/, '') // Remove bullet points
        .replace(/^(Announcements|Featured|Product|Policy|Research|Alignment|Interpretability|Societal Impacts|Education|Event)\s*/i, '') // Remove category prefixes
        .trim();
      
      if (!title || title.length < 5) {
        console.warn(`[Anthropic] Article ${index + 1}: No meaningful title found`);
        return;
      }
      
      // Extract date - look for date patterns
      const dateSelectors = [
        '.date', '.published', '.timestamp',
        '[data-testid*="date"]',
        'time'
      ];
      
      let dateText = '';
      
      // First try structured date selectors
      for (const dateSelector of dateSelectors) {
        const dateElement = $article.find(dateSelector);
        dateText = dateElement.text().trim();
        if (dateText) break;
      }
      
      // If no structured date found, look for date patterns in text
      if (!dateText) {
        const allText = $article.text();
        const datePattern = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}/i;
        const match = allText.match(datePattern);
        if (match) {
          dateText = match[0];
        }
      }
      
      // Fallback to current date if no date found
      if (!dateText) {
        dateText = new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      }
      
      const publishedAt = parseDate(dateText);
      
      // Extract category from text or context
      let category = 'announcement';
      const categoryText = $article.find('.category, .tag, .label').text().trim();
      if (categoryText) {
        category = extractCategory(categoryText);
      } else {
        // Infer category from title
        const titleLower = title.toLowerCase();
        if (titleLower.includes('introducing') || titleLower.includes('announcing')) {
          category = 'announcement';
        } else if (titleLower.includes('claude') || titleLower.includes('model')) {
          category = 'product';
        } else if (titleLower.includes('policy') || titleLower.includes('safety')) {
          category = 'policy';
        } else if (titleLower.includes('research') || titleLower.includes('alignment')) {
          category = 'research';
        }
      }
      
      // Extract description if available
      const description = $article.find('.description, .summary, .excerpt, p').first().text().trim();
      
      posts.push({
        title,
        url,
        dateText,
        publishedAt,
        category,
        description: description || undefined
      });
      
      console.log(`[Anthropic] Parsed: "${title}" (${dateText}) [${category}]`);
      
    } catch (itemError) {
      console.warn(`[Anthropic] Failed to parse article ${index + 1}:`, itemError);
    }
  });
  
  return posts;
}

function createExternalId(url: string): string {
  try {
    const urlObj = new URL(url);
    // Use path segments to create a unique ID
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    if (pathSegments.length >= 2) {
      return pathSegments.slice(1).join('-'); // Skip 'news' segment
    }
    return pathSegments.join('-') || url;
  } catch {
    return url;
  }
}

function generateTags(title: string, category: string, description?: string): string[] {
  const tags = ['anthropic', 'ai-safety', 'claude'];
  
  // Add category as tag
  if (category && !tags.includes(category)) {
    tags.push(category);
  }
  
  const content = `${title} ${description || ''}`.toLowerCase();
  
  // Add tags based on content
  const tagMappings = [
    { keywords: ['claude 4', 'claude-4'], tag: 'claude-4' },
    { keywords: ['claude 3', 'claude-3'], tag: 'claude-3' },
    { keywords: ['constitutional ai', 'constitutional'], tag: 'constitutional-ai' },
    { keywords: ['alignment', 'ai alignment'], tag: 'ai-alignment' },
    { keywords: ['safety', 'ai safety'], tag: 'ai-safety' },
    { keywords: ['interpretability'], tag: 'interpretability' },
    { keywords: ['policy', 'governance'], tag: 'ai-policy' },
    { keywords: ['research', 'paper'], tag: 'ai-research' },
    { keywords: ['enterprise', 'business'], tag: 'enterprise' },
    { keywords: ['api', 'developer'], tag: 'developer-tools' },
    { keywords: ['education', 'university'], tag: 'education' },
    { keywords: ['computer use', 'tool use'], tag: 'computer-use' },
    { keywords: ['red team', 'security'], tag: 'security' },
    { keywords: ['partnership', 'collaboration'], tag: 'partnerships' }
  ];
  
  for (const mapping of tagMappings) {
    if (mapping.keywords.some(keyword => content.includes(keyword))) {
      if (!tags.includes(mapping.tag)) {
        tags.push(mapping.tag);
      }
    }
  }
  
  return tags.slice(0, 6);
}

export async function fetchAndParse(): Promise<ParsedItem[]> {
  console.log('[Anthropic] Starting fetch from Anthropic News');
  
  try {
    // Fetch the news page
    const html = await fetchAnthropicNewsPage();
    
    // Extract posts from HTML
    const posts = extractPostsFromHTML(html);
    
    if (posts.length === 0) {
      console.warn('[Anthropic] No posts extracted from page');
      return [];
    }
    
    console.log(`[Anthropic] Successfully extracted ${posts.length} posts`);
    
    // Convert to ParsedItem format with deduplication
    const items: ParsedItem[] = [];
    const seenIds = new Set<string>();
    
    for (const post of posts) {
      const tags = generateTags(post.title, post.category, post.description);
      const externalId = createExternalId(post.url);
      
      // Skip duplicates
      if (seenIds.has(externalId)) {
        console.log(`[Anthropic] Skipping duplicate: "${post.title}"`);
        continue;
      }
      seenIds.add(externalId);
      
      items.push({
        external_id: externalId,
        source_slug: 'anthropic_news', // Single feed adapter
        title: post.title,
        url: post.url,
        content: '', // Empty to trigger IngestionAgent content enrichment
        published_at: post.publishedAt.toISOString(),
        author: undefined, // Anthropic posts don't typically show individual authors
        image_url: undefined,
        original_metadata: {
          anthropic_title: post.title,
          anthropic_url: post.url,
          anthropic_date_text: post.dateText,
          anthropic_category: post.category,
          anthropic_description: post.description,
          anthropic_generated_tags: tags,
          processing_timestamp: new Date().toISOString(),
          processing_source: 'Anthropic News Scraper'
        }
      });
    }
    
    // Sort by publication date (newest first)
    items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
    
    console.log(`[Anthropic] Successfully parsed ${items.length} unique news posts`);
    return items;
    
  } catch (error) {
    console.error('[Anthropic] Adapter error:', error);
    // Return empty array to avoid blocking pipeline
    return [];
  }
} 