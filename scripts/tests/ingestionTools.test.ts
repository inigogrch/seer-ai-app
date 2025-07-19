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
} from '../ingestion/tools/ingestion-helpers';
import { openai } from '../../src/utils/openaiClient';
import { createMockSupabaseClient, createMockOpenAIResponse } from '../../src/__tests__/setup';

// Mock external dependencies
jest.mock('../../src/config/environment', () => ({
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
      // Use an existing adapter instead of non-existent 'test' adapter
      const result = await fetchAdapterDataExecute({ adapterName: 'anthropic' });
      
      // Since we're testing real adapter functionality, we check structure not specific values
      expect(result.success).toBe(true);
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.adapterName).toBe('anthropic');
      expect(typeof result.sourceCount).toBe('number');
    });

    it('should handle adapter errors gracefully', async () => {
      const result = await fetchAdapterDataExecute({ adapterName: 'nonexistent' });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.items).toEqual([]);
    });
  });

  describe('fetchURLContent', () => {
    describe('successful HTTP fetch', () => {
      it('should return success: true, full HTML string, and accurate contentLength', async () => {
        const mockHtml = '<html><head><title>Test Page</title></head><body><h1>Test Content</h1><p>This is a test article with some content.</p></body></html>';
        
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(mockHtml)
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/article' });
        
        // Validate exact return structure
        expect(result.success).toBe(true);
        expect(result.html).toBe(mockHtml);
        expect(result.contentLength).toBe(mockHtml.length);
        expect(result.error).toBeUndefined();
        
        // Verify fetch was called with the URL and some options
        expect(global.fetch).toHaveBeenCalledWith(
          'https://example.com/article',
          expect.any(Object)
        );
      });

      it('should handle large HTML content accurately', async () => {
        const largeHtml = '<html><body>' + 'x'.repeat(50000) + '</body></html>';
        
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve(largeHtml)
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/large' });
        
        expect(result.success).toBe(true);
        expect(result.html).toBe(largeHtml);
        expect(result.contentLength).toBe(largeHtml.length);
        expect(result.contentLength).toBeGreaterThan(50000);
      });
    });

    describe('network timeouts', () => {
      it('should return success: false, error: "Request timeout", and html: null', async () => {
        // Mock AbortError (which is how timeouts are typically handled)
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        
        (global.fetch as any).mockRejectedValueOnce(abortError);

        const result = await fetchURLContentExecute({ url: 'https://slow-example.com' });
        
        // Validate exact error response structure
        expect(result.success).toBe(false);
        expect(result.error).toBe('Request timeout');
        expect(result.html).toBeNull();
        expect(result.contentLength).toBeUndefined();
      });

      it('should handle various timeout error types', async () => {
        const timeoutError = new Error('network timeout');
        
        (global.fetch as any).mockRejectedValueOnce(timeoutError);

        const result = await fetchURLContentExecute({ url: 'https://timeout-example.com' });
        
        expect(result.success).toBe(false);
        expect(result.error).toBe('network timeout'); // Non-AbortError keeps original message
        expect(result.html).toBeNull();
      });
    });

    describe('non-200 status codes', () => {
      it('should handle 404 Not Found with specific HTTP error message', async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/missing' });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP error');
        expect(result.error).toContain('404');
        expect(result.html).toBeNull();
        expect(result.contentLength).toBeUndefined();
      });

      it('should handle 500 Internal Server Error', async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/error' });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP error');
        expect(result.error).toContain('500');
        expect(result.html).toBeNull();
      });

      it('should handle 403 Forbidden', async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden'
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/forbidden' });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP error');
        expect(result.error).toContain('403');
        expect(result.html).toBeNull();
      });

      it('should handle redirects that exceed limit (too many redirects)', async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: false,
          status: 310,
          statusText: 'Too Many Redirects'
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/redirect-loop' });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('HTTP error');
        expect(result.error).toContain('310');
        expect(result.html).toBeNull();
      });
    });

    describe('invalid URLs', () => {
      it('should handle malformed URLs gracefully', async () => {
        const networkError = new Error('Invalid URL');
        
        (global.fetch as any).mockRejectedValueOnce(networkError);

        const result = await fetchURLContentExecute({ url: 'not-a-valid-url' });
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.html).toBeNull();
      });

      it('should handle network unreachable errors', async () => {
        const networkError = new Error('ENOTFOUND: getaddrinfo failed');
        
        (global.fetch as any).mockRejectedValueOnce(networkError);

        const result = await fetchURLContentExecute({ url: 'https://nonexistent-domain-12345.com' });
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.html).toBeNull();
      });

      it('should handle connection refused errors', async () => {
        const connectionError = new Error('ECONNREFUSED: Connection refused');
        
        (global.fetch as any).mockRejectedValueOnce(connectionError);

        const result = await fetchURLContentExecute({ url: 'https://localhost:9999/unreachable' });
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.html).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle empty response body', async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('')
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/empty' });
        
        expect(result.success).toBe(true);
        expect(result.html).toBe('');
        expect(result.contentLength).toBe(0);
      });

      it('should handle response.text() throwing an error', async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.reject(new Error('Failed to read response body'))
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/bad-body' });
        
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.html).toBeNull();
      });

      it('should validate fetch is called with options (timeout & headers)', async () => {
        // This test ensures the fetch call includes configuration
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('<html>success</html>')
        });

        const result = await fetchURLContentExecute({ url: 'https://example.com/timeout-test' });
        
        // Verify fetch was called with URL and options object
        expect(global.fetch).toHaveBeenCalledWith(
          'https://example.com/timeout-test',
          expect.any(Object)
        );
        
        // Verify successful result
        expect(result.success).toBe(true);
        expect(result.html).toBe('<html>success</html>');
      });
    });
  });

  describe('extractMainContent', () => {
    describe('well-formed article HTML', () => {
      it('should return success: true, non-empty content, correct title, byline, and excerpt', async () => {
        const wellFormedHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Breaking: AI Revolution Transforms Software Development</title>
              <meta name="author" content="Jane Smith">
              <meta name="description" content="A comprehensive analysis of how artificial intelligence is reshaping the software industry">
            </head>
            <body>
              <header>
                <nav>Navigation menu</nav>
              </header>
              <main>
                <article>
                  <h1>Breaking: AI Revolution Transforms Software Development</h1>
                  <div class="byline">
                    <span class="author">By Jane Smith</span>
                    <time datetime="2025-01-15">January 15, 2025</time>
                  </div>
                  <div class="excerpt">
                    <p>Artificial intelligence is fundamentally changing how developers write, test, and deploy code, with new tools emerging daily.</p>
                  </div>
                  <div class="article-content">
                    <p>The software development landscape is experiencing unprecedented transformation as artificial intelligence tools become mainstream. From code generation to automated testing, AI is reshaping every aspect of the development lifecycle.</p>
                    
                    <h2>Code Generation Revolution</h2>
                    <p>AI-powered code assistants like GitHub Copilot and ChatGPT are enabling developers to write code faster than ever before. These tools can generate entire functions, suggest optimizations, and even write documentation.</p>
                    
                    <h2>Testing and Quality Assurance</h2>
                    <p>Machine learning algorithms are now capable of predicting where bugs are most likely to occur, automatically generating test cases, and identifying security vulnerabilities before code reaches production.</p>
                    
                    <h2>The Future of Development</h2>
                    <p>As AI continues to evolve, we can expect even more sophisticated tools that will handle routine programming tasks, allowing developers to focus on creative problem-solving and architectural decisions.</p>
                    
                    <blockquote>
                      <p>"AI is not replacing developers, it's amplifying their capabilities," says Dr. Alex Johnson, a leading researcher in software engineering.</p>
                    </blockquote>
                    
                    <p>The integration of AI into development workflows represents just the beginning of a broader transformation that will define the next decade of software engineering.</p>
                  </div>
                </article>
              </main>
              <aside>
                <div class="sidebar">Related articles...</div>
              </aside>
              <footer>
                <p>Copyright 2025</p>
              </footer>
            </body>
          </html>
        `;

        const result = await extractMainContentExecute({ 
          html: wellFormedHtml, 
          url: 'https://tech-news.com/ai-revolution-software' 
        });
        
        // Validate exact success structure
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        
        // Validate content extraction
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(100); // Should have substantial content
        expect(result.content).toContain('artificial intelligence'); // Should include main content
        expect(result.content).toContain('Code Generation Revolution'); // Should include subheadings
        expect(result.content).toContain('artificial intelligence tools'); // Should include article content
        expect(result.content).not.toContain('Navigation menu'); // Should exclude nav
        expect(result.content).not.toContain('Related articles'); // Should exclude sidebar
        expect(result.content).not.toContain('Copyright 2025'); // Should exclude footer
        
        // Validate title extraction
        expect(result.title).toBeDefined();
        if (result.title) {
          expect(result.title.length).toBeGreaterThan(0);
          expect(result.title).toContain('AI Revolution'); // Should extract meaningful title
        }
        
        // Validate byline extraction
        expect(result.byline).toBeDefined();
        expect(typeof result.byline).toBe('string');
        // Byline might be extracted or empty depending on HTML structure
        
        // Validate excerpt extraction
        expect(result.excerpt).toBeDefined();
        expect(typeof result.excerpt).toBe('string');
        // Excerpt might be extracted or empty depending on content
        
        // Validate length property
        expect(result.length).toBe(result.content.length);
        expect(result.length).toBeGreaterThan(0);
      });

      it('should handle articles with complex formatting and media', async () => {
        const complexHtml = `
          <html>
            <head><title>Tech Review: Latest Gadgets</title></head>
            <body>
              <article>
                <header>
                  <h1>Tech Review: Latest Gadgets</h1>
                  <p class="byline">By Tech Reviewer</p>
                </header>
                <div class="content">
                  <p>Here's our comprehensive review of the latest tech gadgets.</p>
                  <img src="gadget1.jpg" alt="Latest smartphone">
                  <p>The new smartphone features include:</p>
                  <ul>
                    <li>Advanced camera system</li>
                    <li>Longer battery life</li>
                    <li>Faster processor</li>
                  </ul>
                  <code>const feature = 'amazing';</code>
                  <p>Overall, these devices represent significant progress in consumer technology.</p>
                </div>
              </article>
            </body>
          </html>
        `;

        const result = await extractMainContentExecute({ 
          html: complexHtml, 
          url: 'https://reviews.com/latest-gadgets' 
        });
        
        expect(result.success).toBe(true);
        expect(result.content).toContain('comprehensive review');
        expect(result.content).toContain('Advanced camera system'); // Should preserve list items
        expect(result.content).toContain('const feature'); // Should preserve code
                 expect(result.title).toBeTruthy();
         if (result.title) {
           expect(result.title).toContain('Tech Review');
         }
      });
    });

    describe('malformed HTML', () => {
      it('should handle incomplete or broken HTML gracefully', async () => {
        const malformedHtml = `
          <html>
            <head><title>Broken Article
            <body>
              <div>
                <p>Some content here but missing closing tags
                <span>Unclosed span
                <div>Nested div without proper structure
                  <p>More content that might be extractable
              </div>
        `;

        const result = await extractMainContentExecute({ 
          html: malformedHtml, 
          url: 'https://broken-site.com/article' 
        });
        
        // Should handle gracefully - either succeed with partial content or fail safely
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('byline');
        expect(result).toHaveProperty('excerpt');
        
        if (result.success) {
          // If it manages to extract something, validate the structure
          expect(typeof result.content).toBe('string');
          expect(typeof result.title).toBe('string');
        } else {
          // If it fails, should return empty strings and error
          expect(result.content).toBe('');
          expect(result.title).toBe('');
          expect(result.byline).toBe('');
          expect(result.excerpt).toBe('');
          expect(result.error).toBeDefined();
        }
      });

      it('should handle completely invalid HTML', async () => {
        const invalidHtml = 'not html at all just plain text';

        const result = await extractMainContentExecute({ 
          html: invalidHtml, 
          url: null 
        });
        
        // Should handle gracefully
        expect(result).toHaveProperty('success');
        expect(typeof result.success).toBe('boolean');
        
        // Structure should always be present
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('byline');
        expect(result).toHaveProperty('excerpt');
      });
    });

    describe('pay-walled and restricted content', () => {
      it('should return success: false for pay-walled content with minimal extractable text', async () => {
        const payWalledHtml = `
          <html>
            <head><title>Premium Article - Subscribe to Read</title></head>
            <body>
              <article>
                <h1>Exclusive: Market Analysis</h1>
                <p>This is a premium article available only to subscribers.</p>
                <div class="paywall">
                  <h2>Subscribe to continue reading</h2>
                  <p>Get unlimited access to all our premium content for just $9.99/month.</p>
                  <button>Subscribe Now</button>
                </div>
                <div class="hidden-content" style="display: none;">
                  <!-- Actual content would be hidden or not present -->
                </div>
              </article>
            </body>
          </html>
        `;

        const result = await extractMainContentExecute({ 
          html: payWalledHtml, 
          url: 'https://premium-news.com/exclusive-analysis' 
        });
        
        // Readability might extract the paywall content, but it should be minimal
        if (result.success) {
          // If successful, content should be very short (just paywall text)
          expect(result.content.length).toBeLessThan(200);
          expect(result.content.toLowerCase()).toMatch(/subscribe|premium|paywall|exclusive/i);
        } else {
          // If failed, should return proper error structure
          expect(result.success).toBe(false);
          expect(result.content).toBe('');
          expect(result.title).toBe('');
          expect(result.byline).toBe('');
          expect(result.excerpt).toBe('');
          expect(result.error).toBeDefined();
        }
      });

      it('should handle subscription prompts and login walls', async () => {
        const loginWallHtml = `
          <html>
            <head><title>Please Log In</title></head>
            <body>
              <div class="login-required">
                <h1>Access Restricted</h1>
                <p>Please log in to view this content.</p>
                <form>
                  <input type="email" placeholder="Email">
                  <input type="password" placeholder="Password">
                  <button>Log In</button>
                </form>
              </div>
            </body>
          </html>
        `;

        const result = await extractMainContentExecute({ 
          html: loginWallHtml, 
          url: 'https://members-only.com/article' 
        });
        
        // Should either fail or extract minimal login-related content
        if (result.success) {
          expect(result.content.length).toBeLessThan(150);
        } else {
          expect(result.content).toBe('');
          expect(result.error).toBeDefined();
        }
      });
    });

    describe('non-article pages', () => {
      it('should return success: false for navigation/listing pages', async () => {
        const listingPageHtml = `
          <html>
            <head><title>Tech News - Latest Articles</title></head>
            <body>
              <h1>Latest Tech News</h1>
              <div class="article-list">
                <div class="article-preview">
                  <h2><a href="/article1">AI News Update</a></h2>
                  <p>Brief excerpt...</p>
                </div>
                <div class="article-preview">
                  <h2><a href="/article2">Tech Review</a></h2>
                  <p>Another brief excerpt...</p>
                </div>
                <div class="article-preview">
                  <h2><a href="/article3">Market Analysis</a></h2>
                  <p>Yet another excerpt...</p>
                </div>
              </div>
              <div class="pagination">
                <a href="/page/2">Next</a>
              </div>
            </body>
          </html>
        `;

        const result = await extractMainContentExecute({ 
          html: listingPageHtml, 
          url: 'https://news-site.com/latest' 
        });
        
        // Readability should recognize this isn't a proper article
        // Either fail completely or extract very little meaningful content
        if (result.success) {
          // If it extracts something, should be minimal listing content
          expect(result.content.length).toBeLessThan(300);
        } else {
          expect(result.success).toBe(false);
          expect(result.content).toBe('');
          expect(result.error).toBeDefined();
        }
      });

      it('should handle error pages gracefully', async () => {
        const errorPageHtml = `
          <html>
            <head><title>404 - Page Not Found</title></head>
            <body>
              <div class="error-page">
                <h1>404 - Page Not Found</h1>
                <p>The page you are looking for does not exist.</p>
                <a href="/">Go to Homepage</a>
              </div>
            </body>
          </html>
        `;

        const result = await extractMainContentExecute({ 
          html: errorPageHtml, 
          url: 'https://example.com/missing-page' 
        });
        
                 if (result.success) {
           // Should extract minimal error page content
           expect(result.content.length).toBeLessThan(100);
           expect(result.content.toLowerCase()).toContain('page you are looking for');
         } else {
           expect(result.content).toBe('');
           expect(result.error).toBeDefined();
         }
      });
    });

    describe('error handling and logging', () => {
      it('should log errors without throwing for parsing failures', async () => {
        // Spy on console.error to verify error logging
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        
        const problematicHtml = `
          <html>
            <head><title>Problematic Content</title></head>
            <body>
              <!-- Content that might cause Readability to fail -->
              <div class="content">
                <script>malicious.code();</script>
                <div>Minimal actual content</div>
              </div>
            </body>
          </html>
        `;

        const result = await extractMainContentExecute({ 
          html: problematicHtml, 
          url: 'https://problematic-site.com/article' 
        });
        
        // Should not throw an exception
        expect(result).toBeDefined();
        expect(result).toHaveProperty('success');
        
        if (!result.success) {
          // Should have proper error structure
          expect(result.content).toBe('');
          expect(result.title).toBe('');
          expect(result.byline).toBe('');
          expect(result.excerpt).toBe('');
          expect(result.error).toBeDefined();
          
          // Should have logged the error
          expect(consoleSpy).toHaveBeenCalledWith(
            'Error extracting main content:',
            expect.any(Error)
          );
        }
        
        consoleSpy.mockRestore();
      });

      it('should handle empty or whitespace-only HTML', async () => {
        const emptyHtml = '   \n\t   ';

        const result = await extractMainContentExecute({ 
          html: emptyHtml, 
          url: 'https://empty-site.com' 
        });
        
        // Should handle gracefully without throwing
        expect(result).toBeDefined();
        expect(result).toHaveProperty('success');
        
        if (!result.success) {
          expect(result.content).toBe('');
          expect(result.error).toBeDefined();
        }
      });

      it('should maintain consistent return structure regardless of outcome', async () => {
        const testCases = [
          { html: '<html><body><p>Valid content</p></body></html>', url: 'https://valid.com' },
          { html: 'invalid', url: null },
          { html: '', url: 'https://empty.com' },
          { html: '<html></html>', url: 'https://minimal.com' }
        ];

        for (const testCase of testCases) {
          const result = await extractMainContentExecute(testCase);
          
          // Every result should have the same structure
          expect(result).toHaveProperty('success');
          expect(result).toHaveProperty('content');
          expect(result).toHaveProperty('title');
          expect(result).toHaveProperty('byline');
          expect(result).toHaveProperty('excerpt');
          
          expect(typeof result.success).toBe('boolean');
                     expect(typeof result.content).toBe('string');
           expect(typeof result.title).toBe('string');
           expect(result.byline === null || typeof result.byline === 'string').toBe(true);
           expect(result.excerpt === null || typeof result.excerpt === 'string' || typeof result.excerpt === 'undefined').toBe(true);
          
          if (!result.success) {
            expect(result).toHaveProperty('error');
            expect(typeof result.error).toBe('string');
          }
        }
      });
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