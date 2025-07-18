/**
 * Environment configuration for the IngestionAgent
 * Loads and validates required environment variables
 */

export interface EnvironmentConfig {
  openai: {
    apiKey: string;
  };
  supabase: {
    url: string;
    key: string;
  };
  ingestion: {
    concurrencyLimit: number;
    feedSourcesTable: string;
    storiesTable: string;
    batchSize: number;
  };
  cache: {
    enabled: boolean;
    ttlDays: number;
    cacheTable: string;
    metricsTable: string;
  };
  logging: {
    level: string;
  };
}

/**
 * Load and validate environment configuration
 * @throws Error if required environment variables are missing
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
  // Support both Next.js naming convention and direct naming
  // For server-side operations (like ingestion), prefer SERVICE_ROLE_KEY to bypass RLS
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const requiredVars = [
    { name: 'OPENAI_API_KEY', value: openaiKey },
    { name: 'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)', value: supabaseUrl },
    { name: 'SUPABASE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)', value: supabaseKey }
  ];

  // Validate required environment variables
  const missing = requiredVars.filter(varObj => !varObj.value);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.map(v => v.name).join(', ')}`);
  }

  return {
    openai: {
      apiKey: openaiKey!
    },
    supabase: {
      url: supabaseUrl!,
      key: supabaseKey!
    },
    ingestion: {
      concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT || '4', 10),
      feedSourcesTable: process.env.FEED_SOURCES_TABLE || 'sources',
      storiesTable: process.env.STORIES_TABLE || 'stories',
      batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '10', 10)
    },
    cache: {
      enabled: process.env.EMBEDDING_CACHE_ENABLED !== 'false', // Default to enabled
      ttlDays: parseInt(process.env.EMBEDDING_CACHE_TTL_DAYS || '30', 10),
      cacheTable: process.env.EMBEDDING_CACHE_TABLE || 'embedding_cache',
      metricsTable: process.env.EMBEDDING_CACHE_METRICS_TABLE || 'embedding_cache_metrics'
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info'
    }
  };
} 