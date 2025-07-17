-- Migration: Create tables for sources, stories, and feedback

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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT NOT NULL,
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    author TEXT,
    image_url TEXT,
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    story_category TEXT,
    tags TEXT[] DEFAULT '{}',
    embedding vector(1536),
    embedding_model TEXT DEFAULT 'text-embedding-3-small',
    embedding_generated_at TIMESTAMP WITH TIME ZONE,
    original_metadata JSONB DEFAULT '{}'::JSONB,
    tagging_metadata JSONB DEFAULT '{}'::JSONB,
    CONSTRAINT stories_external_id_source_unique UNIQUE (external_id, source_id),
    CONSTRAINT stories_url_unique UNIQUE (url),
    CONSTRAINT stories_story_category_check CHECK (
        story_category IS NULL OR 
        story_category IN ('research', 'news', 'tools', 'analysis', 'tutorial', 'announcement')
    )
);

-- Feedback table for user interactions
CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    score INTEGER CHECK (score IN (-1, 1)),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, story_id)
); 