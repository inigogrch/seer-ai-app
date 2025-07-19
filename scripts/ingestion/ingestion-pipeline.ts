/**
 * Main ingestion pipeline that coordinates the following workflow:
 * 1. Fetches active sources from Supabase
 * 2. For each source, fetches raw metadata via adapters
 * 3. Enriches items with full content when available
 * 4. Generates embeddings for semantic search
 * 5. Classifies content using LLM (categories and tags)
 * 6. Upserts stories into Supabase with full enrichment
 * 
 * This script processes all active sources and handles content enrichment,
 * embedding generation, and LLM-based classification in an efficient pipeline.
 */

import { OpenAI } from 'openai';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { 
  fetchAdapterData, 
  fetchURLContent, 
  extractMainContent, 
  createEmbedding, 
  upsertSupabase,
  fetchActiveSourceSlugs
} from './tools/ingestion-tools';
import {
  // Import execute functions for direct use
  fetchAdapterDataExecute,
  fetchURLContentExecute,
  extractMainContentExecute,
  createEmbeddingExecute,
  upsertSupabaseExecute,
  fetchActiveSourceSlugsExecute
} from './tools/ingestion-helpers';
import { loadEnvironmentConfig } from '../../src/config/environment';
import { logger } from '../../src/utils/logger';
import { createClient } from '@supabase/supabase-js';

// Types
import type { ParsedItem } from '../../src/types/adapter';

// Add interface for enriched items with classification
interface EnrichedItem extends ParsedItem {
  fullContent: string;
  embeddingText: string;
  story_category?: string;
  tags?: string[];
}

// Add interface for source data with proper typing
interface SourceData {
  id: number;
  slug: string;
  name: string;
  adapter_name: string;
}

interface StoryRecord {
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

interface IngestionStats {
  totalItems: number;
  successfulIngests: number;
  failedIngests: number;
  sourcesProcessed: number;
  startTime: number;
  endTime?: number;
  skippedItems: number;
}

interface ClassificationResult {
  external_id: string;
  category: string;
  tags: string[];
}

interface ClassifierConfig {
  modelName: string;
  maxTags: number;
  allowedCategories: string[];
  retryPolicy: { retries: number; backoffMs: number };
  batchSize: number;
  concurrency: number;
}

// Lazy-initialize OpenAI client for classification
let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const config = loadEnvironmentConfig();
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

// Default classifier configuration
const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  modelName: 'gpt-4o-mini',
  maxTags: 6,
  allowedCategories: ['news', 'tools', 'research', 'opinion', 'announcement'],
  retryPolicy: { retries: 3, backoffMs: 1000 },
  batchSize: 5,
  concurrency: 2
};

/**
 * Build a story record from parsed item and enriched content
 */
function buildStoryRecord(
  item: ParsedItem, 
  sourceId: number,
  content?: string, 
  embedding?: number[],
  classification?: { category: string; tags: string[] }
): StoryRecord {
  return {
    external_id: item.external_id,
    source_id: sourceId,
    title: item.title,
    url: item.url,
    author: item.author || null,
    published_at: item.published_at,
    summary: null, // Will be filled by SummarizerAgent later
    content: content || item.content || null,
    embedding: embedding || null,
    metadata: item.original_metadata || null,
    story_category: classification?.category || null,
    tags: classification?.tags || []
  };
}

/**
 * Classify a batch of items using OpenAI GPT-4o-mini
 */
