/**
 * OpenAI Agents SDK Tool Definitions
 * Lean wrappers that define the tool interface for the AI agent
 */

import { tool } from '@openai/agents';
import { z } from 'zod';
import {
  fetchAdapterDataExecute,
  fetchURLContentExecute,
  extractMainContentExecute,
  createEmbeddingExecute,
  upsertSupabaseExecute,
  fetchActiveSourceSlugsExecute
} from './ingestion-helpers';

/**
 * Tool to fetch and parse data from a specific adapter
 */
export const fetchAdapterData = tool({
  name: 'fetchAdapterData',
  description: 'Call adapter.fetchAndParse() for a given adapter, returns all sources for that adapter',
  parameters: z.object({
    adapterName: z.string().describe('The adapter name to call (e.g., "anthropic", "aws", "arxiv")')
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