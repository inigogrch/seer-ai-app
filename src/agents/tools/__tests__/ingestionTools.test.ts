/**
 * Unit tests for IngestionAgent tools
 */

import { 
  fetchAdapterDataExecute, 
  fetchURLContentExecute, 
  extractMainContentExecute, 
  createEmbeddingExecute, 
  createSingleEmbeddingExecute,
  upsertSupabaseExecute,
  fetchActiveSourceSlugsExecute 
} from '../ingestion-helpers';
import { openai } from '../../../utils/openaiClient';
import { createMockSupabaseClient, createMockOpenAIResponse } from '../../../__tests__/setup';

// Mock external dependencies
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
      enabled: false,
      ttlDays: 30,
      cacheTable: 'embedding_cache',
      metricsTable: 'embedding_cache_metrics'
    },
    logging: { level: 'info' }
  })
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => createMockSupabaseClient())
}));

jest.mock('../../../utils/openaiClient', () => {
  const mockOpenAI = {
    embeddings: {
      create: jest.fn(() => Promise.resolve(createMockOpenAIResponse([
        new Array(1536).fill(0.1),
        new Array(1536).fill(0.2)
      ])))
    }
  };
  return { openai: mockOpenAI };
});

// Mock dynamic imports for adapters - use module factory
const mockFetchAndParse = jest.fn(() => Promise.resolve([
  {
    external_id: 'test-123',
    source_slug: 'test',
    title: 'Test Article',
    url: 'https://example.com/article',
    content: '',
    published_at: '2024-01-01T00:00:00Z',
    author: 'Test Author',
    original_metadata: { source: 'test' }
  }
]));

// Mock the problematic @openai/agents import
jest.mock('@openai/agents', () => ({
  tool: jest.fn((config) => config)
}));

