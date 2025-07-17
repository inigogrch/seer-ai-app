import Parser from 'rss-parser';
import { ParsedItem } from '../types/adapter';

const RSS_URL = 'https://venturebeat.com/feed/';

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
      return {
        external_id: item.guid || item.link || '',
        source_slug: 'venturebeat',
        title: item.title || '',
        url: item.link || '',
        content: '', // Leave empty - ingestion agent will scrape full content
        published_at: item.pubDate || item.isoDate || '',
        author: item.author || undefined,
        image_url: undefined, // Will be extracted by ingestion agent from content
        original_metadata: {
          categories: item.categories || [],
          guid: item.guid,
          description: item.description,
          contentEncoded: item.contentEncoded
        }
      };
    });
  } catch (error) {
    console.error('Error fetching VentureBeat feed:', error);
    throw error;
  }
} 