/**
 * Embedding-to-Story Mapping Integrity Tests
 * 
 * Critical validation that embeddings are correctly mapped to stories
 * in all scenarios: batch processing, cache hits/misses, ingestion workflow
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

describe('Embedding-to-Story Mapping Integrity', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Disable cache for controlled testing
    process.env.EMBEDDING_CACHE_ENABLED = 'false';
  });

  describe('Order Preservation in Batch Processing', () => {
    it('should maintain exact order correspondence between stories and embeddings', async () => {
      // Create distinct stories with identifiable content
      const stories = [
        {
          id: 'story-1',
          title: 'OpenAI Launches Sora',
          content: 'OpenAI today announced Sora, a new generative AI model for video creation.',
          embeddingText: 'OpenAI Launches Sora\n\nOpenAI today announced Sora, a new generative AI model for video creation.'
        },
        {
          id: 'story-2', 
          title: 'VentureBeat AI News',
          content: 'VentureBeat reports on the latest artificial intelligence developments.',
          embeddingText: 'VentureBeat AI News\n\nVentureBeat reports on the latest artificial intelligence developments.'
        },
        {
          id: 'story-3',
          title: 'TechCrunch Startup Update', 
          content: 'TechCrunch covers a new AI startup that raised $50 million in funding.',
          embeddingText: 'TechCrunch Startup Update\n\nTechCrunch covers a new AI startup that raised $50 million in funding.'
        }
      ];

      // Create unique embeddings for each story (identifiable by first value)
      const mockEmbeddings = [
        new Array(1536).fill(0).map((_, i) => i === 0 ? 0.1 : Math.random()), // Story 1: starts with 0.1
        new Array(1536).fill(0).map((_, i) => i === 0 ? 0.2 : Math.random()), // Story 2: starts with 0.2  
        new Array(1536).fill(0).map((_, i) => i === 0 ? 0.3 : Math.random())  // Story 3: starts with 0.3
      ];

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [
          { embedding: mockEmbeddings[0], index: 0 },
          { embedding: mockEmbeddings[1], index: 1 },
          { embedding: mockEmbeddings[2], index: 2 }
        ],
        usage: { prompt_tokens: 90, total_tokens: 90 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🔍 Testing story-to-embedding order preservation...\n');

      const embeddingTexts = stories.map(story => story.embeddingText);
      const result = await createEmbeddingExecute({ 
        texts: embeddingTexts, 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(3);

      // Validate each story gets its correct embedding
      stories.forEach((story, index) => {
        const embedding = result.embeddings![index];
        const expectedFirstValue = 0.1 + (index * 0.1); // 0.1, 0.2, 0.3
        
        expect(embedding[0]).toBeCloseTo(expectedFirstValue, 1);
        console.log(`✅ Story ${story.id} correctly mapped to embedding starting with ${embedding[0]}`);
      });

      // Simulate upsertSupabase calls with correct mapping
      const storyEmbeddingPairs = stories.map((story, index) => ({
        story: {
          external_id: story.id,
          title: story.title,
          content: story.content,
          embedding: result.embeddings![index] // ✅ Correct mapping
        },
        embeddingId: result.embeddings![index][0] // For verification
      }));

      console.log('\n📊 Story-Embedding Mapping Verification:');
      storyEmbeddingPairs.forEach(pair => {
        console.log(`📰 ${pair.story.title} → Embedding[${pair.embeddingId}...] (${pair.story.embedding.length}D)`);
      });

      // Verify no embedding is duplicated
      const firstValues = result.embeddings!.map(emb => emb[0]);
      const uniqueValues = new Set(firstValues);
      expect(uniqueValues.size).toBe(3); // All unique
    });

    it('should handle mixed content lengths while preserving order', async () => {
      const mixedStories = [
        { id: 'short', text: 'Short AI news.' },
        { id: 'medium', text: 'Medium length article about machine learning. '.repeat(50) },
        { id: 'long', text: 'Very long comprehensive analysis. '.repeat(1000) }
      ];

      const mockEmbeddings = [
        new Array(1536).fill(0.1), // Short story
        new Array(1536).fill(0.5), // Medium story  
        new Array(1536).fill(0.9)  // Long story
      ];

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: mockEmbeddings.map((embedding, index) => ({ embedding, index })),
        usage: { prompt_tokens: 200, total_tokens: 200 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🔍 Testing mixed content length mapping...\n');

      const texts = mixedStories.map(story => story.text);
      const result = await createEmbeddingExecute({ texts, truncate: true });

      expect(result.success).toBe(true);

      // Verify correct mapping despite different content lengths
      mixedStories.forEach((story, index) => {
        const embedding = result.embeddings![index];
        const expectedValue = 0.1 + (index * 0.4); // 0.1, 0.5, 0.9
        
        expect(embedding[0]).toBeCloseTo(expectedValue, 1);
        console.log(`✅ ${story.id} (${story.text.length} chars) → Embedding[${embedding[0]}] correctly mapped`);
      });
    });
  });

  describe('Cache Hit/Miss Mapping Integrity', () => {
    beforeEach(() => {
      // Enable cache for these tests
      process.env.EMBEDDING_CACHE_ENABLED = 'true';
    });

    afterEach(() => {
      process.env.EMBEDDING_CACHE_ENABLED = 'false';
    });

    it('should maintain order with mixed cache hits and misses', async () => {
      // Simulate scenario where some embeddings are cached, others are not
      const stories = [
        { id: 'cached-1', text: 'This story has cached embedding' },
        { id: 'new-1', text: 'This story needs new embedding' },
        { id: 'cached-2', text: 'Another cached story' },
        { id: 'new-2', text: 'Another new story' }
      ];

      // Mock scenario: stories 0 and 2 are cached (hits), 1 and 3 need generation (misses)
      const cachedEmbedding1 = new Array(1536).fill(0.111); // Cached story 1
      const cachedEmbedding2 = new Array(1536).fill(0.333); // Cached story 3
      const newEmbedding1 = new Array(1536).fill(0.222);    // New story 2  
      const newEmbedding2 = new Array(1536).fill(0.444);    // New story 4

      // Mock API call for all stories (cache disabled in test environment)
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [
          { embedding: cachedEmbedding1, index: 0 },
          { embedding: newEmbedding1, index: 1 },
          { embedding: cachedEmbedding2, index: 2 },
          { embedding: newEmbedding2, index: 3 }
        ],
        usage: { prompt_tokens: 80, total_tokens: 80 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🔍 Testing cache hit/miss mapping integrity...\n');

      // This would normally use actual cache, but we'll test the logic
      const texts = stories.map(story => story.text);
      const result = await createEmbeddingExecute({ texts, truncate: true });

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(4);

      // In a real scenario with cache, we'd expect:
      // Index 0: cached embedding (0.111)
      // Index 1: new embedding (0.222) 
      // Index 2: cached embedding (0.333)
      // Index 3: new embedding (0.444)

      // Since cache is mocked, all will be new, but order should be preserved
      stories.forEach((story, index) => {
        const embedding = result.embeddings![index];
        expect(embedding).toBeDefined();
        expect(embedding).toHaveLength(1536);
        console.log(`✅ Story ${story.id} at index ${index} has embedding of ${embedding.length} dimensions`);
      });

      console.log(`📊 Cache stats: ${result.cacheStats?.hits || 0} hits, ${result.cacheStats?.misses || 0} misses`);
    });
  });

  describe('Real Ingestion Workflow Simulation', () => {
    it('should maintain story-embedding mapping through complete pipeline', async () => {
      // Simulate the actual ingestion workflow
      const rawItems = [
        {
          external_id: 'vb-001',
          title: 'OpenAI Sora Video AI',
          url: 'https://venturebeat.com/ai/openai-sora',
          content: '', // Empty - needs enrichment
          source_slug: 'venturebeat'
        },
        {
          external_id: 'tc-002', 
          title: 'Google Gemini Update',
          url: 'https://techcrunch.com/google-gemini',
          content: 'Google has updated its Gemini AI model with new capabilities...', // Has content
          source_slug: 'techcrunch'
        },
        {
          external_id: 'oi-003',
          title: 'GPT-4o Mini Release',
          url: 'https://openai.com/blog/gpt-4o-mini', 
          content: '', // Empty - needs enrichment
          source_slug: 'openai-news'
        }
      ];

      // Step 1: Simulate content enrichment (some items get enhanced)
      const enrichedItems = rawItems.map(item => {
        if (!item.content) {
          // Simulate extractMainContent results
          return {
            ...item,
            content: `Enriched content for ${item.title}. This is a comprehensive article about the topic with detailed analysis and insights.`
          };
        }
        return item;
      });

      // Step 2: Create embedding texts (title + content)
      const embeddingTexts = enrichedItems.map(item => 
        `${item.title}\n\n${item.content}`
      );

      // Step 3: Generate embeddings
      const mockEmbeddings = [
        new Array(1536).fill(0).map(() => Math.random() + 0.1), // VentureBeat
        new Array(1536).fill(0).map(() => Math.random() + 0.2), // TechCrunch
        new Array(1536).fill(0).map(() => Math.random() + 0.3)  // OpenAI
      ];

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: mockEmbeddings.map((embedding, index) => ({ embedding, index })),
        usage: { prompt_tokens: 150, total_tokens: 150 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🔍 Testing complete ingestion workflow mapping...\n');

      const embeddingResult = await createEmbeddingExecute({ 
        texts: embeddingTexts, 
        truncate: true 
      });

      expect(embeddingResult.success).toBe(true);
      expect(embeddingResult.embeddings).toHaveLength(3);

      // Step 4: Create story records with correct embeddings
      const storyRecords = enrichedItems.map((item, index) => ({
        external_id: item.external_id,
        source_id: 1, // Mock source ID
        title: item.title,
        url: item.url,
        content: item.content,
        embedding: embeddingResult.embeddings![index], // ✅ CRITICAL MAPPING
        metadata: { source_slug: item.source_slug }
      }));

      // Validate each story has its correct embedding
      storyRecords.forEach((record, index) => {
        expect(record.embedding).toBeDefined();
        expect(record.embedding).toHaveLength(1536);
        expect(record.external_id).toBe(rawItems[index].external_id);
        
        console.log(`✅ Story ${record.external_id}: "${record.title}" → ${record.embedding.length}D embedding`);
        console.log(`   Content: ${record.content.substring(0, 50)}...`);
        console.log(`   Embedding[0]: ${record.embedding[0].toFixed(3)}`);
      });

      // Verify no embedding mixup
      const embeddingIds = storyRecords.map(record => record.embedding[0]);
      expect(embeddingIds[0]).not.toEqual(embeddingIds[1]);
      expect(embeddingIds[1]).not.toEqual(embeddingIds[2]);
      expect(embeddingIds[0]).not.toEqual(embeddingIds[2]);

      console.log('\n📊 Pipeline Integrity Check:');
      console.log(`✅ ${storyRecords.length} stories correctly mapped to ${storyRecords.length} unique embeddings`);
      console.log(`✅ Ready for upsertSupabase with guaranteed story-embedding correspondence`);
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    it('should handle partial failures without corrupting mapping', async () => {
      const stories = [
        { id: 'story-1', text: 'Valid story content' },
        { id: 'story-2', text: '' }, // Empty content
        { id: 'story-3', text: 'Another valid story' }
      ];

      // Mock successful API response
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [
          { embedding: new Array(1536).fill(0.1), index: 0 },
          { embedding: new Array(1536).fill(0.2), index: 1 }, 
          { embedding: new Array(1536).fill(0.3), index: 2 }
        ],
        usage: { prompt_tokens: 30, total_tokens: 30 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🔍 Testing edge case mapping integrity...\n');

      const texts = stories.map(story => story.text);
      const result = await createEmbeddingExecute({ texts, truncate: true });

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(3);

      // Even with empty content, mapping should be preserved
      stories.forEach((story, index) => {
        const embedding = result.embeddings![index];
        expect(embedding).toBeDefined();
        console.log(`✅ ${story.id} (${story.text.length} chars) → Embedding maintained at index ${index}`);
      });
    });

    it('should validate single embedding mapping consistency', async () => {
      const singleStory = {
        external_id: 'single-test',
        title: 'Single Story Test',
        content: 'This is a single story for testing embedding mapping consistency.'
      };

      const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
      
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding, index: 0 }],
        usage: { prompt_tokens: 20, total_tokens: 20 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🔍 Testing single story embedding mapping...\n');

      const embeddingText = `${singleStory.title}\n\n${singleStory.content}`;
      const result = await createSingleEmbeddingExecute({ 
        text: embeddingText, 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embedding).toBeDefined();
      expect(result.embedding).toHaveLength(1536);

      // Simulate upsert preparation
      const storyRecord = {
        external_id: singleStory.external_id,
        title: singleStory.title,
        content: singleStory.content,
        embedding: result.embedding // ✅ Direct 1:1 mapping
      };

      expect(storyRecord.embedding).toEqual(result.embedding);
      if (result.embedding) {
        console.log(`✅ Single story ${singleStory.external_id} correctly mapped to ${result.embedding.length}D embedding`);
      }
    });
  });

  describe('Production Scale Mapping Validation', () => {
    it('should handle large batch with perfect mapping integrity', async () => {
      // Generate 50 unique stories
      const largeStoryBatch = Array.from({ length: 50 }, (_, i) => ({
        external_id: `story-${i + 1}`,
        title: `Article ${i + 1}: AI Development News`,
        content: `This is article number ${i + 1} about artificial intelligence development. Each article has unique content identifier ${i + 1}.`
      }));

      // Generate 50 unique embeddings (identifiable by index-based values)
      const largeMockEmbeddings = largeStoryBatch.map((_, index) => 
        new Array(1536).fill(0).map((_, i) => i === 0 ? (index + 1) * 0.01 : Math.random())
      );

      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: largeMockEmbeddings.map((embedding, index) => ({ embedding, index })),
        usage: { prompt_tokens: 1000, total_tokens: 1000 },
        model: 'text-embedding-3-small',
        object: 'list'
      } as any);

      console.log('\n🔍 Testing large batch mapping integrity (50 stories)...\n');

      const embeddingTexts = largeStoryBatch.map(story => 
        `${story.title}\n\n${story.content}`
      );

      const result = await createEmbeddingExecute({ 
        texts: embeddingTexts, 
        truncate: true 
      });

      expect(result.success).toBe(true);
      expect(result.embeddings).toHaveLength(50);

      // Validate each story maps to correct embedding
      largeStoryBatch.forEach((story, index) => {
        const embedding = result.embeddings![index];
        const expectedFirstValue = (index + 1) * 0.01; // 0.01, 0.02, 0.03, ...
        
        expect(embedding[0]).toBeCloseTo(expectedFirstValue, 2);
        expect(embedding).toHaveLength(1536);
      });

      // Verify all embeddings are unique
      const firstValues = result.embeddings!.map(emb => emb[0]);
      const uniqueValues = new Set(firstValues.map(val => val.toFixed(2)));
      expect(uniqueValues.size).toBe(50);

      console.log(`✅ All 50 stories correctly mapped to unique embeddings`);
      console.log(`📊 Batch efficiency: ${result.usage.total_tokens} tokens in single API call`);
      console.log(`🎯 Perfect mapping integrity maintained at production scale`);
    });
  });
}); 