async function classifyItemsBatch(
  items: EnrichedItem[],
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG
): Promise<Map<string, { category: string; tags: string[] }>> {
  if (items.length === 0) {
    return new Map();
  }

  logger.info(`🏷️  Starting classification for ${items.length} items using ${config.modelName}`);

  try {
    // Build prompt for classification
    const promptLines = items.map(
      (item) =>
        `- external_id: ${item.external_id}\n  title: ${item.title}\n  content: ${item.fullContent.slice(0, 500)}...`
    );

    const prompt = `For each story, generate:\n` +
      `1. story_category (one of: ${config.allowedCategories.join(', ')})\n` +
      `2. tags (up to ${config.maxTags} unique, fine-grained tags).\n` +
      `\nRespond with ONLY a valid JSON array of objects. Each object must have exactly these fields:\n` +
      `[{ "external_id": "story_id_here", "category": "category_here", "tags": ["tag1", "tag2"] }]\n\n` +
      `IMPORTANT: Your response must start with [ and end with ]. Include the external_id for each story.\n\n` +
      `Stories:\n` +
      promptLines.join('\n');

    // Log the prompt being sent to LLM (truncated for readability)
    logger.info('📝 LLM Classification Prompt:');
    logger.info(`   Model: ${config.modelName}`);
    logger.info(`   Categories: [${config.allowedCategories.join(', ')}]`);
    logger.info(`   Max tags: ${config.maxTags}`);
    logger.info(`   Items to classify: ${items.length}`);
    logger.debug('   Full prompt:', prompt.slice(0, 1000) + (prompt.length > 1000 ? '...' : ''));

    const startTime = Date.now();
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: config.modelName,
      messages: [
        { role: 'system', content: 'You are a classification assistant. Analyze content and provide accurate categorization and tagging.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.0
    });
    const duration = Date.now() - startTime;

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No content received from classification API');
    }

    // Log the raw LLM response
    logger.info(`⚡ LLM Response received in ${duration}ms`);
    logger.info('📄 Raw LLM Classification Response:');
    logger.info(content);

    let results: ClassificationResult[];
    try {
      results = JSON.parse(content);
    } catch (err) {
      logger.error('❌ Failed to parse classification response as JSON:', content);
      throw err;
    }

    // Log the parsed results
    logger.info(`✅ Successfully parsed ${results.length} classification results:`);
    results.forEach((result, index) => {
      logger.info(`   ${index + 1}. ID: ${result.external_id}`);
      logger.info(`      Category: ${result.category}`);
      logger.info(`      Tags: [${result.tags.join(', ')}]`);
    });

    // Convert results to a map for easy lookup
    const classificationMap = new Map<string, { category: string; tags: string[] }>();
    results.forEach(result => {
      classificationMap.set(result.external_id, {
        category: result.category,
        tags: result.tags
      });
    });

    logger.debug(`Successfully classified ${results.length} items`);
    return classificationMap;
  } catch (error) {
    logger.error('Failed to classify items batch:', error);
    // Return empty map to allow processing to continue without classification
    return new Map();
  }
}

/**
 * Utility function to chunk arrays
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Extract fallback content from original_metadata when direct content extraction fails
 */
function getFallbackContentFromMetadata(metadata: Record<string, any>): string | null {
  // Try different fallback content sources in order of preference
  
  // For OpenAI adapter - use RSS content stored in metadata
  if (metadata.rss_content && metadata.rss_content.length > 50) {
    return metadata.rss_content;
  }
  
  // Fallback to raw RSS item for older format
  if (metadata.raw_item) {
    const rawItem = metadata.raw_item;
    const rssContent = rawItem.content || rawItem.contentSnippet || rawItem.description;
    if (rssContent && rssContent.length > 50) {
      return rssContent;
    }
  }
  
  // For TLDR adapter - use summary
  if (metadata.summary && metadata.summary.length > 50) {
    return metadata.summary;
  }
  
  // For Anthropic adapter - use description
  if (metadata.anthropic_description && metadata.anthropic_description.length > 50) {
    return metadata.anthropic_description;
  }
  
  // Generic fallbacks for other adapters
  if (metadata.description && metadata.description.length > 50) {
    return metadata.description;
  }
  
  if (metadata.content && metadata.content.length > 50) {
    return metadata.content;
  }
  
  return null;
}

/**
 * Check which items already exist in the database to avoid reprocessing
 * This saves resources on content fetching and embedding generation
 */
