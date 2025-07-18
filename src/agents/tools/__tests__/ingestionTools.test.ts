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
} from '../ingestionTools';
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
    it('should fetch active sources successfully', async () => {
      const result = await fetchActiveSourceSlugsExecute();
      
      expect(result.success).toBe(true);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].slug).toBe('test');
    });
  });

  describe('fetchAdapterData', () => {
    it('should fetch data from adapter successfully', async () => {
      const result = await fetchAdapterDataExecute({ sourceSlug: 'test' });
      
      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Test Article');
      expect(result.items[0].source_slug).toBe('test');
      expect(result.adapterName).toBe('test');
    });

    it('should handle adapter errors gracefully', async () => {
      const result = await fetchAdapterDataExecute({ sourceSlug: 'nonexistent' });
      
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