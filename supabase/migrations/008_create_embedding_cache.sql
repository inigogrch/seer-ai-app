-- Migration: Create embedding cache table for performance optimization

-- Create embedding cache table
CREATE TABLE IF NOT EXISTS embedding_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_hash TEXT NOT NULL UNIQUE, -- Deterministic hash of input text
    input_text_preview TEXT NOT NULL, -- First 200 chars for debugging/monitoring
    embedding vector(1536) NOT NULL, -- Cached embedding vector
    model_name TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    access_count INTEGER DEFAULT 1, -- Track how often this embedding is reused
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(content_hash);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_expires ON embedding_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_model ON embedding_cache(model_name);

-- Add function to clean up expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_embeddings()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM embedding_cache 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Log cleanup activity
    INSERT INTO embedding_cache_metrics (event_type, count, timestamp)
    VALUES ('cache_cleanup', deleted_count, NOW())
    ON CONFLICT DO NOTHING;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create metrics table for cache performance tracking
CREATE TABLE IF NOT EXISTS embedding_cache_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL, -- 'hit', 'miss', 'cache_cleanup', 'eviction'
    count INTEGER DEFAULT 1,
    model_name TEXT DEFAULT 'text-embedding-3-small',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::JSONB
);

-- Add index for metrics queries
CREATE INDEX IF NOT EXISTS idx_cache_metrics_type_time ON embedding_cache_metrics(event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_cache_metrics_model ON embedding_cache_metrics(model_name);

-- Function to update cache access statistics
CREATE OR REPLACE FUNCTION update_cache_access(cache_hash TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE embedding_cache 
    SET 
        access_count = access_count + 1,
        last_accessed_at = NOW()
    WHERE content_hash = cache_hash;
END;
$$ LANGUAGE plpgsql;

-- Create view for cache performance monitoring
CREATE OR REPLACE VIEW embedding_cache_stats AS
SELECT
    event_type,
    COUNT(*) as total_events,
    MAX(timestamp) as last_occurrence,
    EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 3600 as time_span_hours
FROM embedding_cache_metrics
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY event_type
ORDER BY total_events DESC;

-- Add comments for documentation
COMMENT ON TABLE embedding_cache IS 'Cache table for OpenAI embedding vectors to reduce API calls and costs';
COMMENT ON COLUMN embedding_cache.content_hash IS 'SHA-256 hash of concatenated title and content text';
COMMENT ON COLUMN embedding_cache.expires_at IS 'TTL expiration timestamp (default 30 days from creation)';
COMMENT ON COLUMN embedding_cache.access_count IS 'Number of times this cached embedding has been retrieved';

COMMENT ON TABLE embedding_cache_metrics IS 'Performance metrics for embedding cache hit/miss rates';
COMMENT ON FUNCTION cleanup_expired_embeddings() IS 'Maintenance function to remove expired cache entries';
COMMENT ON FUNCTION update_cache_access(TEXT) IS 'Update access statistics when cache entry is retrieved'; 