async function filterExistingItems(
  items: ParsedItem[], 
  sourceId: number
): Promise<{ newItems: ParsedItem[]; existingCount: number }> {
  if (items.length === 0) {
    return { newItems: [], existingCount: 0 };
  }

  try {
    const config = loadEnvironmentConfig();
    const supabase = createClient(config.supabase.url, config.supabase.key);
    
    // Get list of external_ids that already exist for this source
    const externalIds = items.map(item => item.external_id);
    
    const { data: existingStories, error } = await supabase
      .from('stories')
      .select('external_id')
      .eq('source_id', sourceId)
      .in('external_id', externalIds);
    
    if (error) {
      logger.warn(`Failed to check existing stories for source ${sourceId}:`, error);
      // If check fails, proceed with all items to avoid data loss
      return { newItems: items, existingCount: 0 };
    }
    
    // Create set of existing external_ids for efficient lookup
    const existingExternalIds = new Set(
      existingStories?.map(story => story.external_id) || []
    );
    
    // Filter out items that already exist
    const newItems = items.filter(item => !existingExternalIds.has(item.external_id));
    const existingCount = items.length - newItems.length;
    
    if (existingCount > 0) {
      logger.info(`Filtered out ${existingCount} existing items, processing ${newItems.length} new items for source ${sourceId}`);
    }
    
    return { newItems, existingCount };
  } catch (error) {
    logger.error(`Error checking existing items for source ${sourceId}:`, error);
    // If check fails, proceed with all items to avoid data loss
    return { newItems: items, existingCount: 0 };
  }
}

/**
 * Filter out articles published in 2022 or earlier
 */
function filterByPublishDate(items: ParsedItem[]): { filteredItems: ParsedItem[]; oldItemsCount: number } {
  const cutoffDate = new Date('2023-01-01T00:00:00Z');
  
  const filteredItems = items.filter(item => {
    const publishDate = new Date(item.published_at);
    return publishDate >= cutoffDate;
  });
  
  const oldItemsCount = items.length - filteredItems.length;
  
  if (oldItemsCount > 0) {
    logger.info(`Filtered out ${oldItemsCount} articles from 2022 or earlier, keeping ${filteredItems.length} recent articles`);
  }
  
  return { filteredItems, oldItemsCount };
}

/**
 * Main ingestion workflow function
 */
