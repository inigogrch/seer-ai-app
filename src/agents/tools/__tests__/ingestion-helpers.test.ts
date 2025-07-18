/**
 * Smoke tests for ingestion helper functions
 * Tests each helper function in isolation without SDK wrapper overhead
 */

// Mock problematic imports
jest.mock('../../../config/environment', () => ({
  loadEnvironmentConfig: () => ({
    openai: { apiKey: 'test-key' },
    supabase: { url: 'test-url', key: 'test-key' },
    ingestion: {
      concurrencyLimit: 4,
      feedSourcesTable: 'sources',
      storiesTable: 'stories',
      batchSize: 10
    },
    cache: {
      enabled: false, // Simplified for smoke tests
      ttlDays: 30,
      cacheTable: 'embedding_cache',
      metricsTable: 'embedding_cache_metrics'
    },
    logging: { level: 'error' }
  })
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => Promise.resolve({
            data: [{ id: 1, slug: 'test', name: 'Test Source', adapter_name: 'test' }],
            error: null
          }))
        }))
      })),
      upsert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({
            data: { id: 1, created_at: '2024-01-01', updated_at: '2024-01-01' },
            error: null
          }))
        }))
      }))
    }))
  }))
}));

jest.mock('../../../utils/openaiClient', () => ({
  openai: {
    embeddings: {
      create: jest.fn(() => Promise.resolve({
        data: [{ embedding: new Array(1536).fill(0.1) }],
        usage: { prompt_tokens: 10, total_tokens: 10 }
      }))
    }
  }
}));

import {
  fetchActiveSourceSlugsExecute,
  fetchAdapterDataExecute,
  fetchURLContentExecute,
  extractMainContentExecute,
  createEmbeddingExecute,
  createSingleEmbeddingExecute,
  upsertSupabaseExecute,
  getCacheStatsExecute,
  cleanupCacheExecute
} from '../ingestion-helpers';

describe('Ingestion Helpers Smoke Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchActiveSourceSlugsExecute', () => {
    it('should execute without errors', async () => {
      const result = await fetchActiveSourceSlugsExecute();
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('count');
      expect(result.success).toBe(true);
    });
  });

  describe('fetchAdapterDataExecute', () => {
    it('should handle missing adapter gracefully', async () => {
      const result = await fetchAdapterDataExecute({ sourceSlug: 'nonexistent' });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('error');
      // Should return structured error response
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe('fetchURLContentExecute', () => {
    it('should handle valid URL structure', async () => {
      // Mock successful fetch
      (global.fetch as any) = jest.fn(() => Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<html><body>Test</body></html>')
      }));

      const result = await fetchURLContentExecute({ url: 'https://example.com' });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('html');
      expect(result).toHaveProperty('contentLength');
    });

    it('should handle invalid URLs gracefully', async () => {
      (global.fetch as any) = jest.fn(() => Promise.reject(new Error('Invalid URL')));

      const result = await fetchURLContentExecute({ url: 'invalid-url' });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
      expect(result.success).toBe(false);
    });
  });

  describe('extractMainContentExecute', () => {
    it('should process valid HTML', async () => {
      const html = '<html><body><h1>Title</h1><p>Content</p></body></html>';
      
      const result = await extractMainContentExecute({ html, url: 'https://example.com' });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('length');
    });

    it('should handle empty/invalid HTML', async () => {
      const result = await extractMainContentExecute({ html: '', url: null });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('content');
      // Should not crash on empty input
    });
  });

  describe('createEmbeddingExecute', () => {
    it('should handle valid text arrays', async () => {
      const result = await createEmbeddingExecute({ 
        texts: ['Test text 1', 'Test text 2'], 
        truncate: true 
      });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('embeddings');
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('dimensions');
    });

    it('should handle empty text arrays', async () => {
      const result = await createEmbeddingExecute({ 
        texts: [], 
        truncate: true 
      });
      
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false);
      expect(result).toHaveProperty('error');
    });
  });

  describe('createSingleEmbeddingExecute', () => {
    it('should handle single text input', async () => {
      const result = await createSingleEmbeddingExecute({ 
        text: 'Test text', 
        truncate: true 
      });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('embedding');
      expect(result).toHaveProperty('dimensions');
    });

    it('should handle very long text with truncation', async () => {
      const longText = 'a'.repeat(50000);
      
      const result = await createSingleEmbeddingExecute({ 
        text: longText, 
        truncate: true 
      });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('embedding');
    });
  });

  describe('upsertSupabaseExecute', () => {
    it('should handle valid story objects', async () => {
      const story = {
        external_id: 'test-123',
        source_id: 1,
        title: 'Test Story',
        url: 'https://example.com',
        author: 'Test Author',
        published_at: '2024-01-01T00:00:00Z',
        summary: 'Test summary',
        content: 'Test content',
        embedding: new Array(1536).fill(0.1),
        metadata: { source: 'test' }
      };

      const result = await upsertSupabaseExecute({ story });
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('operation');
    });
  });

  describe('getCacheStatsExecute', () => {
    it('should handle cache disabled scenario', async () => {
      const result = await getCacheStatsExecute();
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('cacheEnabled');
      // Should work even when cache is disabled
      expect(result.success).toBe(true);
    });
  });

  describe('cleanupCacheExecute', () => {
    it('should handle cache cleanup gracefully', async () => {
      const result = await cleanupCacheExecute();
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      // Should handle disabled cache scenario
    });
  });
}); 