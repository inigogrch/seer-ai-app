# IngestionAgent Implementation

This directory contains the implementation of the IngestionAgent using the OpenAI Agents SDK.

## Overview

The IngestionAgent orchestrates the data ingestion pipeline for Seer AI. It:

1. Fetches active sources from the database
2. For each source, fetches raw metadata via adapters
3. Enriches items with full article content when available
4. Generates embeddings for semantic search
5. Upserts stories into Supabase

## Architecture

### Core Components

- **ingestionAgent.ts** - Main agent implementation with workflow orchestration
- **tools/ingestionTools.ts** - Individual tools that the agent can use

### Tools

1. **fetchActiveSourceSlugs** - Queries Supabase for active sources
2. **fetchAdapterData** - Calls adapter.fetchAndParse() for a given source
3. **fetchURLContent** - Fetches full HTML content with timeout handling
4. **extractMainContent** - Extracts article text using Readability
5. **createEmbedding** - Generates embeddings via OpenAI
6. **upsertSupabase** - Stores stories in the database

## Usage

### Direct Execution

```typescript
import { runIngestion } from '@/agents/ingestionAgent';

// Run the ingestion workflow
const result = await runIngestion();
console.log(result.stats);
```

### Using the Agent with OpenAI SDK

```typescript
import { runIngestionWithAgent } from '@/agents/ingestionAgent';

// Run using the agent interface
const result = await runIngestionWithAgent();
```

### Cron Endpoint

The agent is exposed via an API endpoint for scheduled execution:

```
GET/POST /api/ingest
```

## Configuration

Set these environment variables:

```env
# Required
OPENAI_API_KEY=your-key
SUPABASE_URL=your-url
SUPABASE_KEY=your-key

# Optional
CONCURRENCY_LIMIT=4
FEED_SOURCES_TABLE=sources
STORIES_TABLE=stories
EMBEDDING_BATCH_SIZE=10
LOG_LEVEL=info
CRON_SECRET=your-secret
```

## Performance Optimizations

- **Batch Embedding Generation**: Items are processed in batches (default: 10) to reduce OpenAI API calls from N (one per item) to N/batchSize
- **Concurrent Processing**: Multiple batches can be processed concurrently (respecting rate limits)
- **Efficient Content Extraction**: HTML parsing and content extraction is done in parallel

## Error Handling

- **Retry Logic**: Failed operations are retried up to 3 times with exponential backoff
- **Concurrency Control**: Limited to 4 parallel operations by default
- **Timeout Protection**: HTTP requests timeout after 10 seconds
- **Graceful Degradation**: If full content fetch fails, falls back to summary
- **Batch Error Isolation**: If a batch fails, only that batch is retried, not individual items

## Testing

Run the test suite:

```bash
npm test                 # Run tests in watch mode
npm run test:run        # Run tests once
npm run test:coverage   # Generate coverage report
```

## Monitoring

The agent logs important events at various levels:

- **INFO**: High-level progress (sources found, processing started/completed)
- **DEBUG**: Individual item processing success
- **ERROR**: Failures with stack traces
- **WARN**: Non-critical issues (no sources found)

## TODOs

- [ ] Integrate with external logging service (Logflare/Datadog)
- [ ] Add metrics collection for monitoring
- [ ] Implement source-specific rate limiting
- [ ] Add webhook notifications for failures
- [ ] Create dashboard for ingestion statistics 