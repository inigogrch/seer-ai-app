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
import { ParsedItem } from '../../types/adapter';
import { z } from 'zod';
import CryptoJS from 'crypto-js';

const config = loadEnvironmentConfig();

// Cache Helper Functions

/**
 * Generate deterministic hash for cache key
 */
function generateContentHash(text: string): string {
  // Normalize text: trim whitespace and convert to lowercase for consistent hashing
  const normalizedText = text.trim().toLowerCase();
  return CryptoJS.SHA256(normalizedText).toString();
}

/**
 * Record cache metrics for monitoring
 */
async function recordCacheMetric(eventType: 'hit' | 'miss' | 'store', modelName = 'text-embedding-3-small', metadata: Record<string, any> = {}) {
  if (!config.cache.enabled) return;
  
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    await supabase
      .from(config.cache.metricsTable)
      .insert({
        event_type: eventType,
        model_name: modelName,
        metadata,
        timestamp: new Date().toISOString()
      });
  } catch (error) {
    console.warn('Failed to record cache metric:', error);
    // Don't fail the embedding operation if metrics recording fails
  }
}

/**
 * Get cached embedding if available and not expired
 */
async function getCachedEmbedding(contentHash: string): Promise<number[] | null> {
  if (!config.cache.enabled) return null;
  
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    const { data, error } = await supabase
      .from(config.cache.cacheTable)
      .select('embedding')
      .eq('content_hash', contentHash)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (error || !data) {
      await recordCacheMetric('miss');
      return null;
    }
    
    // Update access statistics
    await supabase.rpc('update_cache_access', { cache_hash: contentHash });
    await recordCacheMetric('hit');
    
    return data.embedding;
  } catch (error) {
    console.warn('Cache lookup failed:', error);
    await recordCacheMetric('miss');
    return null;
  }
}

/**
 * Store embedding in cache with TTL
 */
async function storeCachedEmbedding(
  contentHash: string, 
  text: string, 
  embedding: number[], 
  modelName = 'text-embedding-3-small'
): Promise<void> {
  if (!config.cache.enabled) return;
  
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.cache.ttlDays);
    
    await supabase
      .from(config.cache.cacheTable)
      .upsert({
        content_hash: contentHash,
        input_text_preview: text.substring(0, 200),
        embedding,
        model_name: modelName,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString()
      }, {
        onConflict: 'content_hash'
      });
    
    await recordCacheMetric('store', modelName, { text_length: text.length });
  } catch (error) {
    console.warn('Failed to store embedding in cache:', error);
    // Don't fail the embedding operation if cache storage fails
  }
}

/**
 * Get cached embeddings for multiple texts (batch operation)
 */
async function getCachedEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!config.cache.enabled) return texts.map(() => null);
  
  try {
    const contentHashes = texts.map(generateContentHash);
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    const { data, error } = await supabase
      .from(config.cache.cacheTable)
      .select('content_hash, embedding')
      .in('content_hash', contentHashes)
      .gt('expires_at', new Date().toISOString());
    
    if (error) {
      console.warn('Batch cache lookup failed:', error);
      return texts.map(() => null);
    }
    
    // Create map of hash -> embedding
    const cacheMap = new Map<string, number[]>();
    (data || []).forEach(row => {
      cacheMap.set(row.content_hash, row.embedding);
    });
    
    // Update access statistics for cache hits
    if (data && data.length > 0) {
      const hitHashes = data.map(row => row.content_hash);
      await Promise.all(
        hitHashes.map(hash => 
          supabase.rpc('update_cache_access', { cache_hash: hash })
        )
      );
    }
    
    // Record metrics
    const hits = data?.length || 0;
    const misses = texts.length - hits;
    if (hits > 0) await recordCacheMetric('hit', 'text-embedding-3-small', { count: hits });
    if (misses > 0) await recordCacheMetric('miss', 'text-embedding-3-small', { count: misses });
    
    // Return embeddings in same order as input texts
    return contentHashes.map(hash => cacheMap.get(hash) || null);
  } catch (error) {
    console.warn('Batch cache lookup failed:', error);
    return texts.map(() => null);
  }
}

