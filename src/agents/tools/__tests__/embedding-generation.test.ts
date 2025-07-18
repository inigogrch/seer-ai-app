/**
 * Comprehensive Embedding Generation Tests
 * 
 * Tests createEmbedding and createSingleEmbedding functions for:
 * - Basic functionality and dimensions
 * - Truncation logic for long texts
 * - Error handling and retry logic
 * - Cache behavior and statistics
 * - OpenAI API integration
 */

import { 
  createEmbeddingExecute,
  createSingleEmbeddingExecute 
} from '../ingestion-helpers';
import { openai } from '../../../utils/openaiClient';

// Mock OpenAI client
jest.mock('../../../utils/openaiClient', () => ({
  openai: {
    embeddings: {
      create: jest.fn()
    }
  }
}));

// Properly type the mock
const mockOpenAI = {
  embeddings: {
    create: openai.embeddings.create as jest.MockedFunction<typeof openai.embeddings.create>
  }
};

describe('Embedding Generation Workflow', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Disable cache for most tests to test core functionality
    process.env.EMBEDDING_CACHE_ENABLED = 'false';
  });

  describe('Basic Functionality - createEmbedding', () => {
    it('should generate embeddings for new text inputs with correct dimensions and usage', async () => {
      // Mock successful OpenAI response
      const mockEmbedding1 = new Array(1536).fill(0).map(() => Math.random());
      const mockEmbedding2 = new Array(1536).fill(0).map(() => Math.random());
      
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [
          { embedding: mockEmbedding1, index: 0 },
          { embedding: mockEmbedding2, index: 1 }
        ],
        usage: {
          prompt_tokens: 50,
          total_tokens: 50
        },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      const testTexts = [
        'OpenAI has released a new AI model called GPT-4o that combines text, vision, and audio capabilities.',
        'VentureBeat reports on the latest developments in artificial intelligence and machine learning technologies.'
      ];

      console.log('\n🧪 Testing basic embedding generation...\n');

      const result = await createEmbeddingExecute({ 
        texts: testTexts, 
        truncate: true 
      });

      // Validate success response
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Validate embeddings structure
      expect(result.embeddings).toBeDefined();
      expect(result.embeddings).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.dimensions).toBe(1536);

      // Validate individual embeddings
      expect(result.embeddings![0]).toHaveLength(1536);
      expect(result.embeddings![1]).toHaveLength(1536);
      
      // Should be arrays of numbers
      expect(result.embeddings![0].every(val => typeof val === 'number')).toBe(true);
      expect(result.embeddings![1].every(val => typeof val === 'number')).toBe(true);

      // Validate usage details
      expect(result.usage).toBeDefined();
      expect(result.usage.prompt_tokens).toBe(50);
      expect(result.usage.total_tokens).toBe(50);
      expect(result.usage.cache_hits).toBe(0);
      expect(result.usage.cache_misses).toBe(2);

      // Validate cache stats
      expect(result.cacheStats).toBeDefined();
      if (result.cacheStats) {
        expect(result.cacheStats.hits).toBe(0);
        expect(result.cacheStats.misses).toBe(2);
        expect(result.cacheStats.hitRate).toBe('0.0%');
      }

      // Verify OpenAI API was called correctly
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(1);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: testTexts
      });

      console.log(`✅ Generated ${result.count} embeddings of ${result.dimensions} dimensions`);
      if (result.usage && 'prompt_tokens' in result.usage && result.cacheStats) {
        console.log(`📊 Usage: ${result.usage.prompt_tokens} tokens, ${result.cacheStats.hitRate} cache hit rate`);
      }
    });

    it('should handle single text embedding with createSingleEmbeddingExecute', async () => {
      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding, index: 0 }],
        usage: {
          prompt_tokens: 25,
          total_tokens: 25
        },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      const testText = 'TechCrunch covers startup news, technology trends, and venture capital investments in Silicon Valley.';

      console.log('\n🧪 Testing single embedding generation...\n');

      const result = await createSingleEmbeddingExecute({ 
        text: testText, 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embedding).toBeDefined();
      expect(result.embedding).toHaveLength(1536);
      expect(result.dimensions).toBe(1536);
      
      // Validate usage for single embedding
      expect(result.usage).toBeDefined();
      if (result.usage && 'prompt_tokens' in result.usage) {
        expect(result.usage.prompt_tokens).toBe(25);
        expect(result.usage.cache_hits).toBe(0);
        expect(result.usage.cache_misses).toBe(1);
      }

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: testText
      });

      console.log(`✅ Generated single embedding of ${result.dimensions} dimensions`);
      if (result.usage && 'prompt_tokens' in result.usage) {
        console.log(`📊 Usage: ${result.usage.prompt_tokens} tokens`);
      }
    });
  });

  describe('Truncation Logic', () => {
    it('should truncate text longer than 10,000 characters when truncate=true', async () => {
      // Create a very long text (>10,000 chars)
      const longText = 'This is a very long article about artificial intelligence. '.repeat(200); // ~11,600 chars
      const expectedTruncated = longText.substring(0, 10000) + '...';

      expect(longText.length).toBeGreaterThan(10000);

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: new Array(1536).fill(0.1), index: 0 }],
        usage: { prompt_tokens: 2500, total_tokens: 2500 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log(`\n🧪 Testing truncation for ${longText.length} character text...\n`);

      const result = await createEmbeddingExecute({ 
        texts: [longText], 
        truncate: true 
      });

      expect(result.success).toBe(true);
      
      // Verify the API was called with truncated text
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: [expectedTruncated]
      });

      console.log(`✅ Text truncated from ${longText.length} to ${expectedTruncated.length} chars`);
    });

    it('should NOT truncate text when truncate=false', async () => {
      const longText = 'Long text content. '.repeat(600); // ~11,400 chars
      
      expect(longText.length).toBeGreaterThan(10000);

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: new Array(1536).fill(0.1), index: 0 }],
        usage: { prompt_tokens: 4500, total_tokens: 4500 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log(`\n🧪 Testing NO truncation for ${longText.length} character text...\n`);

      const result = await createEmbeddingExecute({ 
        texts: [longText], 
        truncate: false 
      });

      expect(result.success).toBe(true);
      
      // Verify the API was called with original long text
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: [longText] // Original, not truncated
      });

      console.log(`✅ Text preserved at original ${longText.length} chars (no truncation)`);
    });

    it('should handle mixed length texts in batch processing', async () => {
      const shortText = 'Short AI news summary.';
      const mediumText = 'Medium length article about machine learning. '.repeat(50); // ~2,200 chars
      const longText = 'Very long comprehensive analysis. '.repeat(300); // ~10,500 chars
      
      const texts = [shortText, mediumText, longText];
      const expectedTexts = [
        shortText, // unchanged
        mediumText, // unchanged  
        longText.substring(0, 10000) + '...' // truncated
      ];

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [
          { embedding: new Array(1536).fill(0.1), index: 0 },
          { embedding: new Array(1536).fill(0.2), index: 1 },
          { embedding: new Array(1536).fill(0.3), index: 2 }
        ],
        usage: { prompt_tokens: 3000, total_tokens: 3000 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🧪 Testing mixed length batch processing...\n');

      const result = await createEmbeddingExecute({ 
        texts, 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(3);
      
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: expectedTexts
      });

      console.log(`✅ Processed batch: ${shortText.length}, ${mediumText.length}, ${longText.length} → ${expectedTexts[2].length} chars`);
    });
  });

  describe('Error Handling and Rate Limits', () => {
    it('should handle OpenAI API errors gracefully', async () => {
      mockOpenAI.embeddings.create.mockRejectedValueOnce(
        new Error('API request failed: insufficient_quota')
      );

      console.log('\n🧪 Testing OpenAI API error handling...\n');

      const result = await createEmbeddingExecute({ 
        texts: ['Test text for error scenario'], 
        truncate: true 
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('insufficient_quota');
      expect(result.embeddings).toBeNull();

      console.log(`❌ Correctly handled API error: ${result.error}`);
    });

    it('should handle rate limit errors', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      
      mockOpenAI.embeddings.create.mockRejectedValueOnce(rateLimitError);

      console.log('\n🧪 Testing rate limit error handling...\n');

      const result = await createEmbeddingExecute({ 
        texts: ['Test text for rate limit'], 
        truncate: true 
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
      expect(result.embeddings).toBeNull();

      console.log(`⏱️ Correctly handled rate limit: ${result.error}`);
    });

    it('should handle network errors', async () => {
      mockOpenAI.embeddings.create.mockRejectedValueOnce(
        new Error('Network error: ECONNREFUSED')
      );

      console.log('\n🧪 Testing network error handling...\n');

      const result = await createEmbeddingExecute({ 
        texts: ['Test text for network error'], 
        truncate: true 
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
      expect(result.embeddings).toBeNull();

      console.log(`🌐 Correctly handled network error: ${result.error}`);
    });

    it('should handle malformed API responses', async () => {
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: null, // Malformed response
        usage: { prompt_tokens: 10, total_tokens: 10 }
      } as any);

      console.log('\n🧪 Testing malformed API response handling...\n');

      const result = await createEmbeddingExecute({ 
        texts: ['Test text'], 
        truncate: true 
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.embeddings).toBeNull();

      console.log(`📋 Correctly handled malformed response: ${result.error}`);
    });
  });

  describe('Input Validation', () => {
    it('should handle empty text arrays', async () => {
      console.log('\n🧪 Testing empty text array handling...\n');

      const result = await createEmbeddingExecute({ 
        texts: [], 
        truncate: true 
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No texts provided');
      expect(result.embeddings).toBeNull();

      // Should not call OpenAI API
      expect(mockOpenAI.embeddings.create).not.toHaveBeenCalled();

      console.log(`✅ Correctly rejected empty input: ${result.error}`);
    });

    it('should handle null/undefined texts', async () => {
      console.log('\n🧪 Testing null/undefined input handling...\n');

      const result = await createEmbeddingExecute({ 
        texts: null as any, 
        truncate: true 
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No texts provided');
      expect(result.embeddings).toBeNull();

      console.log(`✅ Correctly rejected null input: ${result.error}`);
    });

    it('should handle empty strings in text array', async () => {
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [
          { embedding: new Array(1536).fill(0.1), index: 0 },
          { embedding: new Array(1536).fill(0.2), index: 1 }
        ],
        usage: { prompt_tokens: 5, total_tokens: 5 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🧪 Testing empty strings in text array...\n');

      const result = await createEmbeddingExecute({ 
        texts: ['Valid text', '', 'Another valid text'], 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(3);

      // Should pass empty string to API (OpenAI handles it)
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['Valid text', '', 'Another valid text']
      });

      console.log(`✅ Processed array with empty strings successfully`);
    });
  });

  describe('Cache Integration', () => {
    beforeEach(() => {
      // Enable cache for these tests
      process.env.EMBEDDING_CACHE_ENABLED = 'true';
    });

    afterEach(() => {
      // Reset cache setting
      process.env.EMBEDDING_CACHE_ENABLED = 'false';
    });

    it('should report cache statistics correctly', async () => {
      // Mock partial cache hit scenario
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: new Array(1536).fill(0.5), index: 0 }],
        usage: { prompt_tokens: 20, total_tokens: 20 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🧪 Testing cache statistics reporting...\n');

      const result = await createEmbeddingExecute({ 
        texts: ['New text that will be cached'], 
        truncate: true 
      });

      expect(result.success).toBe(true);
      
      // Should show cache statistics
      expect(result.cacheStats).toBeDefined();
      if (result.cacheStats) {
        expect(result.cacheStats.hits).toBeDefined();
        expect(result.cacheStats.misses).toBeDefined();
        expect(result.cacheStats.hitRate).toMatch(/\d+\.\d%/);
      }

      // Should include cache info in usage
      expect(result.usage).toBeDefined();
      if (result.usage) {
        expect(result.usage.cache_hits).toBeDefined();
        expect(result.usage.cache_misses).toBeDefined();
        expect(result.usage.cache_hit_rate).toBeDefined();
      }

      if (result.cacheStats) {
        console.log(`📊 Cache stats: ${result.cacheStats.hitRate} hit rate, ${result.cacheStats.hits} hits, ${result.cacheStats.misses} misses`);
      }
    });
  });

  describe('Real-World Content Scenarios', () => {
    it('should handle typical news article embeddings', async () => {
      const newsArticles = [
        'OpenAI Launches Sora AI Video Generator\n\nOpenAI today announced Sora, a new generative AI model that can create realistic videos from text descriptions. The model represents a significant leap forward in AI-generated content capabilities.',
        'VentureBeat: AI Startup Raises $50M\n\nA new artificial intelligence startup focused on enterprise automation has raised $50 million in Series A funding. The company plans to use the investment to expand its engineering team.',
        'TechCrunch: Google Updates Gemini Model\n\nGoogle has released an updated version of its Gemini AI model with improved reasoning capabilities and better performance on coding tasks. The new model is available through the Google AI API.'
      ];

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: newsArticles.map((_, index) => ({
          embedding: new Array(1536).fill(0.1 + index * 0.1),
          index
        })),
        usage: { prompt_tokens: 180, total_tokens: 180 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🧪 Testing real-world news article embeddings...\n');

      const result = await createEmbeddingExecute({ 
        texts: newsArticles, 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(3);
      expect(result.count).toBe(3);
      expect(result.dimensions).toBe(1536);

      // Validate each embedding is unique
      const embedding1 = result.embeddings![0];
      const embedding2 = result.embeddings![1]; 
      const embedding3 = result.embeddings![2];

      expect(embedding1).not.toEqual(embedding2);
      expect(embedding2).not.toEqual(embedding3);

      console.log(`✅ Generated ${result.count} unique embeddings for news articles`);
      console.log(`📊 Total tokens: ${result.usage.total_tokens}`);

      newsArticles.forEach((article, index) => {
        console.log(`📰 Article ${index + 1}: ${article.substring(0, 50)}... → ${result.embeddings![index].length}D vector`);
      });
    });

    it('should handle enriched content from our pipeline', async () => {
      // Simulate the enriched content that would come from our fetchURLContent + extractMainContent pipeline
      const enrichedContent = `# OpenAI Launches Sora AI Video Generator

OpenAI today announced Sora, a new generative AI model that can create realistic videos from text descriptions.

## Technical Capabilities  
The model has a deep understanding of language, enabling it to accurately interpret prompts and generate compelling characters that express vibrant emotions.

## Current Limitations
The current model has weaknesses. It may struggle with accurately simulating the physics of a complex scene.

## Safety Measures
OpenAI is taking several important safety steps ahead of making Sora available in OpenAI's products.`;

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: new Array(1536).fill(0.7), index: 0 }],
        usage: { prompt_tokens: 120, total_tokens: 120 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🧪 Testing enriched content embedding generation...\n');

      // This simulates the embedding text that would be created in our ingestion pipeline
      const embeddingText = `OpenAI Launches Sora AI Video Generator\n\n${enrichedContent}`;

      const result = await createSingleEmbeddingExecute({ 
        text: embeddingText, 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embedding).toHaveLength(1536);
      expect(result.dimensions).toBe(1536);

      console.log(`✅ Generated embedding for enriched content: ${embeddingText.length} chars → ${result.dimensions}D vector`);
      if (result.usage && 'total_tokens' in result.usage) {
        console.log(`📊 Usage: ${result.usage.total_tokens} tokens`);
      }
      console.log(`📄 Content preview: ${embeddingText.substring(0, 100)}...`);
    });
  });

  describe('Performance and Efficiency', () => {
    it('should handle large batch processing efficiently', async () => {
      // Generate 20 different article texts
      const largeBatch = Array.from({ length: 20 }, (_, i) => 
        `Article ${i + 1}: This is a comprehensive analysis of AI development trends in ${2024 + i}. ` +
        `The article covers technological advances, market dynamics, and future predictions. `.repeat(10)
      );

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: largeBatch.map((_, index) => ({
          embedding: new Array(1536).fill(0.01 * (index + 1)),
          index
        })),
        usage: { prompt_tokens: 2000, total_tokens: 2000 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🧪 Testing large batch processing...\n');

      const startTime = Date.now();
      const result = await createEmbeddingExecute({ 
        texts: largeBatch, 
        truncate: true 
      });
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(20);
      expect(result.count).toBe(20);

      // Should make only one API call for entire batch
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(1);

      console.log(`✅ Processed ${result.count || 0} embeddings in ${endTime - startTime}ms`);
      if (result.usage && 'total_tokens' in result.usage && result.count) {
        console.log(`⚡ Batch efficiency: ${result.usage.total_tokens} total tokens in single API call`);
        console.log(`📊 Average: ${(result.usage.total_tokens / result.count).toFixed(1)} tokens per embedding`);
      }
    });
  });
}); 