export async function runIngestion() {
  const config = loadEnvironmentConfig();
  const limit = pLimit(config.ingestion.concurrencyLimit);
  
  // Define retry options
  const retryOptions = {
    retries: 3,
    factor: 2,
    minTimeout: 1000,
    maxTimeout: 5000
  };
  
  const stats: IngestionStats = {
    totalItems: 0,
    successfulIngests: 0,
    failedIngests: 0,
    sourcesProcessed: 0,
    startTime: Date.now(),
    skippedItems: 0
  };
  
  try {
    logger.info('Starting ingestion run');
    
    // Step 1: Fetch active sources
    const sourcesResult = await fetchActiveSourceSlugsExecute();
    
    if (!sourcesResult.success || sourcesResult.sources.length === 0) {
      logger.warn('No active sources found');
      return { 
        success: false, 
        message: 'No active sources to process',
        stats
      };
    }
    
    logger.info(`Found ${sourcesResult.sources.length} active sources`);
    
    // Group sources by adapter_name for efficient processing  
    const adapterGroups: Record<string, SourceData[]> = {};
    for (const source of sourcesResult.sources) {
      if (!adapterGroups[source.adapter_name]) {
        adapterGroups[source.adapter_name] = [];
      }
      adapterGroups[source.adapter_name].push(source);
    }

    // Create source slug to ID mapping for efficient lookups
    const sourceSlugToId = new Map<string, number>();
    sourcesResult.sources.forEach(source => {
      sourceSlugToId.set(source.slug, source.id);
    });

    logger.info(`Processing ${Object.keys(adapterGroups).length} adapters covering ${sourcesResult.sources.length} sources`);

    // Step 2: Process each adapter (which handles all its sources at once)
    for (const [adapterName, sources] of Object.entries(adapterGroups) as [string, SourceData[]][]) {
      try {
        logger.info(`Processing adapter: ${adapterName} (${sources.length} sources: ${sources.map(s => s.slug).join(', ')})`);
        
        // Fetch items from adapter (gets all sources for this adapter)
        const adapterResult = await fetchAdapterDataExecute({ 
          adapterName 
        });
        
        if (!adapterResult.success || !adapterResult.items) {
          logger.error(`Failed to fetch data from ${adapterName} adapter: ${adapterResult.error}`);
          // Don't increment failedIngests here - no items were processed
          continue;
        }
        
        const items = adapterResult.items as ParsedItem[];
        stats.totalItems += items.length;
        logger.info(`Fetched ${items.length} items from ${adapterName} adapter (${adapterResult.sourceCount} sources)`);
        
        // Group items by source_slug for batch processing
        const itemsBySource = items.reduce((acc, item) => {
          if (!acc[item.source_slug]) {
            acc[item.source_slug] = [];
          }
          acc[item.source_slug].push(item);
          return acc;
        }, {} as Record<string, ParsedItem[]>);

        // Process each source's items in batches
        for (const [sourceSlug, sourceItems] of Object.entries(itemsBySource)) {
          const sourceId = sourceSlugToId.get(sourceSlug);
          if (!sourceId) {
            logger.warn(`Unknown source slug: ${sourceSlug}, skipping ${sourceItems.length} items`);
            continue;
          }

          // Filter out existing items for this source
          const { newItems, existingCount } = await filterExistingItems(sourceItems, sourceId);
          stats.skippedItems += existingCount;

          // Filter out articles from 2022 or earlier
          const { filteredItems, oldItemsCount } = filterByPublishDate(newItems);
          stats.skippedItems += oldItemsCount;

          if (filteredItems.length === 0) {
            logger.info(`No recent items to process for source ${sourceSlug} (${existingCount} existing, ${oldItemsCount} too old)`);
            continue;
          }

          // Process items in batches for more efficient embedding generation
          const batchSize = config.ingestion.batchSize || 10;
          const batches = [];
          for (let i = 0; i < filteredItems.length; i += batchSize) {
            batches.push(filteredItems.slice(i, i + batchSize));
          }
          
          const results = await Promise.all(
            batches.map(batch => 
              limit(() => processItemsBatch(batch, sourceId, retryOptions))
            )
          );
          
          // Flatten results and count successes and failures
          const flatResults = results.flat();
          flatResults.forEach(result => {
            if (result.success) {
              stats.successfulIngests++;
            } else {
              stats.failedIngests++;
            }
          });
          
          // Add skipped items to stats for visibility
          const totalSkipped = existingCount + oldItemsCount;
          if (totalSkipped > 0) {
            logger.info(`Skipped ${totalSkipped} items for source ${sourceSlug} (${existingCount} existing, ${oldItemsCount} too old)`);
          }
        }
        
        stats.sourcesProcessed += sources.length;
      } catch (error) {
        logger.error(`Error processing adapter ${adapterName}:`, error);
      }
    }
    
    stats.endTime = Date.now();
    const duration = stats.endTime - stats.startTime;
    
    logger.info('Ingestion run completed', { 
      stats, 
      duration: `${duration}ms` 
    });
    
    return {
      success: true,
      stats,
      duration
    };
  } catch (error) {
    logger.error('Fatal error during ingestion:', error);
    stats.endTime = Date.now();
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stats
    };
  }
}

/**
 * Process multiple items in batch for more efficient embedding generation
 */
