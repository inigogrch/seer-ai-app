import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

const RSS_URL = 'https://techcrunch.com/feed/';

export async function fetchAndParse(): Promise<ParsedItem[]> {
  const parser = new Parser({
    customFields: {
      item: [
        ['dc:creator', 'author'],
        ['description', 'description']
      ]
    }
  });

  try {
    const feed = await parser.parseURL(RSS_URL);
    
    return feed.items.map((item): ParsedItem => {
      return {
        external_id: item.guid || item.link || '',
        source_slug: 'techcrunch',
        title: item.title || '',
        url: item.link || '',
        content: '', // Leave empty - ingestion agent will scrape full content
        published_at: item.pubDate || item.isoDate || '',
        author: item.author || undefined,
        image_url: undefined, // TechCrunch RSS doesn't include images in the basic feed
        original_metadata: {
          categories: item.categories || [],
          guid: item.guid,
          contentSnippet: item.contentSnippet,
          description: item.description
        }
      };
    });
  } catch (error) {
    console.error('Error fetching TechCrunch feed:', error);
    throw error;
  }
} 