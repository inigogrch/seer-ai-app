/**
 * Comprehensive upsertSupabase Tests
 * 
 * Tests the final step in ingestion pipeline: storing stories with embeddings
 * Validates: insert/update operations, duplicate prevention, error handling
 */

import { upsertSupabaseExecute } from '../ingestion-helpers';
import { createClient } from '@supabase/supabase-js';

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn()
}));

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

describe('upsertSupabase Database Operations', () => {

  let mockSupabase: any;
  let mockFrom: jest.Mock;
  let mockUpsert: jest.Mock;
  let mockSelect: jest.Mock;
  let mockSingle: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Supabase mock chain
    mockSingle = jest.fn();
    mockSelect = jest.fn(() => ({ single: mockSingle }));
    mockUpsert = jest.fn(() => ({ select: mockSelect }));
    mockFrom = jest.fn(() => ({ upsert: mockUpsert }));
    
    mockSupabase = {
      from: mockFrom
    };
    
    mockCreateClient.mockReturnValue(mockSupabase);
  });

  describe('Insert Operations (New Stories)', () => {
    it('should insert a brand-new story record and return operation: "insert"', async () => {
      const newStory = {
        external_id: 'openai-sora-2024',
        source_id: 1,
        title: 'OpenAI Announces Sora AI Video Generator',
        url: 'https://openai.com/blog/sora',
        author: 'OpenAI Team',
        published_at: '2024-02-15T10:00:00Z',
        summary: null,
        content: 'OpenAI today announced Sora, a groundbreaking AI model that can create realistic videos from text descriptions.',
        embedding: new Array(1536).fill(0).map(() => Math.random()),
        metadata: {
          source_name: 'OpenAI Blog',
          category: 'AI Research',
          tags: ['AI', 'Video Generation', 'Sora']
        }
      };

      // Mock successful insert (created_at === updated_at indicates new record)
      const insertTimestamp = '2024-02-15T10:30:00Z';
      const mockInsertedData = {
        id: 123,
        external_id: newStory.external_id,
        source_id: newStory.source_id,
        title: newStory.title,
        url: newStory.url,
        author: newStory.author,
        published_at: newStory.published_at,
        summary: newStory.summary,
        content: newStory.content,
        embedding: newStory.embedding,
        original_metadata: newStory.metadata,
        created_at: insertTimestamp,
        updated_at: insertTimestamp // Same as created_at = INSERT
      };

      mockSingle.mockResolvedValueOnce({
        data: mockInsertedData,
        error: null
      });

      console.log('\n🧪 Testing new story insertion...\n');

      const result = await upsertSupabaseExecute({ story: newStory });

      // Validate successful insert
      expect(result.success).toBe(true);
      expect(result.operation).toBe('insert');
      expect(result.data).toEqual(mockInsertedData);

      // Verify Supabase was called correctly
      expect(mockFrom).toHaveBeenCalledWith('stories');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          external_id: newStory.external_id,
          source_id: newStory.source_id,
          title: newStory.title,
          url: newStory.url,
          author: newStory.author,
          published_at: newStory.published_at,
          summary: newStory.summary,
          content: newStory.content,
          embedding: newStory.embedding,
          original_metadata: newStory.metadata,
          updated_at: expect.any(String)
        }),
        {
          onConflict: 'external_id,source_id',
          ignoreDuplicates: false
        }
      );

      console.log(`✅ Successfully inserted story: ${result.data.title}`);
      console.log(`📊 Operation: ${result.operation}, ID: ${result.data.id}`);
      console.log(`🔗 Mapping: external_id(${result.data.external_id}) → database_id(${result.data.id})`);
    });

    it('should handle story with embedding array correctly', async () => {
      const storyWithEmbedding = {
        external_id: 'tech-news-001',
        source_id: 2,
        title: 'TechCrunch: AI Startup Funding',
        url: 'https://techcrunch.com/ai-startup-funding',
        author: 'TechCrunch Staff',
        published_at: '2024-02-16T14:30:00Z',
        summary: null,
        content: 'A comprehensive analysis of AI startup funding trends in 2024.',
        embedding: new Array(1536).fill(0).map((_, i) => i * 0.001), // Specific pattern
        metadata: { category: 'Funding' }
      };

      const mockData = {
        id: 124,
        ...storyWithEmbedding,
        original_metadata: storyWithEmbedding.metadata,
        created_at: '2024-02-16T15:00:00Z',
        updated_at: '2024-02-16T15:00:00Z'
      };

      mockSingle.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      console.log('\n🧪 Testing story with 1536D embedding...\n');

      const result = await upsertSupabaseExecute({ story: storyWithEmbedding });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('insert');
      expect(result.data.embedding).toHaveLength(1536);
      expect(result.data.embedding[0]).toBe(0);
      expect(result.data.embedding[1]).toBe(0.001);
      expect(result.data.embedding[100]).toBe(0.1);

      console.log(`✅ Embedding stored: ${result.data.embedding.length} dimensions`);
      console.log(`🔢 Sample values: [${result.data.embedding.slice(0, 3).join(', ')}...]`);
    });

    it('should handle null/optional fields correctly', async () => {
      const minimalStory = {
        external_id: 'minimal-001',
        source_id: 3,
        title: 'Minimal Story Title',
        url: 'https://example.com/minimal',
        author: null, // Null author
        published_at: null, // Null publish date
        summary: null,
        content: null, // Null content (metadata-only story)
        embedding: null, // Null embedding
        metadata: null // Null metadata
      };

      const mockData = {
        id: 125,
        ...minimalStory,
        original_metadata: null,
        created_at: '2024-02-16T16:00:00Z',
        updated_at: '2024-02-16T16:00:00Z'
      };

      mockSingle.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      console.log('\n🧪 Testing minimal story with null fields...\n');

      const result = await upsertSupabaseExecute({ story: minimalStory });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('insert');
      expect(result.data.author).toBeNull();
      expect(result.data.published_at).toBeNull();
      expect(result.data.content).toBeNull();
      expect(result.data.embedding).toBeNull();
      expect(result.data.original_metadata).toBeNull();

      console.log(`✅ Minimal story handled: ${result.data.title}`);
      console.log(`📝 Null fields preserved: author, published_at, content, embedding, metadata`);
    });
  });

  describe('Update Operations (Existing Stories)', () => {
    it('should re-upsert same story with modified fields and return operation: "update"', async () => {
      const originalStory = {
        external_id: 'openai-gpt4o-mini',
        source_id: 1,
        title: 'Introducing GPT-4o mini',
        url: 'https://openai.com/blog/gpt-4o-mini',
        author: 'OpenAI Team',
        published_at: '2024-07-18T09:00:00Z',
        summary: 'Initial summary',
        content: 'Original content about GPT-4o mini.',
        embedding: new Array(1536).fill(0.1),
        metadata: { version: 'v1' }
      };

      // First, simulate the story was previously inserted
      console.log('\n🧪 Testing story update operation...\n');
      console.log('📝 Simulating existing story update with enriched content...');

      // Updated story with enriched content and new embedding
      const updatedStory = {
        ...originalStory,
        summary: 'Updated comprehensive summary of GPT-4o mini capabilities',
        content: 'Enriched content with full article text extracted from web scraping. GPT-4o mini is our most cost-efficient small model...',
        embedding: new Array(1536).fill(0.2), // New embedding
        metadata: { 
          version: 'v2', 
          enriched: true,
          extraction_date: '2024-02-16T17:00:00Z'
        }
      };

      // Mock update response (created_at !== updated_at indicates update)
      const mockUpdatedData = {
        id: 126,
        external_id: updatedStory.external_id,
        source_id: updatedStory.source_id,
        title: updatedStory.title,
        url: updatedStory.url,
        author: updatedStory.author,
        published_at: updatedStory.published_at,
        summary: updatedStory.summary,
        content: updatedStory.content,
        embedding: updatedStory.embedding,
        original_metadata: updatedStory.metadata,
        created_at: '2024-07-18T10:00:00Z', // Original creation time
        updated_at: '2024-02-16T17:00:00Z'  // Different = UPDATE
      };

      mockSingle.mockResolvedValueOnce({
        data: mockUpdatedData,
        error: null
      });

      const result = await upsertSupabaseExecute({ story: updatedStory });

      // Validate successful update
      expect(result.success).toBe(true);
      expect(result.operation).toBe('update');
      expect(result.data).toEqual(mockUpdatedData);

      // Verify updated fields
      expect(result.data.summary).toBe(updatedStory.summary);
      expect(result.data.content).toContain('Enriched content');
      expect(result.data.embedding[0]).toBe(0.2); // New embedding
      expect(result.data.original_metadata.version).toBe('v2');
      expect(result.data.original_metadata.enriched).toBe(true);

      console.log(`✅ Successfully updated story: ${result.data.title}`);
      console.log(`🔄 Operation: ${result.operation}`);
      console.log(`📊 Content length: ${originalStory.content.length} → ${result.data.content.length} chars`);
      console.log(`🔢 Embedding: [${originalStory.embedding[0]}] → [${result.data.embedding[0]}]`);
      console.log(`📅 Timeline: created(${result.data.created_at}) → updated(${result.data.updated_at})`);
    });

    it('should prevent duplicate entries with same external_id and source_id', async () => {
      const duplicateStory = {
        external_id: 'duplicate-test',
        source_id: 1,
        title: 'First Title',
        url: 'https://example.com/first',
        author: 'Author One',
        published_at: '2024-02-16T10:00:00Z',
        summary: null,
        content: 'First content',
        embedding: new Array(1536).fill(0.1),
        metadata: { attempt: 1 }
      };

      // Mock first upsert (insert)
      const firstInsertData = {
        id: 127,
        ...duplicateStory,
        original_metadata: duplicateStory.metadata,
        created_at: '2024-02-16T18:00:00Z',
        updated_at: '2024-02-16T18:00:00Z'
      };

      mockSingle.mockResolvedValueOnce({
        data: firstInsertData,
        error: null
      });

      console.log('\n🧪 Testing duplicate prevention...\n');

      const firstResult = await upsertSupabaseExecute({ story: duplicateStory });
      expect(firstResult.success).toBe(true);
      expect(firstResult.operation).toBe('insert');

      // Now try to insert "duplicate" with same external_id + source_id
      const attemptedDuplicate = {
        ...duplicateStory,
        title: 'Second Title', // Different title
        content: 'Second content', // Different content
        metadata: { attempt: 2 }
      };

      // Mock second upsert (should update, not create duplicate)
      const updateData = {
        id: 127, // Same ID - no duplicate created
        external_id: duplicateStory.external_id,
        source_id: duplicateStory.source_id,
        title: attemptedDuplicate.title, // Updated
        url: duplicateStory.url,
        author: duplicateStory.author,
        published_at: duplicateStory.published_at,
        summary: null,
        content: attemptedDuplicate.content, // Updated
        embedding: duplicateStory.embedding,
        original_metadata: attemptedDuplicate.metadata,
        created_at: '2024-02-16T18:00:00Z', // Original creation
        updated_at: '2024-02-16T18:05:00Z'  // Updated time
      };

      mockSingle.mockResolvedValueOnce({
        data: updateData,
        error: null
      });

      const secondResult = await upsertSupabaseExecute({ story: attemptedDuplicate });

      expect(secondResult.success).toBe(true);
      expect(secondResult.operation).toBe('update'); // Not insert!
      expect(secondResult.data.id).toBe(127); // Same ID - no duplicate
      expect(secondResult.data.title).toBe('Second Title'); // Updated
      expect(secondResult.data.content).toBe('Second content'); // Updated

      console.log(`✅ Duplicate prevention works: ${firstResult.data.id} === ${secondResult.data.id}`);
      console.log(`🔄 First operation: ${firstResult.operation}, Second: ${secondResult.operation}`);
      console.log(`📝 Title updated: "${firstResult.data.title}" → "${secondResult.data.title}"`);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const story = {
        external_id: 'error-test-001',
        source_id: 1,
        title: 'Error Test Story',
        url: 'https://example.com/error',
        author: 'Test Author',
        published_at: '2024-02-16T20:00:00Z',
        summary: null,
        content: 'Test content',
        embedding: new Array(1536).fill(0.5),
        metadata: null
      };

      // Mock database connection error
      mockSingle.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      console.log('\n🧪 Testing database connection error...\n');

      const result = await upsertSupabaseExecute({ story });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
      expect(result.data).toBeNull();

      console.log(`❌ Database error handled: ${result.error}`);
    });

    it('should handle constraint violation errors', async () => {
      const story = {
        external_id: 'constraint-test',
        source_id: 999, // Invalid source_id
        title: 'Constraint Test',
        url: 'https://example.com/constraint',
        author: 'Test Author',
        published_at: '2024-02-16T21:00:00Z',
        summary: null,
        content: 'Test content',
        embedding: new Array(1536).fill(0.7),
        metadata: null
      };

      // Mock foreign key constraint error
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: new Error('insert or update on table "stories" violates foreign key constraint "stories_source_id_fkey"')
      });

      console.log('\n Testing constraint violation error...\n');

      const result = await upsertSupabaseExecute({ story });

      expect(result.success).toBe(false);
      expect(result.error).toContain('violates foreign key constraint');
      expect(result.data).toBeNull();

      console.log(`❌ Constraint error handled: ${result.error}`);
    });

    it('should handle malformed data errors', async () => {
      const malformedStory = {
        external_id: 'malformed-test',
        source_id: 1,
        title: 'Malformed Test',
        url: 'invalid-url', // Invalid URL format
        author: 'Test Author',
        published_at: 'invalid-date', // Invalid date format
        summary: null,
        content: 'Test content',
        embedding: [1, 2, 3], // Wrong embedding dimensions
        metadata: null
      };

      // Mock data validation error
      mockSingle.mockRejectedValueOnce(
        new Error('invalid input syntax for type timestamp')
      );

      console.log('\n🧪 Testing malformed data error...\n');

      const result = await upsertSupabaseExecute({ story: malformedStory });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid input syntax');
      expect(result.data).toBeNull();

      console.log(`❌ Malformed data error handled: ${result.error}`);
    });

    it('should handle network/timeout errors', async () => {
      const story = {
        external_id: 'network-test',
        source_id: 1,
        title: 'Network Test',
        url: 'https://example.com/network',
        author: 'Test Author',
        published_at: '2024-02-16T22:00:00Z',
        summary: null,
        content: 'Test content',
        embedding: new Array(1536).fill(0.9),
        metadata: null
      };

      // Mock network timeout error
      mockSingle.mockRejectedValueOnce(
        new Error('Network timeout: Request took longer than 30000ms to complete')
      );

      console.log('\n🧪 Testing network timeout error...\n');

      const result = await upsertSupabaseExecute({ story });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
      expect(result.data).toBeNull();

      console.log(`❌ Network error handled: ${result.error}`);
    });
  });

  describe('Edge Cases and Data Validation', () => {
    it('should handle very long content', async () => {
      const longContent = 'This is a very long article. '.repeat(10000); // ~290,000 chars
      
      const storyWithLongContent = {
        external_id: 'long-content-test',
        source_id: 1,
        title: 'Long Content Test Article',
        url: 'https://example.com/long-content',
        author: 'Prolific Author',
        published_at: '2024-02-16T23:00:00Z',
        summary: null,
        content: longContent,
        embedding: new Array(1536).fill(0.123),
        metadata: { content_length: longContent.length }
      };

      const mockData = {
        id: 128,
        ...storyWithLongContent,
        original_metadata: storyWithLongContent.metadata,
        created_at: '2024-02-16T23:00:00Z',
        updated_at: '2024-02-16T23:00:00Z'
      };

      mockSingle.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      console.log(`\n🧪 Testing very long content (${longContent.length} chars)...\n`);

      const result = await upsertSupabaseExecute({ story: storyWithLongContent });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('insert');
      expect(result.data.content).toHaveLength(longContent.length);
      expect(result.data.original_metadata.content_length).toBe(longContent.length);

      console.log(`✅ Long content handled: ${result.data.content.length} characters stored`);
    });

    it('should handle special characters and Unicode', async () => {
      const storyWithSpecialChars = {
        external_id: 'unicode-test-🤖',
        source_id: 1,
        title: 'AI Research: 人工智能 & Machine Learning 🧠',
        url: 'https://example.com/unicode-test',
        author: 'Dr. José María García-González',
        published_at: '2024-02-17T00:00:00Z',
        summary: null,
        content: 'Article about AI: 机器学习, النداء الاصطناعي, Künstliche Intelligenz, and 🤖🧠💡',
        embedding: new Array(1536).fill(0.456),
        metadata: {
          language: 'multilingual',
          special_chars: true,
          emoji_count: 3
        }
      };

      const mockData = {
        id: 129,
        ...storyWithSpecialChars,
        original_metadata: storyWithSpecialChars.metadata,
        created_at: '2024-02-17T00:00:00Z',
        updated_at: '2024-02-17T00:00:00Z'
      };

      mockSingle.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      console.log('\n🧪 Testing special characters and Unicode...\n');

      const result = await upsertSupabaseExecute({ story: storyWithSpecialChars });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('insert');
      expect(result.data.external_id).toBe('unicode-test-🤖');
      expect(result.data.title).toContain('人工智能');
      expect(result.data.title).toContain('🧠');
      expect(result.data.author).toBe('Dr. José María García-González');
      expect(result.data.content).toContain('机器学习');
      expect(result.data.content).toContain('🤖🧠💡');

      console.log(`✅ Unicode handled: ${result.data.title}`);
      console.log(`👤 Author: ${result.data.author}`);
      console.log(`🌍 Content: ${result.data.content.substring(0, 50)}...`);
    });

    it('should maintain embedding array integrity', async () => {
      // Create a specific embedding pattern for validation
      const specificEmbedding = new Array(1536).fill(0).map((_, i) => {
        if (i < 10) return i * 0.1; // First 10: 0, 0.1, 0.2, ..., 0.9
        if (i < 20) return -(i - 10) * 0.1; // Next 10: 0, -0.1, -0.2, ..., -0.9
        return Math.sin(i * 0.01); // Rest: sine wave pattern
      });

      const storyWithSpecificEmbedding = {
        external_id: 'embedding-integrity-test',
        source_id: 1,
        title: 'Embedding Integrity Test',
        url: 'https://example.com/embedding-test',
        author: 'Test Author',
        published_at: '2024-02-17T01:00:00Z',
        summary: null,
        content: 'Testing embedding array integrity during database storage.',
        embedding: specificEmbedding,
        metadata: { embedding_pattern: 'test_pattern_v1' }
      };

      const mockData = {
        id: 130,
        ...storyWithSpecificEmbedding,
        original_metadata: storyWithSpecificEmbedding.metadata,
        created_at: '2024-02-17T01:00:00Z',
        updated_at: '2024-02-17T01:00:00Z'
      };

      mockSingle.mockResolvedValueOnce({
        data: mockData,
        error: null
      });

      console.log('\n🧪 Testing embedding array integrity...\n');

      const result = await upsertSupabaseExecute({ story: storyWithSpecificEmbedding });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('insert');
      expect(result.data.embedding).toHaveLength(1536);
      
      // Validate specific pattern preservation
      expect(result.data.embedding[0]).toBe(0);
      expect(result.data.embedding[1]).toBe(0.1);
      expect(result.data.embedding[9]).toBe(0.9);
      expect(result.data.embedding[10]).toBeCloseTo(0, 10); // Use toBeCloseTo for floating point
      expect(result.data.embedding[11]).toBe(-0.1);
      expect(result.data.embedding[19]).toBe(-0.9);
      
      // Validate sine wave portion
      expect(result.data.embedding[100]).toBeCloseTo(Math.sin(100 * 0.01), 5);
      expect(result.data.embedding[500]).toBeCloseTo(Math.sin(500 * 0.01), 5);

      console.log(`✅ Embedding integrity verified: ${result.data.embedding.length} dimensions`);
      console.log(`🔢 Pattern check: [${result.data.embedding.slice(0, 5).join(', ')}...]`);
      console.log(`📊 Sine portion: embedding[100] = ${result.data.embedding[100].toFixed(6)}`);
    });
  });
}); 