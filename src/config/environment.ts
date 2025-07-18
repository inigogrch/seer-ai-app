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
  const requiredVars = [
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_KEY'
  ];

  // Validate required environment variables
  const missing = requiredVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    openai: {
      apiKey: process.env.OPENAI_API_KEY!
    },
    supabase: {
      url: process.env.SUPABASE_URL!,
      key: process.env.SUPABASE_KEY!
    },
    ingestion: {
      concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT || '4', 10),
      feedSourcesTable: process.env.FEED_SOURCES_TABLE || 'sources',
      storiesTable: process.env.STORIES_TABLE || 'stories'
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info'
    }
  };
} 