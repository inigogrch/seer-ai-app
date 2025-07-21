/**
 * Ingestion Helper Functions
 * Pure functions that handle the core ingestion pipeline logic
 */

import { createClient } from '@supabase/supabase-js';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { openai } from '../../../src/utils/openaiClient';
import { loadEnvironmentConfig } from '../../../src/config/environment';
import { ParsedItem } from '../../../src/types/adapter';
import CryptoJS from 'crypto-js';
import path from 'path';

// Lazy-loaded config to avoid loading env vars at import time
let _config: ReturnType<typeof loadEnvironmentConfig> | null = null;
function getConfig() {
  if (!_config) {
    _config = loadEnvironmentConfig();
  }
  return _config;
}

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
  if (!getConfig().cache.enabled) return;
  
  try {
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    await supabase
      .from(getConfig().cache.metricsTable)
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
  if (!getConfig().cache.enabled) return null;
  
  try {
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
    const { data, error } = await supabase
      .from(getConfig().cache.cacheTable)
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
  if (!getConfig().cache.enabled) return;
  
  try {
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + getConfig().cache.ttlDays);
    
    await supabase
      .from(getConfig().cache.cacheTable)
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
  if (!getConfig().cache.enabled) return texts.map(() => null);
  
  try {
    const contentHashes = texts.map(generateContentHash);
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
    const { data, error } = await supabase
      .from(getConfig().cache.cacheTable)
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
  if (!getConfig().cache.enabled || texts.length !== embeddings.length) return;
  
  try {
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + getConfig().cache.ttlDays);
    
    const cacheEntries = texts.map((text, index) => ({
      content_hash: generateContentHash(text),
      input_text_preview: text.substring(0, 200),
      embedding: embeddings[index],
      model_name: modelName,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    }));
    
    await supabase
      .from(getConfig().cache.cacheTable)
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

export const fetchAdapterDataExecute = async ({ adapterName }: { adapterName: string }) => {
  try {
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
    // Get all active sources for this adapter to validate it exists and is active
    const { data: sources, error: sourcesError } = await supabase
      .from(getConfig().ingestion.feedSourcesTable)
      .select('id, slug, name, adapter_name')
      .eq('adapter_name', adapterName)
      .eq('is_active', true);
    
    if (sourcesError || !sources || sources.length === 0) {
      throw new Error(`No active sources found for adapter: ${adapterName}`);
    }
    
    // Dynamically import the adapter module
    // Use absolute path from project root to avoid path resolution issues
    const projectRoot = '/Users/benjogerochi/seer-ai-app';
    const adapterPath = path.join(projectRoot, 'src', 'adapters', adapterName);
    const adapter = await import(adapterPath);
    
    if (!adapter.fetchAndParse) {
      throw new Error(`Adapter ${adapterName} does not have fetchAndParse method`);
    }
    
    // Pass active source slugs to the adapter - it will handle internal conversion
    const sourceSlugs = sources.map(s => s.slug);
    const items = await adapter.fetchAndParse(sourceSlugs);
    
    // Validate that returned items have source_slug that matches our database
    const validSourceSlugs = new Set(sources.map(s => s.slug));
    const validatedItems = items.filter((item: ParsedItem) => {
      if (!validSourceSlugs.has(item.source_slug)) {
        console.warn(`[${adapterName}] Skipping item with unknown source_slug: ${item.source_slug}`);
        return false;
      }
      return true;
    });
    
    console.log(`Fetched ${validatedItems.length} items from ${adapterName} adapter (${sources.length} sources)`);
    
    return { success: true, items: validatedItems, adapterName, sourceCount: sources.length };
  } catch (error) {
    console.error(`Error fetching adapter data for ${adapterName}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error', 
      items: [] 
    };
  }
};

export const fetchURLContentExecute = async ({ url }: { url: string }) => {
  // Ensure fetch is available
  if (typeof fetch === 'undefined') {
    const nodeFetch = require('node-fetch');
    globalThis.fetch = nodeFetch;
  }

  const isOpenAI = url.includes('openai.com');
  
  // Enhanced headers for better bot protection bypass
  const getHeaders = () => {
    const baseHeaders = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    };

    if (isOpenAI) {
      return {
        ...baseHeaders,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
      };
    } else {
      return {
        ...baseHeaders,
        'User-Agent': 'Mozilla/5.0 (compatible; SeerAI/1.0; +https://seerai.app)'
      };
    }
  };

  const maxRetries = isOpenAI ? 3 : 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Add delay for OpenAI requests to be more respectful
      if (isOpenAI && attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout for OpenAI
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: getHeaders()
      });
      
      clearTimeout(timeout);
      
      if (!response) {
        throw new Error('No response from fetch');
      }
      
      if (!response.ok) {
        if (response.status === 403 && isOpenAI && attempt < maxRetries) {
          console.log(`[OpenAI Fetch] Got 403, retrying attempt ${attempt + 1}/${maxRetries}`);
          lastError = new Error(`HTTP error! status: ${response.status}`);
          continue;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const html = await response.text();
      
      if (attempt > 1) {
        console.log(`[OpenAI Fetch] Successfully fetched on attempt ${attempt}`);
      }
      
      return { success: true, html, contentLength: html.length };
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      if (attempt === maxRetries) {
        console.error(`Error fetching URL content from ${url} (attempt ${attempt}/${maxRetries}):`, error);
        break;
      }
    }
  }

  const errorMessage = lastError 
    ? (lastError.name === 'AbortError' ? 'Request timeout' : lastError.message)
    : 'Unknown error';
    
  return { 
    success: false, 
    error: errorMessage,
    html: null 
  };
};

/**
 * Custom content extractor for OpenAI articles
 */
function extractOpenAIContent(dom: any): { content: string; title: string } {
  const document = dom.window.document;
  
  // Extract title from various possible selectors
  let title = '';
  const titleSelectors = [
    'h1',
    '[data-testid="title"]',
    '.post-title',
    'title'
  ];
  
  for (const selector of titleSelectors) {
    const titleElement = document.querySelector(selector);
    if (titleElement && titleElement.textContent?.trim()) {
      title = titleElement.textContent.trim();
      break;
    }
  }
  
  // Extract main content from OpenAI's specific structure
  const contentParts: string[] = [];
  
  // Target the main content containers based on the actual HTML structure
  const contentSelectors = [
    // Primary selectors based on actual OpenAI article structure
    'div[class*="@md:col-span-6"][class*="@md:col-start-4"] p[class*="mb-sm"]',
    'div[class*="col-span-6"][class*="col-start-4"] p[class*="mb-sm"]',
    'div[class*="col-span-12"][class*="max-w-none"] p[class*="mb-sm"]',
    // More specific paragraph selectors
    'p[class*="mb-sm"][class*="last:mb-0"]',
    'p.mb-sm.last\\:mb-0',
    // Broader fallback selectors
    'div[class*="col-span-"] p',
    'main p[class*="mb-"]',
    '.post-content p',
    '.article-content p',
    // Generic content paragraphs
    'p[class*="mb-"]'
  ];
  
  for (const selector of contentSelectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      elements.forEach((element: any) => {
        const text = element.textContent?.trim();
        if (text && text.length > 20) { // Filter out very short text
          contentParts.push(text);
        }
      });
      break; // Use the first selector that finds content
    }
  }
  
  // If no specific selectors worked, try to extract from any paragraph
  if (contentParts.length === 0) {
    console.log('[OpenAI Extraction] No content found with specific selectors, trying generic paragraphs');
    const allParagraphs = document.querySelectorAll('p');
    allParagraphs.forEach((p: any) => {
      const text = p.textContent?.trim();
      if (text && text.length > 50) { // Only substantial paragraphs
        contentParts.push(text);
      }
    });
  }
  
  // Log extraction results
  console.log(`[OpenAI Extraction] Found ${contentParts.length} content parts, total length: ${contentParts.join('\n\n').length}`);
  
  return {
    content: contentParts.join('\n\n'),
    title: title
  };
}

export const extractMainContentExecute = async ({ html, url }: { html: string; url: string | null }) => {
  // Create a DOM from the HTML
  const dom = new JSDOM(html, { url: url || undefined });
  
  try {
    
    // Check if this is an OpenAI URL and use custom extraction
    if (url && url.includes('openai.com')) {
      console.log('Using OpenAI-specific content extraction for:', url);
      
      const openaiContent = extractOpenAIContent(dom);
      
      if (openaiContent.content && openaiContent.content.length > 100) {
        return {
          success: true,
          content: openaiContent.content,
          title: openaiContent.title,
          byline: null,
          excerpt: openaiContent.content.substring(0, 200) + '...',
          length: openaiContent.content.length
        };
      } else {
        console.log(`[OpenAI Extraction] Custom extraction yielded ${openaiContent.content.length} chars, trying Readability fallback`);
      }
    }
    
    // Fallback to generic Readability for other sites or if OpenAI extraction fails
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
    
    // Final safety net: try to extract any text content from the page
    try {
      const document = dom.window.document;
      const bodyText = document.body?.textContent?.trim() || '';
      
      if (bodyText.length > 100) {
        console.log(`[Extraction Fallback] Using body text as last resort (${bodyText.length} chars)`);
        return {
          success: true,
          content: bodyText.substring(0, 2000) + (bodyText.length > 2000 ? '...' : ''),
          title: document.title || '',
          byline: null,
          excerpt: bodyText.substring(0, 200) + '...',
          length: Math.min(bodyText.length, 2000)
        };
      }
    } catch (fallbackError) {
      console.error('Fallback extraction also failed:', fallbackError);
    }
    
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

    // MUCH more aggressive truncation - OpenAI embedding model has 8K token limit
    // 1 token ≈ 4 characters, but being extra conservative due to token density
    // Using 10K chars max to ensure we stay well under 8K tokens
    const maxChars = 10000; // Ultra-conservative limit to guarantee under 8K tokens
    const processedTexts = texts.map(text => {
      if (truncate && text.length > maxChars) {
        console.log(`Truncating text from ${text.length} to ${maxChars} chars to stay under token limit`);
        return text.substring(0, maxChars) + '...';
      }
      return text;
    });

    // Step 1: Check cache for existing embeddings
    let cachedEmbeddings: (number[] | null)[] = [];
    let cacheHits = 0;
    
    if (getConfig().cache.enabled) {
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
      if (getConfig().cache.enabled && newEmbeddings.length > 0) {
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
    // Ultra-conservative truncation to stay under token limits
    const maxChars = 10000; // Ultra-conservative limit for 8K token model
    const processedText = truncate && text.length > maxChars 
      ? text.substring(0, maxChars) + '...' 
      : text;
    
    if (truncate && text.length > maxChars) {
      console.log(`Single embedding: Truncating text from ${text.length} to ${maxChars} chars`);
    }
    
    // Check cache first
    if (getConfig().cache.enabled) {
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
    if (getConfig().cache.enabled) {
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
    story_category: string | null;
    tags: string[];
  }
}) => {
  try {
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
    // Prepare the story data for insertion - map metadata to original_metadata
    const { metadata, ...restStory } = story;
    const storyData = {
      ...restStory,
      original_metadata: metadata,
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from(getConfig().ingestion.storiesTable)
      .upsert(storyData)  // Supabase auto-detects unique constraints
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
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
    const { data, error } = await supabase
      .from(getConfig().ingestion.feedSourcesTable)
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
    if (!getConfig().cache.enabled) {
      return {
        success: true,
        cacheEnabled: false,
        message: 'Cache is disabled'
      };
    }
    
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
    // Get cache table statistics
    const { data: cacheData, error: cacheError } = await supabase
      .from(getConfig().cache.cacheTable)
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
        ttlDays: getConfig().cache.ttlDays,
        cacheTable: getConfig().cache.cacheTable,
        metricsTable: getConfig().cache.metricsTable
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
    if (!getConfig().cache.enabled) {
      return {
        success: false,
        message: 'Cache is disabled'
      };
    }
    
    const supabase = createClient(getConfig().supabase.url, getConfig().supabase.key);
    
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