async function processItemsBatch(
  items: ParsedItem[],
  sourceId: number,
  retryOptions: any
): Promise<{ success: boolean; error?: string }[]> {
  if (!items.length) return [];

  try {
    return await pRetry(async () => {
      // Step 1: Fetch and extract content ONLY for items lacking sufficient content
      const itemsWithContent: EnrichedItem[] = await Promise.all(
        items.map(async (item): Promise<EnrichedItem> => {
          let fullContent = item.content || '';
          let extractedTitle = item.title;
          
          // Only fetch content if we don't have sufficient content already
          // Skip content enrichment for RSS-only sources
          // Note: TLDR provides individual article URLs that should be enriched, OpenAI has custom extraction
          const isRSSOnlySource = item.original_metadata?.raw_item && 
                                 !item.source_slug?.includes('openai') && 
                                 !item.source_slug?.includes('tldr');
          const needsContentEnrichment = !isRSSOnlySource && (!fullContent || fullContent.length < 200);
          
          if (needsContentEnrichment && item.url?.trim()) {
            logger.debug(`Enriching content for item with insufficient content: ${item.title} (current: ${fullContent.length} chars)`);
            
            let contentEnriched = false;
            const contentResult = await fetchURLContentExecute({ url: item.url });
            
            if (contentResult.success && contentResult.html) {
              const extractResult = await extractMainContentExecute({ 
                html: contentResult.html,
                url: item.url 
              });
              
              if (extractResult.success && extractResult.content) {
                const originalLength = fullContent.length;
                fullContent = extractResult.content;
                contentEnriched = true;
                logger.debug(`Enriched content from ${originalLength} to ${extractResult.content.length} chars`);
                
                // Use extracted title if original is missing or very short
                if ((!extractedTitle || extractedTitle.length < 10) && extractResult.title) {
                  extractedTitle = extractResult.title;
                }
              }
            }
            
            // If direct content extraction failed, try fallback to original metadata
            if (!contentEnriched && item.original_metadata) {
              const fallbackContent = getFallbackContentFromMetadata(item.original_metadata);
              if (fallbackContent && fallbackContent.length > 50) { // Only use if substantial
                fullContent = fallbackContent;
                logger.debug(`Using fallback content from metadata: ${fallbackContent.length} chars`);
              }
            }
          } else if (fullContent) {
            logger.debug(`Skipping content enrichment for item with sufficient content: ${item.title} (${fullContent.length} chars)`);
          } else {
            logger.warn(`No content available and no URL to fetch from: ${item.title}`);
          }
          
          return {
            ...item,
            title: extractedTitle,
            fullContent,
            embeddingText: `${extractedTitle}\n\n${fullContent}`
          };
        })
      );

      // Step 2: Generate embeddings in batch
      const textsForEmbedding = itemsWithContent.map(item => item.embeddingText);
      const embeddingResult = await createEmbeddingExecute({ 
        texts: textsForEmbedding,
        truncate: true 
      });

      if (!embeddingResult.success || !embeddingResult.embeddings) {
        throw new Error(embeddingResult.error || 'Failed to generate embeddings');
      }

      // Validate embedding array length matches items length for data safety
      if (embeddingResult.embeddings.length !== itemsWithContent.length) {
        throw new Error(`Embedding count mismatch: got ${embeddingResult.embeddings.length}, expected ${itemsWithContent.length}`);
      }

      // Step 3: Classify content using LLM
      logger.info(`🏷️  Step 3: Classifying ${itemsWithContent.length} items for intelligent categorization and tagging`);
      const classificationMap = await classifyItemsBatch(itemsWithContent);
      
      // Log classification coverage
      const classifiedCount = classificationMap.size;
      const unclassifiedCount = itemsWithContent.length - classifiedCount;
      logger.info(`📊 Classification Results: ${classifiedCount} classified, ${unclassifiedCount} unclassified`);
      
      // Step 4: Build and upsert stories with classification data
      logger.info(`💾 Step 4: Upserting ${itemsWithContent.length} enriched stories to Supabase`);
      const results = await Promise.all(
        itemsWithContent.map(async (item, index) => {
          try {
            const classification = classificationMap.get(item.external_id);
            const story = buildStoryRecord(
              item,
              sourceId,
              item.fullContent,
              embeddingResult.embeddings![index],
              classification
            );
            
            const upsertResult = await upsertSupabaseExecute({ story });
            
            if (upsertResult.success) {
              logger.info(`✅ Ingested: "${story.title.slice(0, 60)}..." | Category: ${story.story_category || 'none'} | Tags: [${story.tags.join(', ')}] | Content: ${story.content?.length || 0} chars`);
              return { success: true };
            } else {
              throw new Error(upsertResult.error || 'Upsert failed');
            }
          } catch (error) {
            logger.error(`❌ Failed to process item at index ${index}:`, error);
            return { 
              success: false, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            };
          }
        })
      );

      return results;
    }, retryOptions);
  } catch (error) {
    logger.error('Failed to process items batch:', error);
    // Return failure for all items
    return items.map(() => ({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }));
  }
}



/**
 * Cron handler for scheduled ingestion runs
 */
export async function ingestionCronHandler() {
  try {
    const result = await runIngestion();
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Ingestion completed',
        result
      })
    };
  } catch (error) {
    logger.error('Cron handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Ingestion failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
} 