/**
 * Store multiple embeddings in cache (batch operation)
 */
async function storeCachedEmbeddingsBatch(
  texts: string[], 
  embeddings: number[][], 
  modelName = 'text-embedding-3-small'
): Promise<void> {
  if (!config.cache.enabled || texts.length !== embeddings.length) return;
  
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.cache.ttlDays);
    
    const cacheEntries = texts.map((text, index) => ({
      content_hash: generateContentHash(text),
      input_text_preview: text.substring(0, 200),
      embedding: embeddings[index],
      model_name: modelName,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    }));
    
    await supabase
      .from(config.cache.cacheTable)
      .upsert(cacheEntries, {
        onConflict: 'content_hash'
      });
    
    await recordCacheMetric('store', modelName, { 
      count: cacheEntries.length,
      total_text_length: texts.reduce((sum, text) => sum + text.length, 0)
    });
  } catch (error) {
    console.warn('Failed to store embeddings in cache:', error);
  }
}

// Execute Functions (exported for direct use)

export const fetchAdapterDataExecute = async ({ sourceSlug }: { sourceSlug: string }) => {
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    // First, get the source record to find the adapter_name
    const { data: sourceData, error: sourceError } = await supabase
      .from(config.ingestion.feedSourcesTable)
      .select('adapter_name, slug, endpoint_url')
      .eq('slug', sourceSlug)
      .eq('is_active', true)
      .single();
    
    if (sourceError || !sourceData) {
      throw new Error(`Source not found or inactive: ${sourceSlug}`);
    }
    
    // Dynamically import the adapter module using adapter_name
    const adapter = await import(`../../adapters/${sourceData.adapter_name}.js`);
    
    if (!adapter.fetchAndParse) {
      throw new Error(`Adapter ${sourceData.adapter_name} does not have fetchAndParse method`);
    }
    
    // Call the adapter with the specific slug
    // Handle different adapter interfaces:
    // - Some adapters take no params (techCrunch, ventureBeat)
    // - Some adapters take a single slug (arxiv, mit-research)
    // - Some adapters take an array of slugs (aws)
    let items;
    
    // Check adapter interface by examining the function signature
    const fetchAndParseStr = adapter.fetchAndParse.toString();
    if (fetchAndParseStr.includes('feedSlugs') || sourceData.adapter_name === 'aws') {
      // AWS-style: array of slugs
      items = await adapter.fetchAndParse([sourceSlug]);
    } else if (fetchAndParseStr.includes('feedSlug') || fetchAndParseStr.includes('slug')) {
      // arXiv-style: single slug
      items = await adapter.fetchAndParse(sourceSlug);
    } else {
      // TechCrunch-style: no parameters
      items = await adapter.fetchAndParse();
    }
    
    // Ensure all items have the correct source_slug from our database
    const validatedItems = items.map((item: ParsedItem) => ({
      ...item,
      source_slug: sourceSlug // Override with our database slug
    }));
    
    console.log(`Fetched ${validatedItems.length} items from ${sourceSlug} using adapter ${sourceData.adapter_name}`);
    
    return { success: true, items: validatedItems, adapterName: sourceData.adapter_name };
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

export const extractMainContentExecute = async ({ html, url }: { html: string; url: string | null }) => {
  try {
    // Create a DOM from the HTML
    const dom = new JSDOM(html, { url: url || undefined });
    
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

export const createEmbeddingExecute = async ({ texts, truncate }: { texts: string[]; truncate: boolean }) => {
  try {
    if (!texts || texts.length === 0) {
      throw new Error('No texts provided for embedding');
    }

    // Truncate texts if they're too long (max ~8000 tokens, roughly 32000 chars)
    const maxChars = 32000;
    const processedTexts = texts.map(text => {
      if (truncate && text.length > maxChars) {
        return text.substring(0, maxChars) + '...';
      }
      return text;
    });

    // Step 1: Check cache for existing embeddings
    let cachedEmbeddings: (number[] | null)[] = [];
    let cacheHits = 0;
    
    if (config.cache.enabled) {
      cachedEmbeddings = await getCachedEmbeddingsBatch(processedTexts);
      cacheHits = cachedEmbeddings.filter(embedding => embedding !== null).length;
      
      console.log(`Cache lookup: ${cacheHits}/${processedTexts.length} hits (${((cacheHits/processedTexts.length)*100).toFixed(1)}%)`);
    } else {
      cachedEmbeddings = texts.map(() => null);
    }
    
    // Step 2: Identify texts that need embeddings generated
    const textsToEmbed: string[] = [];
    const indexesToEmbed: number[] = [];
    
    processedTexts.forEach((text, index) => {
      if (cachedEmbeddings[index] === null) {
        textsToEmbed.push(text);
        indexesToEmbed.push(index);
      }
    });
    
    // Step 3: Generate embeddings for cache misses
    let newEmbeddings: number[][] = [];
    let apiUsage: any = null;
    
    if (textsToEmbed.length > 0) {
      console.log(`Generating ${textsToEmbed.length} new embeddings via OpenAI API`);
      
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: textsToEmbed
      });
      
      newEmbeddings = response.data.map(item => item.embedding);
      apiUsage = response.usage;
      
      // Step 4: Store new embeddings in cache
      if (config.cache.enabled && newEmbeddings.length > 0) {
        await storeCachedEmbeddingsBatch(textsToEmbed, newEmbeddings);
      }
    }
    
    // Step 5: Combine cached and new embeddings in original order
    const allEmbeddings: number[][] = new Array(processedTexts.length);
    
    // Fill in cached embeddings
    cachedEmbeddings.forEach((embedding, index) => {
      if (embedding !== null) {
        allEmbeddings[index] = embedding;
      }
    });
    
    // Fill in new embeddings
    indexesToEmbed.forEach((originalIndex, newIndex) => {
      allEmbeddings[originalIndex] = newEmbeddings[newIndex];
    });
    
    // Calculate combined usage (if any API calls were made)
    const totalUsage = apiUsage ? {
      ...apiUsage,
      cache_hits: cacheHits,
      cache_misses: textsToEmbed.length,
      cache_hit_rate: cacheHits / processedTexts.length
    } : {
      cache_hits: cacheHits,
      cache_misses: 0,
      cache_hit_rate: 1.0
    };
    
    return {
      success: true,
      embeddings: allEmbeddings,
      count: allEmbeddings.length,
      dimensions: allEmbeddings[0]?.length || 1536,
      usage: totalUsage,
      cacheStats: {
        hits: cacheHits,
        misses: textsToEmbed.length,
        hitRate: (cacheHits / processedTexts.length * 100).toFixed(1) + '%'
      }
    };
  } catch (error) {
    console.error('Error creating embeddings:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      embeddings: null
    };
  }
};

// Convenience function for single text embedding
export const createSingleEmbeddingExecute = async ({ text, truncate }: { text: string; truncate: boolean }) => {
  try {
    // Truncate text if needed
    const maxChars = 32000;
    const processedText = truncate && text.length > maxChars 
      ? text.substring(0, maxChars) + '...' 
      : text;
    
    // Check cache first
    if (config.cache.enabled) {
      const contentHash = generateContentHash(processedText);
      const cachedEmbedding = await getCachedEmbedding(contentHash);
      
      if (cachedEmbedding) {
        console.log('Single embedding cache hit');
        return {
          success: true,
          embedding: cachedEmbedding,
          dimensions: cachedEmbedding.length,
          usage: {
            cache_hits: 1,
            cache_misses: 0,
            cache_hit_rate: 1.0
          },
          cacheStats: {
            hit: true
          }
        };
      }
    }
    
    // Cache miss - generate new embedding
    console.log('Single embedding cache miss - generating new embedding');
    
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: processedText
    });
    
    const embedding = response.data[0].embedding;
    
    // Store in cache
    if (config.cache.enabled) {
      const contentHash = generateContentHash(processedText);
      await storeCachedEmbedding(contentHash, processedText, embedding);
    }
    
    return {
      success: true,
      embedding,
      dimensions: embedding.length,
      usage: {
        ...response.usage,
        cache_hits: 0,
        cache_misses: 1,
        cache_hit_rate: 0.0
      },
      cacheStats: {
        hit: false
      }
    };
  } catch (error) {
    console.error('Error creating single embedding:', error);
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
    author: string | null;
    published_at: string | null;
    summary: string | null;
    content: string | null;
    embedding: number[] | null;
    metadata: Record<string, any> | null;
  }
}) => {
  try {
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    // Prepare the story data for insertion - map metadata to original_metadata
    const { metadata, ...restStory } = story;
    const storyData = {
      ...restStory,
      original_metadata: metadata,
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

/**
 * Get embedding cache statistics and performance metrics
 */
export const getCacheStatsExecute = async () => {
  try {
    if (!config.cache.enabled) {
      return {
        success: true,
        cacheEnabled: false,
        message: 'Cache is disabled'
      };
    }
    
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    // Get cache table statistics
    const { data: cacheData, error: cacheError } = await supabase
      .from(config.cache.cacheTable)
      .select('id, created_at, expires_at, access_count, model_name')
      .order('created_at', { ascending: false });
    
    if (cacheError) {
      throw cacheError;
    }
    
    // Get metrics for last 24 hours
    const { data: metricsData, error: metricsError } = await supabase
      .from('embedding_cache_stats')
      .select('*');
    
    if (metricsError) {
      console.warn('Failed to fetch cache metrics:', metricsError);
    }
    
    // Calculate statistics
    const now = new Date();
    const totalEntries = cacheData?.length || 0;
    const expiredEntries = cacheData?.filter(entry => new Date(entry.expires_at) < now).length || 0;
    const activeEntries = totalEntries - expiredEntries;
    const totalAccessCount = cacheData?.reduce((sum, entry) => sum + (entry.access_count || 0), 0) || 0;
    const avgAccessCount = totalEntries > 0 ? totalAccessCount / totalEntries : 0;
    
    // Calculate cache efficiency
    const metrics = metricsData?.reduce((acc, metric) => {
      acc[metric.event_type] = metric.total_events || 0;
      return acc;
    }, {} as Record<string, number>) || {};
    
    const hits = metrics.hit || 0;
    const misses = metrics.miss || 0;
    const totalRequests = hits + misses;
    const hitRate = totalRequests > 0 ? (hits / totalRequests * 100).toFixed(2) + '%' : '0%';
    
    return {
      success: true,
      cacheEnabled: true,
      stats: {
        totalEntries,
        activeEntries,
        expiredEntries,
        totalAccessCount,
        avgAccessCount: parseFloat(avgAccessCount.toFixed(2)),
        hitRate,
        metrics: {
          hits,
          misses,
          totalRequests
        }
      },
      config: {
        ttlDays: config.cache.ttlDays,
        cacheTable: config.cache.cacheTable,
        metricsTable: config.cache.metricsTable
      }
    };
  } catch (error) {
    console.error('Error fetching cache statistics:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * Clean up expired cache entries manually
 */
export const cleanupCacheExecute = async () => {
  try {
    if (!config.cache.enabled) {
      return {
        success: false,
        message: 'Cache is disabled'
      };
    }
    
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    const { data, error } = await supabase.rpc('cleanup_expired_embeddings');
    
    if (error) {
      throw error;
    }
    
    return {
      success: true,
      deletedCount: data || 0,
      message: `Cleaned up ${data || 0} expired cache entries`
    };
  } catch (error) {
    console.error('Error cleaning up cache:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
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
    url: z.string().url().nullable().describe('The source URL for better parsing')
  }),
  execute: extractMainContentExecute
});

/**
 * Tool to generate embeddings via OpenAI
 */
export const createEmbedding = tool({
  name: 'createEmbedding',
  description: 'Generate 1536-dim embeddings via OpenAI text-embedding-3-small model for batch of texts',
  parameters: z.object({
    texts: z.array(z.string()).describe('Array of texts to generate embeddings for'),
    truncate: z.boolean().describe('Whether to truncate texts if too long')
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
      author: z.string().nullable(),
      published_at: z.string().nullable(), // Made nullable to match updated schema
      summary: z.string().nullable(),
      content: z.string().nullable(), // Made nullable to match updated schema
      embedding: z.array(z.number()).nullable(),
      metadata: z.record(z.any()).nullable()
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