import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

const RSS_URL = 'https://sloanreview.mit.edu/feed/';

export async function fetchAndParse(): Promise<ParsedItem[]> {
  const parser = new Parser({
    customFields: {
      item: [
        ['dc:creator', 'author'],
        ['description', 'description'],
        ['content:encoded', 'contentEncoded']
      ]
    }
  });

  try {
    const feed = await parser.parseURL(RSS_URL);
    
    return feed.items.map((item): ParsedItem => {
      // Extract content from content:encoded (rich HTML content available)
      let content = item.contentEncoded || item.content || item.description || '';
      
      // Strip HTML tags but preserve text content
      content = content.replace(/<[^>]*>/g, '').trim();
      
      // Clean up extra whitespace and line breaks
      content = content.replace(/\s+/g, ' ').trim();
      
      return {
        external_id: item.guid || item.link || '',
                  source_slug: 'mit_sloan', // Single feed adapter
        title: item.title || '',
        url: item.link || '',
        content: content,
        published_at: item.pubDate || item.isoDate || '',
        author: item.author || undefined,
        image_url: undefined, // Images are embedded in content:encoded
        original_metadata: {
          categories: item.categories || [],
          guid: item.guid,
          description: item.description,
          contentEncoded: item.contentEncoded
        }
      };
    });
  } catch (error) {
    console.error('Error fetching MIT Sloan feed:', error);
    throw error;
  }
} 