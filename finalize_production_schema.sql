-- Migration: Finalize Production Schema
-- Date: 2025-07-15
-- Description: Complete schema finalization with all required fields for production

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Drop redundant embeddings table (embedding is now on stories table)
DROP TABLE IF EXISTS embeddings CASCADE;

-- Ensure sources table has final structure
CREATE TABLE IF NOT EXISTS sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('rss', 'api', 'web_scrape')),
    endpoint_url TEXT NOT NULL,
    fetch_freq_min INTEGER NOT NULL DEFAULT 60,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create final stories table structure with all required fields
DROP TABLE IF EXISTS stories CASCADE;
CREATE TABLE stories (
    -- Primary key and identifiers
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT NOT NULL, -- From RSS GUID, API ID, etc.
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    
    -- Core content fields
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT, -- Short excerpt/description for summarization feat.
    author TEXT, -- Extracted author name
    image_url TEXT, -- Featured image for story cards
    
    -- Temporal data
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Categorization and tagging
    story_category TEXT, -- High-level category (research, news, tools, etc.)
    tags TEXT[] DEFAULT '{}', -- Array of content tags
    
    -- Vector embeddings for semantic search
    embedding vector(1536), -- OpenAI text-embedding-3-small
    embedding_model TEXT DEFAULT 'text-embedding-3-small',
    embedding_generated_at TIMESTAMP WITH TIME ZONE,
    
    -- Rich metadata storage
    original_metadata JSONB DEFAULT '{}'::JSONB, -- Complete source data
    tagging_metadata JSONB DEFAULT '{}'::JSONB, -- Tagging provenance and confidence
    
    -- Constraints
    CONSTRAINT stories_external_id_source_unique UNIQUE (external_id, source_id),
    CONSTRAINT stories_url_unique UNIQUE (url),
    CONSTRAINT stories_story_category_check CHECK (
        story_category IS NULL OR 
        story_category IN ('research', 'news', 'tools', 'analysis', 'tutorial', 'announcement')
    )
);

-- Create comprehensive indexes for performance
-- Primary access patterns
CREATE INDEX stories_published_at_desc_idx ON stories (published_at DESC);
CREATE INDEX stories_source_id_idx ON stories (source_id);
CREATE INDEX stories_story_category_idx ON stories (story_category) WHERE story_category IS NOT NULL;
CREATE INDEX stories_author_idx ON stories (author) WHERE author IS NOT NULL;

-- Text search indexes
CREATE INDEX stories_title_text_idx ON stories USING gin (to_tsvector('english', title));
CREATE INDEX stories_content_text_idx ON stories USING gin (to_tsvector('english', content));
CREATE INDEX stories_summary_text_idx ON stories USING gin (to_tsvector('english', summary));

-- Array and JSONB indexes
CREATE INDEX stories_tags_gin_idx ON stories USING gin (tags);
CREATE INDEX stories_original_metadata_gin_idx ON stories USING gin (original_metadata);
CREATE INDEX stories_tagging_metadata_gin_idx ON stories USING gin (tagging_metadata);

-- Vector similarity search index
CREATE INDEX stories_embedding_cosine_idx ON stories 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100)
WHERE embedding IS NOT NULL;

-- Compound indexes for common queries
CREATE INDEX stories_source_published_idx ON stories (source_id, published_at DESC);
CREATE INDEX stories_category_published_idx ON stories (story_category, published_at DESC)
WHERE story_category IS NOT NULL;

-- Feedback table for user interactions
CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    score INTEGER CHECK (score IN (-1, 1)), -- -1 for 👎, 1 for 👍
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, story_id)
);

-- Feedback indexes
CREATE INDEX feedback_user_id_idx ON feedback (user_id);
CREATE INDEX feedback_story_id_idx ON feedback (story_id);
CREATE INDEX feedback_created_at_idx ON feedback (created_at DESC);