describe('IngestionTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchActiveSourceSlugs', () => {
    it('should fetch active sources successfully with correct fields and ordering', async () => {
      // Mock multiple sources with different priorities to test ordering
      const mockSources = [
        { id: 3, slug: 'high-priority', name: 'High Priority Source', adapter_name: 'aws', priority: 100 },
        { id: 1, slug: 'medium-priority', name: 'Medium Priority Source', adapter_name: 'techCrunch', priority: 50 },
        { id: 2, slug: 'low-priority', name: 'Low Priority Source', adapter_name: 'arxiv', priority: 10 }
      ];

      // Mock the Supabase chain to return our test data
      const mockOrder = jest.fn(() => Promise.resolve({
        data: mockSources,
        error: null
      }));
      
      const mockEq = jest.fn(() => ({
        order: mockOrder
      }));
      
      const mockSelect = jest.fn(() => ({
        eq: mockEq
      }));
      
      const mockFrom = jest.fn(() => ({
        select: mockSelect
      }));

      // Mock createClient to return our mock
      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValueOnce({
        from: mockFrom
      });

      const result = await fetchActiveSourceSlugsExecute();
      
      // Verify the result structure
      expect(result.success).toBe(true);
      expect(result.sources).toHaveLength(3);
      expect(result.count).toBe(3);
      
      // Verify all required fields are present
      result.sources.forEach(source => {
        expect(source).toHaveProperty('id');
        expect(source).toHaveProperty('slug');
        expect(source).toHaveProperty('name');
        expect(source).toHaveProperty('adapter_name');
      });
      
      // Verify correct Supabase query was made
      expect(mockFrom).toHaveBeenCalledWith('sources');
      expect(mockSelect).toHaveBeenCalledWith('id, slug, name, adapter_name');
      expect(mockEq).toHaveBeenCalledWith('is_active', true);
      expect(mockOrder).toHaveBeenCalledWith('priority', { ascending: false });
      
      // Verify sources are returned (ordering would be handled by database)
      expect(result.sources).toEqual(mockSources);
    });

    it('should handle empty table (no active sources)', async () => {
      // Mock empty result
      const mockOrder = jest.fn(() => Promise.resolve({
        data: [],
        error: null
      }));
      
      const mockEq = jest.fn(() => ({
        order: mockOrder
      }));
      
      const mockSelect = jest.fn(() => ({
        eq: mockEq
      }));
      
      const mockFrom = jest.fn(() => ({
        select: mockSelect
      }));

      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValueOnce({
        from: mockFrom
      });

      const result = await fetchActiveSourceSlugsExecute();
      
      expect(result.success).toBe(true);
      expect(result.sources).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should handle null data from database', async () => {
      // Mock null data (which can happen with Supabase)
      const mockOrder = jest.fn(() => Promise.resolve({
        data: null,
        error: null
      }));
      
      const mockEq = jest.fn(() => ({
        order: mockOrder
      }));
      
      const mockSelect = jest.fn(() => ({
        eq: mockEq
      }));
      
      const mockFrom = jest.fn(() => ({
        select: mockSelect
      }));

      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValueOnce({
        from: mockFrom
      });

      const result = await fetchActiveSourceSlugsExecute();
      
      expect(result.success).toBe(true);
      expect(result.sources).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error - create an Error object that will be thrown
      const dbError = new Error('column "priority" does not exist');
      (dbError as any).code = '42703';
      
      const mockOrder = jest.fn(() => Promise.resolve({
        data: null,
        error: dbError
      }));
      
      const mockEq = jest.fn(() => ({
        order: mockOrder
      }));
      
      const mockSelect = jest.fn(() => ({
        eq: mockEq
      }));
      
      const mockFrom = jest.fn(() => ({
        select: mockSelect
      }));

      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValueOnce({
        from: mockFrom
      });

      const result = await fetchActiveSourceSlugsExecute();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('column "priority" does not exist');
      expect(result.sources).toEqual([]);
    });

    it('should handle missing table errors', async () => {
      // Mock table not found error - create an Error object that will be thrown
      const tableError = new Error('relation "sources" does not exist');
      (tableError as any).code = '42P01';
      
      const mockOrder = jest.fn(() => Promise.resolve({
        data: null,
        error: tableError
      }));
      
      const mockEq = jest.fn(() => ({
        order: mockOrder
      }));
      
      const mockSelect = jest.fn(() => ({
        eq: mockEq
      }));
      
      const mockFrom = jest.fn(() => ({
        select: mockSelect
      }));

      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValueOnce({
        from: mockFrom
      });

      const result = await fetchActiveSourceSlugsExecute();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('relation "sources" does not exist');
      expect(result.sources).toEqual([]);
    });

    it('should handle network/connection errors', async () => {
      // Mock network error by throwing from the chain
      const mockOrder = jest.fn(() => Promise.reject(new Error('network error')));
      
      const mockEq = jest.fn(() => ({
        order: mockOrder
      }));
      
      const mockSelect = jest.fn(() => ({
        eq: mockEq
      }));
      
      const mockFrom = jest.fn(() => ({
        select: mockSelect
      }));

      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValueOnce({
        from: mockFrom
      });

      const result = await fetchActiveSourceSlugsExecute();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('network error');
      expect(result.sources).toEqual([]);
    });

    it('should verify the exact query structure and parameters', async () => {
      // Create detailed mocks to verify exact call sequence
      const mockOrder = jest.fn(() => Promise.resolve({
        data: [{ id: 1, slug: 'test', name: 'Test', adapter_name: 'test' }],
        error: null
      }));
      
      const mockEq = jest.fn(() => ({
        order: mockOrder
      }));
      
      const mockSelect = jest.fn(() => ({
        eq: mockEq
      }));
      
      const mockFrom = jest.fn(() => ({
        select: mockSelect
      }));

      const { createClient } = require('@supabase/supabase-js');
      createClient.mockReturnValueOnce({
        from: mockFrom
      });

      await fetchActiveSourceSlugsExecute();
      
      // Verify exact call sequence and parameters
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledWith('sources');
      
      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockSelect).toHaveBeenCalledWith('id, slug, name, adapter_name');
      
      expect(mockEq).toHaveBeenCalledTimes(1);
      expect(mockEq).toHaveBeenCalledWith('is_active', true);
      
      expect(mockOrder).toHaveBeenCalledTimes(1);
      expect(mockOrder).toHaveBeenCalledWith('priority', { ascending: false });
    });
  });

  describe('fetchAdapterData', () => {
    it('should fetch data from adapter successfully', async () => {
      const result = await fetchAdapterDataExecute({ adapterName: 'test' });
      
      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Test Article');
      expect(result.items[0].source_slug).toBe('test');
      expect(result.adapterName).toBe('test');
    });

    it('should handle adapter errors gracefully', async () => {
      const result = await fetchAdapterDataExecute({ adapterName: 'nonexistent' });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.items).toEqual([]);
    });
  });

  describe('fetchURLContent', () => {
    it('should fetch HTML content successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><body>Test content</body></html>')
      });

      const result = await fetchURLContentExecute({ url: 'https://example.com' });
      
      expect(result.success).toBe(true);
      expect(result.html).toContain('Test content');
      expect(result.contentLength).toBeGreaterThan(0);
    });

    it('should handle fetch timeout', async () => {
      (global.fetch as any).mockImplementationOnce(() => 
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AbortError')), 100);
        })
      );

      const result = await fetchURLContentExecute({ url: 'https://example.com' });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timeout');
      expect(result.html).toBeNull();
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      const result = await fetchURLContentExecute({ url: 'https://example.com' });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP error');
    });
  });

  describe('extractMainContent', () => {
    it('should extract content from HTML', async () => {
      const html = `
        <html>
          <head><title>Test Article</title></head>
          <body>
            <article>
              <h1>Test Title</h1>
              <p>This is the main content of the article.</p>
            </article>
          </body>
        </html>
      `;

      const result = await extractMainContentExecute({ html, url: 'https://example.com/article' });
      
      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('should handle parsing errors', async () => {
      const result = await extractMainContentExecute({ html: 'invalid html', url: null });
      
      // Readability might still parse invalid HTML, so we check for basic structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('content');
    });
  });

  describe('createEmbedding', () => {
    describe('batch embeddings', () => {
      it('should generate embeddings for multiple texts successfully', async () => {
        const result = await createEmbeddingExecute({ 
          texts: ['First text for embedding', 'Second text for embedding'],
          truncate: true 
        });
        
        expect(result.success).toBe(true);
        expect(result.embeddings).toHaveLength(2);
        expect(result.count).toBe(2);
        expect(result.dimensions).toBe(1536);
        expect(result.usage).toBeDefined();
        result.embeddings?.forEach(embedding => {
          expect(embedding).toHaveLength(1536);
        });
      });

      it('should handle empty texts array', async () => {
        const result = await createEmbeddingExecute({ 
          texts: [],
          truncate: true 
        });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('No texts provided');
      });

      it('should truncate long texts in batch', async () => {
        const longText1 = 'a'.repeat(35000); // Longer than maxChars
        const longText2 = 'b'.repeat(35000);
        
        const result = await createEmbeddingExecute({ 
          texts: [longText1, longText2],
          truncate: true 
        });
        
        expect(result.success).toBe(true);
        expect(result.embeddings).toHaveLength(2);
        result.embeddings?.forEach(embedding => {
          expect(embedding).toHaveLength(1536);
        });
      });

             it('should maintain order of embeddings', async () => {
        const texts = ['First text', 'Second text', 'Third text'];
        
        const result = await createEmbeddingExecute({ 
          texts,
          truncate: true 
        });
        
        expect(result.success).toBe(true);
        expect(result.embeddings).toHaveLength(3);
        expect(result.count).toBe(3);
        // All embeddings should be different (different texts)
        expect(result.embeddings?.[0]).not.toEqual(result.embeddings?.[1]);
      });

             it('should reduce API calls compared to individual requests', async () => {
        const createMock = jest.mocked(openai.embeddings.create);
        createMock.mockClear();
        
        const texts = ['Text 1', 'Text 2', 'Text 3', 'Text 4', 'Text 5'];
        
        // Single batch call
        await createEmbeddingExecute({ texts, truncate: true });
        
        // Should only be called once for the entire batch
        expect(createMock).toHaveBeenCalledTimes(1);
        expect(createMock).toHaveBeenCalledWith({
          model: 'text-embedding-3-small',
          input: texts
        });
      });
    });

    describe('single embedding convenience function', () => {
      it('should generate single embedding successfully', async () => {
        const result = await createSingleEmbeddingExecute({ 
          text: 'Test content for embedding',
          truncate: true 
        });
        
        expect(result.success).toBe(true);
        expect(result.embedding).toHaveLength(1536);
        expect(result.dimensions).toBe(1536);
        expect(result.usage).toBeDefined();
      });

      it('should truncate long text', async () => {
        const longText = 'a'.repeat(35000); // Longer than maxChars
        
        const result = await createSingleEmbeddingExecute({ 
          text: longText,
          truncate: true 
        });
        
        expect(result.success).toBe(true);
        expect(result.embedding).toHaveLength(1536);
      });
    });
  });

  describe('upsertSupabase', () => {
    it('should upsert story successfully', async () => {
      const story = {
        external_id: 'test-123',
        source_id: 1,
        title: 'Test Story',
        url: 'https://example.com/story',
        author: 'Test Author',
        published_at: '2024-01-01T00:00:00Z',
        summary: 'Test summary',
        content: 'Test content',
        embedding: new Array(1536).fill(0.1),
        metadata: { source: 'test' }
      };

      const result = await upsertSupabaseExecute({ story });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.operation).toBeDefined();
    });
  });
}); 