-- Migration: Create views and functions for analytics and search

-- Advanced search function for semantic similarity
CREATE OR REPLACE FUNCTION search_stories_by_similarity(
    query_embedding vector,
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    category_filter text DEFAULT NULL,
    source_filter integer DEFAULT NULL
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
    source_id integer,
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
FROM stories; 