-- Migration: Change source_id from UUID to INTEGER for compatibility with ingestionAgent

-- First, drop the foreign key constraint
ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_source_id_fkey;

-- Drop existing data (since we're changing fundamental types)
TRUNCATE TABLE stories;
TRUNCATE TABLE sources RESTART IDENTITY CASCADE;

-- Change sources table to use SERIAL (auto-incrementing integer) for id
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_pkey;
ALTER TABLE sources DROP COLUMN IF EXISTS id;
ALTER TABLE sources ADD COLUMN id SERIAL PRIMARY KEY;

-- Change stories table source_id to INTEGER
ALTER TABLE stories ALTER COLUMN source_id TYPE INTEGER USING source_id::INTEGER;

-- Re-add the foreign key constraint
ALTER TABLE stories ADD CONSTRAINT stories_source_id_fkey 
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE;

-- Update any views that might reference the old UUID structure
DROP VIEW IF EXISTS story_analytics CASCADE;
DROP VIEW IF EXISTS story_cards CASCADE;

-- Recreate views with INTEGER source_id
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
WHERE s.published_at > NOW() - INTERVAL '90 days'
ORDER BY boosted_score DESC, s.published_at DESC; 