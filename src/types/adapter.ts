// ParsedItem interface for adapters (matches adapter_spec.md)
export interface ParsedItem {
  external_id: string;       // Unique ID from the source (e.g., RSS GUID, API ID)
  source_slug: string;       // Must match table `sources.name`
  title: string;             // Article headline/title
  url: string;               // Absolute HTTP(S) link to full article
  content: string;           // All content/summaries available from feed
  published_at: string;      // ISO 8601 timestamp (e.g., "2025-07-15T13:45:00Z")
  author?: string;           // Optional author name(s)
  image_url?: string;        // Optional featured image URL
  original_metadata: Record<string, unknown>; // Raw feed data payload (for debugging/replay)
} 