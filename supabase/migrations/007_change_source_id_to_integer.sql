-- Migration: Change source_id from UUID to INTEGER safely

-- Drop the foreign key constraint first
ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_source_id_fkey CASCADE;

-- Create the sequence for sources table
CREATE SEQUENCE IF NOT EXISTS sources_id_seq;

-- Create a temporary mapping table to preserve source relationships
CREATE TABLE source_id_mapping (
    old_uuid UUID PRIMARY KEY,
    new_id INTEGER
);

-- Populate the mapping table with existing sources using row_number() for consistent IDs
INSERT INTO source_id_mapping (old_uuid, new_id)
SELECT id, row_number() OVER (ORDER BY created_at, name) as new_id
FROM sources;

-- Update the sequence to start from the next available number
SELECT setval('sources_id_seq', (SELECT MAX(new_id) FROM source_id_mapping));

-- Drop existing foreign key constraint (use CASCADE to handle dependent objects)
ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_source_id_fkey CASCADE;

-- Add a new integer column to sources table
ALTER TABLE sources ADD COLUMN id_new INTEGER;

-- Populate the new integer column using our mapping
UPDATE sources 
SET id_new = (SELECT new_id FROM source_id_mapping WHERE old_uuid = sources.id);

-- Add a new integer column to stories table  
ALTER TABLE stories ADD COLUMN source_id_new INTEGER;

-- Update stories to use the new integer source_id
UPDATE stories 
SET source_id_new = (SELECT new_id FROM source_id_mapping WHERE old_uuid = stories.source_id);

-- Drop all views that depend on source_id before modifying tables
DROP VIEW IF EXISTS story_analytics CASCADE;
DROP VIEW IF EXISTS story_cards CASCADE;
DROP VIEW IF EXISTS stories_missing_embeddings CASCADE;
DROP VIEW IF EXISTS stories_missing_metadata CASCADE;

-- Now drop the old UUID columns and rename the new ones
ALTER TABLE sources DROP COLUMN id;
ALTER TABLE sources RENAME COLUMN id_new TO id;
ALTER TABLE sources ADD PRIMARY KEY (id);
ALTER TABLE sources ALTER COLUMN id SET DEFAULT nextval('sources_id_seq');

ALTER TABLE stories DROP COLUMN source_id;
ALTER TABLE stories RENAME COLUMN source_id_new TO source_id;
ALTER TABLE stories ALTER COLUMN source_id SET NOT NULL;

-- Re-add the foreign key constraint
ALTER TABLE stories 
    ADD CONSTRAINT stories_source_id_fkey 
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE;

-- Drop the mapping table
DROP TABLE source_id_mapping;

-- Recreate views
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

-- Recreate missing data monitoring views
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
FROM stories;