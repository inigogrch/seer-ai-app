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
  fetchActiveSourceSlugs,
  // Import execute functions for direct use
  fetchAdapterDataExecute,
  fetchURLContentExecute,
  extractMainContentExecute,
  createEmbeddingExecute,
  upsertSupabaseExecute,
  fetchActiveSourceSlugsExecute
} from './tools/ingestionTools';
import { loadEnvironmentConfig } from '../config/environment';
import { logger } from '../utils/logger';

// Types
interface ParsedItem {
  title: string;
  url: string;
  author?: string;
  published_at?: string;
  summary?: string;
  metadata?: Record<string, any>;
}

interface StoryRecord {
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
  // Generate external_id from URL (could also use a hash)
  const external_id = Buffer.from(item.url).toString('base64').slice(0, 50);
  
  return {
    external_id,
    source_id: sourceId,
    title: item.title,
    url: item.url,
    author: item.author,
    published_at: item.published_at,
    summary: item.summary,
    content: content || item.summary || '',
    embedding,
    metadata: item.metadata || {}
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
      let fullContent = item.summary || '';
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
        const embeddingResult = await createEmbeddingExecute({ 
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
    
    // Step 2: Process each source
    for (const source of sourcesResult.sources) {
      try {
        logger.info(`Processing source: ${source.name} (${source.slug})`);
        
        // Fetch items from adapter
        const adapterResult = await fetchAdapterDataExecute({ 
          sourceSlug: source.adapter_name || source.slug 
        });
        
        if (!adapterResult.success || !adapterResult.items) {
          logger.error(`Failed to fetch data from ${source.slug}: ${adapterResult.error}`);
          stats.failedIngests++;
          continue;
        }
        
        const items = adapterResult.items as ParsedItem[];
        stats.totalItems += items.length;
        logger.info(`Fetched ${items.length} items from ${source.slug}`);
        
        // Process items with concurrency control
        const results = await Promise.all(
          items.map(item => 
            limit(() => processItem(item, source.id, retryOptions))
          )
        );
        
        // Count successes and failures
        results.forEach(result => {
          if (result.success) {
            stats.successfulIngests++;
          } else {
            stats.failedIngests++;
          }
        });
        
        stats.sourcesProcessed++;
      } catch (error) {
        logger.error(`Error processing source ${source.slug}:`, error);
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