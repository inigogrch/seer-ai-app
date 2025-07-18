/**
 * Tools for the IngestionAgent
 * These tools handle various aspects of the ingestion pipeline
 */

import { tool } from '@openai/agents';
import { createClient } from '@supabase/supabase-js';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { openai } from '../../utils/openaiClient';
import { loadEnvironmentConfig } from '../../config/environment';
import { z } from 'zod';

const config = loadEnvironmentConfig();

// Execute Functions (exported for direct use)

export const fetchAdapterDataExecute = async ({ sourceSlug }: { sourceSlug: string }) => {
  try {
    // Dynamically import the adapter module
    const adapter = await import(`../../adapters/${sourceSlug}`);
    
    if (!adapter.fetchAndParse) {
      throw new Error(`Adapter ${sourceSlug} does not have fetchAndParse method`);
    }
    
    const items = await adapter.fetchAndParse();
    console.log(`Fetched ${items.length} items from ${sourceSlug}`);
    
    return { success: true, items };
  } catch (error) {
    console.error(`Error fetching adapter data for ${sourceSlug}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error', 
      items: [] 
    };
  }
};

export const fetchURLContentExecute = async ({ url }: { url: string }) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SeerAI/1.0; +https://seerai.app)'
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    return { success: true, html, contentLength: html.length };
  } catch (error) {
    console.error(`Error fetching URL content from ${url}:`, error);
    const errorMessage = error instanceof Error 
      ? (error.name === 'AbortError' ? 'Request timeout' : error.message)
      : 'Unknown error';
    return { 
      success: false, 
      error: errorMessage,
      html: null 
    };
  }
};

export const extractMainContentExecute = async ({ html, url }: { html: string; url?: string }) => {
  try {
    // Create a DOM from the HTML
    const dom = new JSDOM(html, { url });
    
    // Use Readability to extract the main content
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (!article) {
      throw new Error('Failed to parse article content');
    }
    
    // Convert HTML content to clean text using Turndown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    });
    
    // Configure turndown to remove unwanted elements
    turndownService.remove(['script', 'style', 'nav', 'footer', 'aside']);
    
    const textContent = turndownService.turndown(article.content || '');
    
    return {
      success: true,
      content: textContent,
      title: article.title,
      byline: article.byline,
      excerpt: article.excerpt,
      length: textContent.length
    };
  } catch (error) {
    console.error('Error extracting main content:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      content: '',
      title: '',
      byline: '',
      excerpt: ''
    };
  }
};

export const createEmbeddingExecute = async ({ text, truncate }: { text: string; truncate: boolean }) => {
  try {
    // Truncate text if it's too long (max ~8000 tokens, roughly 32000 chars)
    const maxChars = 32000;
    const inputText = truncate && text.length > maxChars 
      ? text.substring(0, maxChars) + '...' 
      : text;
    
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: inputText
    });
    
    const embedding = response.data[0].embedding;
    
    return {
      success: true,
      embedding,
      dimensions: embedding.length,
      usage: response.usage
    };
  } catch (error) {
    console.error('Error creating embedding:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      embedding: null
    };
  }
};

export const upsertSupabaseExecute = async ({ story }: { 
  story: {
    external_id: string;
    source_id: number;
    title: string;
    url: string;
    author?: string;
    published_at?: string;
    summary?: string;
    content?: string;
    embedding?: number[];
    metadata?: Record<string, any>;
  }
}) => {
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    // Prepare the story data for insertion
    const storyData = {
      ...story,
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from(config.ingestion.storiesTable)
      .upsert(storyData, {
        onConflict: 'external_id,source_id',
        ignoreDuplicates: false // Update if exists
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    return {
      success: true,
      data,
      operation: data.created_at === data.updated_at ? 'insert' : 'update'
    };
  } catch (error) {
    console.error('Error upserting to Supabase:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: null
    };
  }
};

export const fetchActiveSourceSlugsExecute = async () => {
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    const { data, error } = await supabase
      .from(config.ingestion.feedSourcesTable)
      .select('id, slug, name, adapter_name')
      .eq('is_active', true)
      .order('priority', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    return {
      success: true,
      sources: data || [],
      count: data?.length || 0
    };
  } catch (error) {
    console.error('Error fetching active sources:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      sources: []
    };
  }
};

// Tool Definitions (for use with OpenAI Agents SDK)

/**
 * Tool to fetch and parse data from a specific adapter
 */
export const fetchAdapterData = tool({
  name: 'fetchAdapterData',
  description: 'Call adapter.fetchAndParse() for a given source slug',
  parameters: z.object({
    sourceSlug: z.string().describe('The slug identifier for the source adapter')
  }),
  execute: fetchAdapterDataExecute
});

/**
 * Tool to fetch full HTML content from a URL
 */
export const fetchURLContent = tool({
  name: 'fetchURLContent',
  description: 'Fetch full HTML content of a URL with timeout and error handling',
  parameters: z.object({
    url: z.string().url().describe('The URL to fetch content from')
  }),
  execute: fetchURLContentExecute
});

/**
 * Tool to extract main article content from HTML
 */
export const extractMainContent = tool({
  name: 'extractMainContent',
  description: 'Extract article text using Readability and convert to clean text',
  parameters: z.object({
    html: z.string().describe('The HTML content to parse'),
    url: z.string().url().optional().describe('The source URL for better parsing')
  }),
  execute: extractMainContentExecute
});

/**
 * Tool to generate embeddings via OpenAI
 */
export const createEmbedding = tool({
  name: 'createEmbedding',
  description: 'Generate a 1536-dim embedding via OpenAI text-embedding-3-small model',
  parameters: z.object({
    text: z.string().describe('The text to generate embeddings for'),
    truncate: z.boolean().describe('Whether to truncate text if too long')
  }),
  execute: createEmbeddingExecute
});

/**
 * Tool to upsert story records into Supabase
 */
export const upsertSupabase = tool({
  name: 'upsertSupabase',
  description: 'Upsert a story record into Supabase with conflict resolution',
  parameters: z.object({
    story: z.object({
      external_id: z.string(),
      source_id: z.number(),
      title: z.string(),
      url: z.string().url(),
      author: z.string().optional(),
      published_at: z.string().datetime().optional(),
      summary: z.string().optional(),
      content: z.string().optional(),
      embedding: z.array(z.number()).optional(),
      metadata: z.record(z.any()).optional()
    }).describe('The story object to upsert')
  }),
  execute: upsertSupabaseExecute
});

/**
 * Tool to fetch active source slugs from Supabase
 */
export const fetchActiveSourceSlugs = tool({
  name: 'fetchActiveSourceSlugs',
  description: 'Query Supabase sources table for active sources',
  parameters: z.object({}),
  execute: fetchActiveSourceSlugsExecute
}); 