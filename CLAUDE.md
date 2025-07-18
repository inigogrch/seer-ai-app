# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Install dependencies:** `pnpm install`
- **Development server:** `pnpm run dev` (Next.js with Turbopack)
- **Build:** `pnpm run build`
- **Production server:** `pnpm start`
- **Run tests:** `pnpm test`
- **Test with coverage:** `pnpm test:coverage`
- **Watch tests:** `pnpm test:watch`
- **CI tests:** `pnpm test:ci`
- **Lint:** `pnpm run lint` (ESLint with Next.js config)
- **Type check:** `npx tsc --noEmit`

## Architecture Overview

This is **Seer-AI**, an agentic content ingestion and recommendation system built with Next.js, TypeScript, OpenAI Agents SDK, and Supabase.

### Core Agentic Workflow
The system follows a modular agentic architecture: **Ingest → Classify → Retrieve → Summarize → Feedback**

### Key Components

#### Agents (`src/agents/`)
- **`ingestionAgent.ts`** - Orchestrates feed ingestion with full content extraction and OpenAI embeddings
- **`classifierAgent.ts`** - Tags and classifies stories (semantic/LLM-based)
- **`retrievalAgent.ts`** - Handles SQL K-NN search and filtering for feed generation
- **`summarizerAgent.ts`** - Provides summaries and handles all chat/conversational flows

#### Adapters (`src/adapters/`)
Source-specific content fetchers that implement the `ParsedItem` interface:
- Each adapter exports `fetchAndParse(): Promise<ParsedItem[]>`
- Handles RSS, JSON APIs, and web scraping for different sources
- Examples: `openai.ts`, `anthropic.ts`, `arxiv.ts`, `techCrunch.ts`, etc.

#### Database Schema (Supabase)
- **`sources`** - Feed source definitions and metadata
- **`stories`** - Content with embeddings, using pgvector for semantic search  
- **`embedding_cache`** - Caches embeddings to reduce OpenAI API costs
- **`feedback`** - User feedback for future ML tuning

#### API Routes (`src/app/api/`)
- **`/api/feed`** - Returns personalized story feed via RetrievalAgent
- **`/api/chat`** - Streaming chat completions via SummarizerAgent
- **`/api/ingest`** - Triggers ingestion workflow
- **`/api/feedback`** - Captures user feedback

#### Utilities (`src/utils/`)
- **`openaiClient.ts`** - OpenAI SDK client with configuration
- **`supabaseClient.ts`** - Supabase client setup
- **`logger.ts`** - Structured logging utility

## Environment Variables

Required environment variables (see `.env.local`):
- `OPENAI_API_KEY` - OpenAI API key for embeddings and chat
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` - Supabase access key
- `NEXT_PUBLIC_SUPABASE_URL` - Public Supabase URL for client
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public anon key for client

Optional configuration:
- `CONCURRENCY_LIMIT` - Ingestion concurrency (default: 4)
- `EMBEDDING_BATCH_SIZE` - Batch size for embedding generation (default: 10)
- `EMBEDDING_CACHE_ENABLED` - Enable embedding cache (default: true)

## Code Conventions

### Path Mapping
TypeScript path aliases are configured:
- `@agents/*` → `src/agents/*`
- `@adapters/*` → `src/adapters/*`
- `@utils/*` → `src/utils/*`
- `@types/*` → `src/types/*`

### Testing
- Uses Jest with ts-jest preset
- Test files: `**/__tests__/**/*.test.ts` or `**/*.test.ts`
- Mocks available in `src/__tests__/__mocks__/`
- Setup file: `src/__tests__/setup.ts`
- Coverage threshold: 70% for branches, functions, lines, statements

### Agent Development
- Each agent is a modular TypeScript class using OpenAI Agents SDK
- Agents use the `@openai/agents` package with `run()` function
- Tools are defined in `src/agents/tools/` with both tool definitions and execute functions
- Rich error handling and logging throughout

### Adapter Development
- Follow `ParsedItem` interface from `src/types/adapter.ts`
- Handle deduplication, normalization, and error cases
- Use appropriate libraries: `rss-parser` for RSS, `cheerio` for web scraping
- Return empty array `[]` on errors to avoid blocking pipeline

## Database Migrations

Supabase migrations are in `supabase/migrations/` with numbered sequence:
1. `000-base_schema.sql` - Base schema setup
2. `001_enable_extensions.sql` - Enable pgvector and other extensions
3. `002_tables.sql` - Core table definitions
4. `003_indexes.sql` - Performance indexes including vector indexes
5. `004_views.sql` - Database views for queries
6. `005_update_schema_for_ingestion_agent.sql` - Ingestion agent updates
7. `006_seed_sources_data.sql` - Initial source data
8. `007_change_source_id_to_integer.sql` - Schema updates
9. `008_create_embedding_cache.sql` - Embedding cache tables

## Key Implementation Details

### Embedding Strategy
- Uses OpenAI's `text-embedding-3-small` model
- Content is enriched by fetching full article text when possible
- Embeddings cached in `embedding_cache` table to reduce API costs
- Batch processing for efficiency (configurable batch size)

### Content Enrichment Pipeline
1. Adapters fetch basic metadata from RSS/APIs
2. Ingestion agent extracts full content using URL fetching
3. Uses `@mozilla/readability` for content extraction
4. Fallback to original feed content if extraction fails

### Concurrency & Performance
- Configurable concurrency limits for ingestion
- Batch processing for embedding generation
- Deduplication checks to avoid reprocessing existing content
- Progress tracking and detailed logging

## Scripts & Testing

Test scripts in `scripts/` directory:
- `test-adapters.ts` - Test individual adapters
- `test-ingestion.ts` - Test full ingestion workflow
- `test-env.ts` - Validate environment configuration
- Various other test utilities for specific components