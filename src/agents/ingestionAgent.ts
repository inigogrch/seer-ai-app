/**
 * IngestionAgent - Orchestrates feed ingestion pipeline
 * 
 * This agent coordinates the following workflow:
 * 1. Fetches active sources from Supabase
 * 2. For each source, fetches raw metadata via adapters
 * 3. Enriches items with full content when available
 * 4. Generates embeddings for semantic search
 * 5. Upserts stories into Supabase
 */

import { Agent, run } from '@openai/agents';
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
  createSingleEmbeddingExecute,
  upsertSupabaseExecute,
  fetchActiveSourceSlugsExecute
} from './tools/ingestion-helpers';
import { loadEnvironmentConfig } from '../config/environment';
import { logger } from '../utils/logger';

// Types
import type { ParsedItem } from '../types/adapter';

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
}

interface IngestionStats {
  totalItems: number;
  successfulIngests: number;
  failedIngests: number;
  sourcesProcessed: number;
  startTime: number;
  endTime?: number;
}

/**
 * Build a story record from parsed item and enriched content
 */
function buildStoryRecord(
  item: ParsedItem, 
  sourceId: number,
  content?: string, 
  embedding?: number[]
): StoryRecord {
  return {
    external_id: item.external_id,
    source_id: sourceId,
    title: item.title,
    url: item.url,
    author: item.author || null,
    published_at: item.published_at,
    summary: null, // Will be filled by SummarizerAgent later
    content: content || item.content || null, // Full content from URL extraction or fallback to adapter content
    embedding: embedding || null,
    metadata: item.original_metadata || null
  };
}

/**
 * Create the IngestionAgent with tools and workflow
 */
export const ingestionAgent = new Agent({
  name: 'IngestionAgent',
  instructions: `You are an ingestion agent that orchestrates data collection from various sources.

Your task is to process all active sources and ingest their content. For each source:
1. Fetch items using the appropriate adapter
2. For each item, try to fetch and extract full content
3. Generate embeddings for semantic search
4. Store the results in the database

Use the provided tools to accomplish these tasks. Be systematic and handle errors gracefully.
Report progress and statistics after completion.`,
  
  tools: [
    fetchActiveSourceSlugs,
    fetchAdapterData,
    fetchURLContent,
    extractMainContent,
    createEmbedding,
    upsertSupabase
  ]
});

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
      // Step 1: Fetch and extract content for all items
      const itemsWithContent = await Promise.all(
        items.map(async (item) => {
          let fullContent = item.content || '';
          let extractedTitle = item.title;
          
          if (item.url) {
            const contentResult = await fetchURLContentExecute({ url: item.url });
            
            if (contentResult.success && contentResult.html) {
              const extractResult = await extractMainContentExecute({ 
                html: contentResult.html,
                url: item.url 
              });
              
              if (extractResult.success && extractResult.content) {
                fullContent = extractResult.content;
                if (!extractedTitle && extractResult.title) {
                  extractedTitle = extractResult.title;
                }
              }
            }
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

      // Step 3: Build and upsert stories
      const results = await Promise.all(
        itemsWithContent.map(async (item, index) => {
          try {
            const story = buildStoryRecord(
              item,
              sourceId,
              item.fullContent,
              embeddingResult.embeddings![index]
            );
            
            const upsertResult = await upsertSupabaseExecute({ story });
            
            if (upsertResult.success) {
              logger.debug(`Successfully ingested: ${story.title}`);
              return { success: true };
            } else {
              throw new Error(upsertResult.error || 'Upsert failed');
            }
          } catch (error) {
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
 * Process a single item from a source
 */
async function processItem(
  item: ParsedItem,
  sourceId: number,
  retryOptions: any
): Promise<{ success: boolean; error?: string }> {
  try {
    return await pRetry(async () => {
      // Step 1: Try to fetch full content
      let fullContent = item.content || '';
      let extractedTitle = item.title;
      
      if (item.url) {
        const contentResult = await fetchURLContentExecute({ url: item.url });
        
        if (contentResult.success && contentResult.html) {
          // Extract main content
          const extractResult = await extractMainContentExecute({ 
            html: contentResult.html,
            url: item.url 
          });
          
          if (extractResult.success && extractResult.content) {
            fullContent = extractResult.content;
            // Use extracted title if original is missing
            if (!extractedTitle && extractResult.title) {
              extractedTitle = extractResult.title;
            }
          }
        }
      }
      
      // Step 2: Generate embedding
      let embedding: number[] | undefined;
      if (fullContent) {
        const embeddingResult = await createSingleEmbeddingExecute({ 
          text: `${extractedTitle}\n\n${fullContent}`,
          truncate: true 
        });
        
        if (embeddingResult.success && embeddingResult.embedding) {
          embedding = embeddingResult.embedding;
        }
      }
      
      // Step 3: Build and upsert story
      const story = buildStoryRecord(
        { ...item, title: extractedTitle },
        sourceId,
        fullContent,
        embedding
      );
      
      const upsertResult = await upsertSupabaseExecute({ story });
      
      if (upsertResult.success) {
        logger.debug(`Successfully ingested: ${story.title}`);
        return { success: true };
      } else {
        throw new Error(upsertResult.error || 'Upsert failed');
      }
    }, retryOptions);
  } catch (error) {
    logger.error(`Failed to ingest item ${item.url}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
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
    startTime: Date.now()
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
    const adapterGroups = sourcesResult.sources.reduce((acc, source) => {
      if (!acc[source.adapter_name]) {
        acc[source.adapter_name] = [];
      }
      acc[source.adapter_name].push(source);
      return acc;
    }, {} as Record<string, Array<{ id: any; slug: any; name: any; adapter_name: any }>>);

    // Create source slug to ID mapping for efficient lookups
    const sourceSlugToId = new Map<string, number>();
    sourcesResult.sources.forEach(source => {
      sourceSlugToId.set(source.slug, source.id);
    });

    logger.info(`Processing ${Object.keys(adapterGroups).length} adapters covering ${sourcesResult.sources.length} sources`);

    // Step 2: Process each adapter (which handles all its sources at once)
    for (const [adapterName, sources] of Object.entries(adapterGroups)) {
      try {
        logger.info(`Processing adapter: ${adapterName} (${sources.length} sources: ${sources.map(s => s.slug).join(', ')})`);
        
        // Fetch items from adapter (gets all sources for this adapter)
        const adapterResult = await fetchAdapterDataExecute({ 
          adapterName 
        });
        
        if (!adapterResult.success || !adapterResult.items) {
          logger.error(`Failed to fetch data from ${adapterName} adapter: ${adapterResult.error}`);
          stats.failedIngests++;
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

          // Process items in batches for more efficient embedding generation
          const batchSize = config.ingestion.batchSize || 10;
          const batches = [];
          for (let i = 0; i < sourceItems.length; i += batchSize) {
            batches.push(sourceItems.slice(i, i + batchSize));
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
 * Run the ingestion agent with OpenAI Agents SDK
 * This function demonstrates how to use the agent with the SDK's run function
 */
export async function runIngestionWithAgent() {
  try {
    const result = await run(
      ingestionAgent,
      `Please start the ingestion process for all active sources. 
      Fetch data from each source, enrich it with full content where possible, 
      generate embeddings, and store everything in the database. 
      Report back with statistics when complete.`
    );
    
    logger.info('Agent execution completed', { result });
    return result;
  } catch (error) {
    logger.error('Agent execution failed:', error);
    throw error;
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