import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

const RSS_URL = 'https://tldr.tech/api/rss/tech';

interface TLDRStory {
  title: string;
  url: string;
  summary: string;
  category: string;
  publishedAt: Date;
}

async function fetchDailyDigestUrls(): Promise<{ url: string; publishedAt: Date; title: string }[]> {
  console.log('[TLDR.tech] Fetching daily digest URLs from RSS feed');
  
  const parser = new Parser();
  
  try {
    const feed = await parser.parseURL(RSS_URL);
    
    console.log(`[TLDR.tech] Found ${feed.items.length} daily digests`);
    
    return feed.items.map((item) => ({
      url: item.link || '',
      publishedAt: new Date(item.pubDate || item.isoDate || Date.now()),
      title: item.title || ''
    }));
    
  } catch (error) {
    console.error('[TLDR.tech] Error fetching RSS feed:', error);
    throw error;
  }
}

async function scrapeStoriesFromDigest(digestUrl: string, digestDate: Date): Promise<TLDRStory[]> {
  console.log(`[TLDR.tech] Scraping stories from ${digestUrl}`);
  
  try {
    const response = await fetch(digestUrl, {
      headers: {
        'User-Agent': 'Seer-AI/1.0 (+https://seer-ai.app)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const stories: TLDRStory[] = [];
    
    // Extract articles using regex patterns
    const articleRegex = /<article[^>]*class="mt-3"[^>]*>[\s\S]*?<\/article>/g;
    const articles = html.match(articleRegex) || [];
    
    let currentCategory = 'General';
    
    // Extract category headers
    const categoryHeaderRegex = /<h3[^>]*class="text-center font-bold"[^>]*>([^<]+)<\/h3>/g;
    let categoryMatch;
    const categories: string[] = [];
    
    while ((categoryMatch = categoryHeaderRegex.exec(html)) !== null) {
      categories.push(categoryMatch[1].replace(/&amp;/g, '&').trim());
    }
    
    let categoryIndex = 0;
    
    for (const article of articles) {
      try {
        // Extract title and URL
        const titleMatch = article.match(/<h3[^>]*>([^<]+)<\/h3>/);
        const urlMatch = article.match(/<a[^>]*href="([^"]*)"[^>]*>/);
        
        if (titleMatch && urlMatch) {
          let title = titleMatch[1].trim();
          let url = urlMatch[1].trim();
          
          // Clean title
          title = title.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&#8217;/g, "'").trim();
          
          // Remove read time from title if present
          title = title.replace(/\s*\(\d+\s*minute\s*read\)\s*/g, '').trim();
          
          // Skip sponsor content
          if (title.toLowerCase().includes('sponsor') || 
              url.includes('utm_campaign') && url.includes('sponsor')) {
            continue;
          }
          
          // Use category from context
          if (categoryIndex < categories.length) {
            currentCategory = categories[categoryIndex];
          }
          
          // Extract summary from article content
          let summary = '';
          const summaryMatch = article.match(/dangerouslySetInnerHTML[^>]*__html[^>]*"([^"]*)"/) ||
                               article.match(/<p[^>]*>([^<]+)<\/p>/);
          
          if (summaryMatch) {
            summary = summaryMatch[1]
              .replace(/\\u003c[^>]*\\u003e/g, '')
              .replace(/\\"/g, '"')
              .replace(/&amp;/g, '&')
              .replace(/<[^>]*>/g, '')
              .trim();
          }
          
          stories.push({
            title,
            url,
            summary: summary || title, // Fallback to title if no summary
            category: currentCategory,
            publishedAt: digestDate
          });
        }
      } catch (err) {
        console.warn(`[TLDR.tech] Error parsing article: ${err}`);
        continue;
      }
      
      // Move to next category periodically
      if (stories.length > 0 && stories.length % 5 === 0) {
        categoryIndex++;
      }
    }
    
    console.log(`[TLDR.tech] Extracted ${stories.length} stories from digest`);
    return stories;
    
  } catch (error) {
    console.error(`[TLDR.tech] Error scraping ${digestUrl}:`, error);
    return [];
  }
}

export async function fetchAndParse(): Promise<ParsedItem[]> {
  console.log('[TLDR.tech] Starting fetch from TLDR.tech');
  
  try {
    // Get daily digest URLs from RSS
    const digests = await fetchDailyDigestUrls();
    
    if (digests.length === 0) {
      console.log('[TLDR.tech] No digests found');
      return [];
    }
    
    // Process recent digests (limit to 3 for performance)
    const recentDigests = digests.slice(0, 3);
    console.log(`[TLDR.tech] Processing ${recentDigests.length} recent digests`);
    
    const allStories: TLDRStory[] = [];
    
    // Process each digest
    for (const digest of recentDigests) {
      try {
        const stories = await scrapeStoriesFromDigest(digest.url, digest.publishedAt);
        allStories.push(...stories);
        
        // Short delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`[TLDR.tech] Error processing digest ${digest.url}:`, error);
        continue;
      }
    }
    
    if (allStories.length === 0) {
      console.log('[TLDR.tech] No stories extracted from digests');
      return [];
    }
    
    // Convert to ParsedItem format
    const items: ParsedItem[] = allStories.map((story, index) => {
      // Create unique external ID using URL hash or fallback
      const urlHash = story.url ? 
        `${story.url.split('/').pop()?.split('?')[0] || 'story'}-${index}` : 
        `story-${Date.now()}-${index}`;
      
      return {
        external_id: `tldr-${urlHash}`,
        source_slug: 'tldr-tech',
        title: story.title,
        url: story.url,
        content: '', // Leave empty - ingestion agent will scrape full content
        published_at: story.publishedAt.toISOString(),
        author: undefined, // TLDR.tech aggregates content from multiple sources
        image_url: undefined, // Will be extracted by ingestion agent
        original_metadata: {
          source_name: 'TLDR.tech',
          content_type: 'newsletter_story',
          category: story.category,
          summary: story.summary,
          digest_date: story.publishedAt.toISOString().split('T')[0],
          platform: 'tldr_tech'
        }
      };
    });
    
    // Sort by publish date (newest first)
    items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
    
    console.log(`[TLDR.tech] Successfully processed ${items.length} individual stories`);
    return items;
    
  } catch (error) {
    console.error('[TLDR.tech] Error in fetch:', error);
    throw error;
  }
} 