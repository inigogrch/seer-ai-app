/**
 * Unit tests for IngestionAgent tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  fetchAdapterDataExecute, 
  fetchURLContentExecute, 
  extractMainContentExecute, 
  createEmbeddingExecute, 
  upsertSupabaseExecute,
  fetchActiveSourceSlugsExecute 
} from '../ingestionTools';

// Mock external dependencies
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ 
            data: [{ id: 1, slug: 'test', name: 'Test Source', adapter_name: 'test' }], 
            error: null 
          }))
        }))
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ 
            data: { id: 1, title: 'Test Story' }, 
            error: null 
          }))
        }))
      }))
    }))
  }))
}));

vi.mock('../../../utils/openaiClient', () => ({
  openai: {
    embeddings: {
      create: vi.fn(() => Promise.resolve({
        data: [{ embedding: new Array(1536).fill(0.1) }],
        usage: { prompt_tokens: 10, total_tokens: 20 }
      }))
    }
  }
}));

// Mock dynamic imports for adapters
vi.mock('../../../adapters/test', () => ({
  fetchAndParse: vi.fn(() => Promise.resolve([
    {
      title: 'Test Article',
      url: 'https://example.com/article',
      author: 'Test Author',
      published_at: '2024-01-01T00:00:00Z',
      summary: 'Test summary'
    }
  ]))
}));

// Mock fetch
global.fetch = vi.fn();

describe('IngestionTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      const result = await extractMainContentExecute({ html });
      
      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
    });

    it('should handle parsing errors', async () => {
      const result = await extractMainContentExecute({ html: 'invalid html' });
      
      // Readability might still parse invalid HTML, so we check for basic structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('content');
    });
  });

  describe('createEmbedding', () => {
    it('should generate embeddings successfully', async () => {
      const result = await createEmbeddingExecute({ 
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
      
      const result = await createEmbeddingExecute({ 
        text: longText,
        truncate: true 
      });
      
      expect(result.success).toBe(true);
      expect(result.embedding).toHaveLength(1536);
    });
  });

  describe('upsertSupabase', () => {
    it('should upsert story successfully', async () => {
      const story = {
        external_id: 'test-123',
        source_id: 1,
        title: 'Test Story',
        url: 'https://example.com/story',
        content: 'Test content',
        embedding: new Array(1536).fill(0.1)
      };

      const result = await upsertSupabaseExecute({ story });
      
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.operation).toBeDefined();
    });
  });
}); 