-- Advanced search function for semantic similarity
CREATE OR REPLACE FUNCTION search_stories_by_similarity(
    query_embedding vector,
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    category_filter text DEFAULT NULL,
    source_filter uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    title text,
    url text,
    content text,
    summary text,
    author text,
    image_url text,
    published_at timestamp with time zone,
    story_category text,
    tags text[],
    source_id uuid,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        s.url,
        s.content,
        s.summary,
        s.author,
        s.image_url,
        s.published_at,
        s.story_category,
        s.tags,
        s.source_id,
        1 - (s.embedding <=> query_embedding) AS similarity
    FROM stories s
    WHERE s.embedding IS NOT NULL
        AND 1 - (s.embedding <=> query_embedding) > match_threshold
        AND (category_filter IS NULL OR s.story_category = category_filter)
        AND (source_filter IS NULL OR s.source_id = source_filter)
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Analytics view for dashboards and monitoring
CREATE OR REPLACE VIEW story_analytics AS
SELECT
    s.id,
    s.title,
    s.url,
    s.summary,
    s.author,
    s.image_url,
    s.published_at,
    s.story_category,
    s.tags,
    s.source_id,
    src.name AS source_name,
    src.type AS source_type,
    array_length(s.tags, 1) AS tag_count,
    CASE WHEN s.embedding IS NOT NULL THEN true ELSE false END AS has_embedding,
    s.tagging_metadata ->> 'adapter_name' AS tagging_adapter,
    (s.tagging_metadata ->> 'confidence_score')::NUMERIC AS tagging_confidence,
    COALESCE(f.avg_score, 0) AS avg_feedback_score,
    COALESCE(f.feedback_count, 0) AS feedback_count,
    length(s.content) AS content_length,
    (s.original_metadata ->> 'word_count')::INTEGER AS word_count
FROM stories s
LEFT JOIN sources src ON s.source_id = src.id
LEFT JOIN (
    SELECT 
        story_id,
        AVG(score::FLOAT) as avg_score,
        COUNT(*) as feedback_count
    FROM feedback
    GROUP BY story_id
) f ON s.id = f.story_id;

-- Story cards view optimized for UI display
CREATE OR REPLACE VIEW story_cards AS
SELECT
    s.id,
    s.title,
    s.url,
    s.summary,
    s.author,
    s.image_url,
    s.published_at,
    s.story_category,
    s.tags,
    src.name AS source_name,
    src.type AS source_type,
    COALESCE(f.avg_score, 0) AS relevance_score,
    -- Boost recent stories
    CASE 
        WHEN s.published_at > NOW() - INTERVAL '7 days' THEN 1.5
        WHEN s.published_at > NOW() - INTERVAL '30 days' THEN 1.0
        ELSE 0.5
    END * (COALESCE(f.avg_score, 0) + 1) AS boosted_score
FROM stories s
LEFT JOIN sources src ON s.source_id = src.id
LEFT JOIN (
    SELECT 
        story_id,
        AVG(score::FLOAT) as avg_score
    FROM feedback
    GROUP BY story_id
) f ON s.id = f.story_id
WHERE s.published_at > NOW() - INTERVAL '90 days' -- Only recent stories for performance
ORDER BY boosted_score DESC, s.published_at DESC;

-- Views for missing data monitoring
CREATE OR REPLACE VIEW stories_missing_embeddings AS
SELECT 
    id,
    title,
    url,
    source_id,
    published_at,
    created_at
FROM stories
WHERE embedding IS NULL
ORDER BY published_at DESC;

CREATE OR REPLACE VIEW stories_missing_metadata AS
SELECT 
    id,
    title,
    url,
    source_id,
    published_at,
    CASE WHEN summary IS NULL OR summary = '' THEN true ELSE false END AS missing_summary,
    CASE WHEN author IS NULL OR author = '' THEN true ELSE false END AS missing_author,
    CASE WHEN image_url IS NULL OR image_url = '' THEN true ELSE false END AS missing_image,
    CASE WHEN story_category IS NULL THEN true ELSE false END AS missing_category
FROM stories
WHERE (summary IS NULL OR summary = '') 
   OR (author IS NULL OR author = '')
   OR (image_url IS NULL OR image_url = '')
   OR story_category IS NULL
ORDER BY published_at DESC;

-- Add helpful comments
COMMENT ON TABLE stories IS 'Primary stories table with rich metadata for content discovery and personalization';
COMMENT ON COLUMN stories.external_id IS 'Unique identifier from source (RSS GUID, API ID, etc.) for deduplication';
COMMENT ON COLUMN stories.summary IS 'Short excerpt for story cards, extracted from description or content';
COMMENT ON COLUMN stories.author IS 'Author name extracted from RSS author, dc:creator, or content';
COMMENT ON COLUMN stories.image_url IS 'Featured image URL from media:content, enclosure, or og:image';
COMMENT ON COLUMN stories.story_category IS 'High-level content category for filtering and organization';
COMMENT ON COLUMN stories.tags IS 'Content-based tags for personalization and discovery';
COMMENT ON COLUMN stories.embedding IS 'Vector embedding for semantic search and similarity matching';
COMMENT ON COLUMN stories.original_metadata IS 'Complete source data preserved for replay and analysis';
COMMENT ON COLUMN stories.tagging_metadata IS 'Tagging provenance, confidence scores, and processing details';

COMMENT ON INDEX stories_embedding_cosine_idx IS 'Vector similarity search index for semantic discovery';
COMMENT ON INDEX stories_tags_gin_idx IS 'GIN index for efficient tag array queries';
COMMENT ON INDEX stories_title_text_idx IS 'Full-text search index for title content';

-- Insert/merge all Wave-1 feeds (unique name per endpoint)
INSERT INTO sources (name, type, endpoint_url, fetch_freq_min) VALUES
    -- Research
    ('arXiv Computer Science',          'rss',        'https://rss.arxiv.org/rss/cs',                                           60),
    ('arXiv Statistics',               'rss',        'https://rss.arxiv.org/rss/stat',                                         60),
    ('Hugging Face Papers',            'web_scrape', 'https://huggingface.co/papers',                                          1440),
    ('Google Research Blog',           'web_scrape', 'https://research.google/blog/',                                           360),
    ('MIT News Research',            'rss',        'https://news.mit.edu/rss/research',                                       720),
    ('MIT News Data',               'rss',        'https://news.mit.edu/topic/mitdata-rss.xml',                              720),
    ('MIT News AI',                 'rss',        'https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml',          720),

    -- Big-Tech Blogs
    ('AWS Big Data Blog',              'rss',        'https://aws.amazon.com/blogs/big-data/feed/',                              60),
    ('AWS Machine Learning Blog',      'rss',        'https://aws.amazon.com/blogs/machine-learning/feed/',                      60),
    ('AWS Startups Blog',              'rss',        'https://aws.amazon.com/blogs/startups/feed/',                              60),
    ('AWS Developer Blog',             'rss',        'https://aws.amazon.com/blogs/developer/feed/',                             60),
    ('AWS Database Blog',              'rss',        'https://aws.amazon.com/blogs/database/feed/',                              60),
    ('Microsoft 365 Insider Blog',     'rss',        'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=Microsoft365InsiderBlog', 120),
    ('Microsoft Excel Blog',           'rss',        'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=ExcelBlog',                  120),
    ('Microsoft Power BI Blog',        'rss',        'https://powerbi.microsoft.com/en-us/blog/feed/',                           120),
    ('OpenAI News',                    'rss',        'https://openai.com/news/rss.xml',                                          60),
    ('Anthropic News',                 'web_scrape', 'https://www.anthropic.com/news',                                         1440),

    -- News Updates
    ('Ars Technica',                   'rss',        'https://feeds.arstechnica.com/arstechnica/index',                          60),
    ('TechCrunch',                     'rss',        'https://techcrunch.com/feed/',                                             30),
    ('VentureBeat',                    'rss',        'https://venturebeat.com/feed/',                                            60),
    ('TLDR.tech (Tech Edition)',       'rss',        'https://tldr.tech/api/rss/tech',                                           720),
    ('Hacker News Top Stories',        'api',        'https://github.com/HackerNews/API',                                        15),
    ('MIT Sloan Management Review',    'rss',        'https://sloanreview.mit.edu/feed/',                                       1440)
ON CONFLICT (name) DO NOTHING;


-- Performance optimization settings
ANALYZE stories;
ANALYZE sources;
ANALYZE feedback; 