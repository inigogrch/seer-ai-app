-- Migration: Create indexes for stories and feedback tables

-- Stories indexes
CREATE INDEX stories_published_at_desc_idx ON stories (published_at DESC);
CREATE INDEX stories_source_id_idx ON stories (source_id);
CREATE INDEX stories_story_category_idx ON stories (story_category) WHERE story_category IS NOT NULL;
CREATE INDEX stories_author_idx ON stories (author) WHERE author IS NOT NULL;
CREATE INDEX stories_title_text_idx ON stories USING gin (to_tsvector('english', title));
CREATE INDEX stories_content_text_idx ON stories USING gin (to_tsvector('english', content));
CREATE INDEX stories_summary_text_idx ON stories USING gin (to_tsvector('english', summary));
CREATE INDEX stories_tags_gin_idx ON stories USING gin (tags);
CREATE INDEX stories_original_metadata_gin_idx ON stories USING gin (original_metadata);
CREATE INDEX stories_tagging_metadata_gin_idx ON stories USING gin (tagging_metadata);
CREATE INDEX stories_embedding_cosine_idx ON stories 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100)
WHERE embedding IS NOT NULL;
CREATE INDEX stories_source_published_idx ON stories (source_id, published_at DESC);
CREATE INDEX stories_category_published_idx ON stories (story_category, published_at DESC)
WHERE story_category IS NOT NULL;

-- Feedback indexes
CREATE INDEX feedback_user_id_idx ON feedback (user_id);
CREATE INDEX feedback_story_id_idx ON feedback (story_id);
CREATE INDEX feedback_created_at_idx ON feedback (created_at DESC); 