# Adapter Specification for Seer.ai

Each adapter module is responsible for fetching raw feed entries (RSS, JSON API, web scrape), normalizing them, and outputting a uniform shape that the IngestionAgent can process seamlessly.

---

## 1. Module Structure

- **Location:** `src/adapters/{sourceSlug}.ts`
- **Exported Function:** `export async function fetchAndParse(): Promise<ParsedItem[]>`
- **Naming Convention:** Filename matches `source_slug` in `sources` table (e.g., `dbtLabs.ts` for slug "dbtLabs").

---

## 2. ParsedItem Schema

```ts
interface ParsedItem {
  external_id: string;       // Unique ID from the source (e.g., RSS GUID, API ID)
  source_slug: string;       // Must match table `sources.name`
  title: string;             // Article headline/title
  url: string;               // Absolute HTTP(S) link to full article
  content: string;           // All content/summaries available from feed
  published_at: string;      // ISO 8601 timestamp (e.g., "2025-07-15T13:45:00Z")
  author?: string;           // Optional author name(s)
  image_url?: string;        // Optional featured image URL
  original_metadata: any;    // Raw feed data payload (for debugging/replay)
}
```

---

## 3. Responsibilities

1. **Fetch Data**

   - Use appropriate fetch method (`fetch`, `axios`) for RSS, JSON, or web scrape.
   - Handle pagination, rate limits, and HTTP errors gracefully.

2. **Deduplicate**

   - Compare incoming `external_id`s against a cache or previous ingest checkpoint.
   - Return only new or changed items; avoid duplicates.

3. **Normalize Fields**

   - Trim leading/trailing whitespace.
   - Strip zero-width and non-printable characters.
   - Validate `published_at`; if missing or invalid, default to current timestamp.
   - Ensure `url` is absolute; resolve relative URLs.

4. **Fallback Logic**

   - If `content` is missing, temporarily set to `""` (agent will fallback to extracting full content).
   - If `image_url` is missing or invalid, omit the property.

5. **Construct ParsedItem[]**

   - Populate all required fields.
   - Attach `original_metadata` as the full raw item payload.

6. **Error Handling & Metrics**

   - Catch parse errors (e.g., invalid XML/JSON) and log with `source_slug` context.
   - Return `[]` on failure to avoid blocking pipeline.
   - Emit metrics: `adapter_{source_slug}_latency_ms`, `adapter_{source_slug}_error_count`.

---

## 4. Adapter Endpoints & Source Slugs

| Source          | Slug(s)                                                               | Type       | Endpoint(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| arXiv           | arxiv\_cs, arxiv\_stat                                                | RSS        | [https://rss.arxiv.org/rss/cs](https://rss.arxiv.org/rss/cs)[https://rss.arxiv.org/rss/stat](https://rss.arxiv.org/rss/stat)                                                                                                                                                                                                                                                                                                                                                         |
| Ars Technica    | arstechnica                                                           | RSS        | [https://feeds.arstechnica.com/arstechnica/index](https://feeds.arstechnica.com/arstechnica/index)                                                                                                                                                                                                                                                                                                                                                                                   |
| AWS Blogs       | aws\_big\_data, aws\_ml, aws\_startups, aws\_developer, aws\_database | RSS        | [https://aws.amazon.com/blogs/big-data/feed/](https://aws.amazon.com/blogs/big-data/feed/)[https://aws.amazon.com/blogs/machine-learning/feed/](https://aws.amazon.com/blogs/machine-learning/feed/)[https://aws.amazon.com/blogs/startups/feed/](https://aws.amazon.com/blogs/startups/feed/)[https://aws.amazon.com/blogs/developer/feed/](https://aws.amazon.com/blogs/developer/feed/)[https://aws.amazon.com/blogs/database/feed/](https://aws.amazon.com/blogs/database/feed/) |
| Google Research | google\_research                                                      | Web Scrape | [https://research.google/blog/](https://research.google/blog/)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| HuggingFace     | huggingface\_papers                                                   | Web Scrape | [https://huggingface.co/papers](https://huggingface.co/papers)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Anthropic News  | anthropic\_news                                                       | Web Scrape | [https://www.anthropic.com/news](https://www.anthropic.com/news)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hacker News     | hackernews                                                            | API        | [https://github.com/HackerNews/API](https://github.com/HackerNews/API)                                                                                                                                                                                                                                                                                                                                                                                                               |
| Microsoft 365   | microsoft365\_insider, excel\_blog                      | RSS        | [https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=Microsoft365InsiderBlog](https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=Microsoft365InsiderBlog)[https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=ExcelBlog](https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=ExcelBlog)                 |
| MIT News        | mit\_research, mit\_data, mit\_ai                                     | RSS        | [https://news.mit.edu/rss/research](https://news.mit.edu/rss/research)[https://news.mit.edu/topic/mitdata-rss.xml](https://news.mit.edu/topic/mitdata-rss.xml)[https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml](https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml)                                                                                                                                                                                       |
| MIT Sloan       | mit\_sloan                                                            | RSS        | [https://sloanreview.mit.edu/feed/](https://sloanreview.mit.edu/feed/)                                                                                                                                                                                                                                                                                                                                                                                                               |
| OpenAI News     | openai\_news                                                          | RSS        | [https://openai.com/news/rss.xml](https://openai.com/news/rss.xml)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| TechCrunch      | techcrunch                                                            | RSS        | [https://techcrunch.com/feed/](https://techcrunch.com/feed/)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| TLDR            | tldr\_tech                                                            | RSS        | [https://tldr.tech/api/rss/tech](https://tldr.tech/api/rss/tech)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| VentureBeat     | venturebeat                                                           | RSS        | [https://venturebeat.com/feed/](https://venturebeat.com/feed/)                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Deduplication note:** \*\*`huggingface_papers` overlap with arXiv—ensure dedupe on `external_id` & URL.



---

## 5. Example Adapter Template

```ts
// src/adapters/techCrunch.ts
import Parser from 'rss-parser';
import type { ParsedItem } from '../types';

const parser = new Parser();

export async function fetchAndParse(): Promise<ParsedItem[]> {
  try {
    const feed = await parser.parseURL('https://techcrunch.com/feed/');
    return feed.items.map(item => ({
      external_id: item.guid || item.link,
      source_slug: 'techCrunch',
      title: item.title || '',
      url: item.link || '',
      summary: item.contentSnippet || item.content || '',
      published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      author: item.creator,
      image_url: extractImageUrl(item),
      original_metadata: item,
    })).filter(i => i.external_id && i.url);
  } catch (err) {
    console.error('TechCrunch adapter error:', err);
    return [];
  }
}

function extractImageUrl(item: any): string | undefined {
  // Attempt to pull from media:content or enclosure
  return item.enclosure?.url || item['media:content']?.['$']?.url;
}
```

---

## 6. Integration with IngestionAgent

- **fetchAdapterData Tool** will call `fetchAndParse()` and receive `ParsedItem[]`.
- Agent then applies full-content fetch, extraction, embedding, and upsert.

*Ensure all adapters adhere to this spec for a flawless ingestion pipeline.*

