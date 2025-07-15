# IngestionAgent Specification for DataGate

This document defines the **IngestionAgent**—the orchestrator that ingests raw feed data, enriches it, and upserts it into Supabase using OpenAI Agents (openai-agents-js).

---

## 1. Overview

The **IngestionAgent** runs on an hourly cron, leveraging adapter modules to fetch raw metadata, then:

1. **Fetches full article content** when available
2. **Sanitizes** and extracts core fields
3. **Generates embeddings** via OpenAI
4. **Upserts** stories into Supabase

It uses the [openai-agents-js](https://openai.github.io/openai-agents-js/) framework to define tools, context, and the agent’s planning/execution loop.

---

## 2. Environment & Dependencies

- **Runtime:** Node.js 18+ (ESM)
- **Agent Library:** `openai-agents-js`
- **Database Client:** `@supabase/supabase-js`
- **HTTP Client:** native `fetch` or `axios`
- **HTML Parser:** `@mozilla/readability` or `turndown`
- **Concurrency Control:** `p-limit` (limit to 4 parallel fetches)
- **Logging & Metrics:** `logflare` / `Datadog` / custom logger

---

## 3. Configuration & Credentials

Store in `.env` (Vercel encrypted env):

```
OPENAI_API_KEY=...
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_KEY=...
CONCURRENCY_LIMIT=4
FEED_SOURCES_TABLE=“sources”
STORIES_TABLE=“stories”
```

---

## 4. Agent Tools Definition

Define reusable **tools** for your agent in `tools.ts`:

```ts
import { Tool } from 'openai-agents-js';
import { createClient } from '@supabase/supabase-js';

export const fetchAdapterData: Tool = {
  name: 'fetchAdapterData',
  description: 'Call adapter.fetchAndParse() for a given source slug',
  run: async (sourceSlug: string) => {
    const adapter = require(`../adapters/${sourceSlug}`);
    return await adapter.fetchAndParse(); // returns ParsedItem[]
  }
};

export const fetchURLContent: Tool = {
  name: 'fetchURLContent',
  description: 'Fetch full HTML content of a URL',
  run: async (url: string) => {
    const res = await fetch(url, { timeout: 10000 });
    return await res.text();
  }
};

export const extractMainContent: Tool = {
  name: 'extractMainContent',
  description: 'Extract article text using Readability/Turndown',
  run: async (html: string) => {
    // Use Readability on a JSDOM document
    const dom = new JSDOM(html);
    const doc = new Readability(dom.window.document).parse();
    return doc?.textContent || '';
  }
};

export const createEmbedding: Tool = {
  name: 'createEmbedding',
  description: 'Generate a 1536‑dim embedding via OpenAI',
  run: async (text: string) => {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { data } = await client.embeddings.create({ model: 'text-embedding-3-small', input: text });
    return data[0].embedding;
  }
};

export const upsertSupabase: Tool = {
  name: 'upsertSupabase',
  description: 'Upsert a story record into Supabase',
  run: async (story: any) => {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    return await supabase.from(process.env.STORIES_TABLE).upsert(story, { onConflict: ['external_id','source_id'] });
  }
};
```

---

## 5. Agent Definition

In `ingestionAgent.ts`, configure the agent:

```ts
import { Agent } from 'openai-agents-js';
import { fetchAdapterData, fetchURLContent, extractMainContent, createEmbedding, upsertSupabase } from './tools';
import pLimit from 'p-limit';

export const ingestionAgent = new Agent({
  name: 'IngestionAgent',
  description: 'Orchestrates feed ingestion: fetch metadata, full text, embed, store',
  tools: [fetchAdapterData, fetchURLContent, extractMainContent, createEmbedding, upsertSupabase],
  context: async () => ({
    prd: require('../docs/data_gate_mvp_prd.json'),
    dbSchema: require('../008_finalize_production_schema.json'),
  }),
  memory: false,
  run: async (input, tools) => {
    const limit = pLimit(parseInt(process.env.CONCURRENCY_LIMIT));
    const sourceSlugs = await fetchActiveSourceSlugs();

    for (const slug of sourceSlugs) {
      const items = await tools.fetchAdapterData(slug);
      await Promise.all(
        items.map(item => limit(async () => {
          try {
            const html = await tools.fetchURLContent(item.url);
            const content = await tools.extractMainContent(html);
            const embedding = await tools.createEmbedding(content);
            const story = buildStoryRecord(item, content, embedding);
            await tools.upsertSupabase(story);
          } catch (e) {
            console.error(`Ingestion error for ${item.url}:`, e);
            // metrics.increment('ingest_error');
          }
        }))
      );
    }
  }
});
```

**Helper Functions**:

- `fetchActiveSourceSlugs()`: query Supabase `sources` table for `is_active=true`
- `buildStoryRecord(item, content, embedding)`: map `ParsedItem` + extracted fields to DB column shape

---

## 6. Scheduling & Execution

Use the openai-agents-js runner or Vercel Cron Worker:

```ts
import { runAgent } from 'openai-agents-js';
import { ingestionAgent } from './ingestionAgent';

// In Cron handler (e.g., Vercel Edge Function):
export default async function handler() {
  await runAgent(ingestionAgent, {});
  return new Response('Ingestion complete', { status: 200 });
}
```

Configure in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/ingest", "schedule": "0 * * * *" }
  ]
}
```

---

## 7. Error Handling & Idempotency

- **Idempotency:** Upsert on `(external_id, source_id)` ensures no duplicates.
- **Retries:** Wrapped by `p-retry` for transient network errors.
- **Logging:** Log success/failure per URL; push metrics to Grafana/Logflare.
- **Fallback:** If HTML parsing fails, use `item.summary` as `content`.

---

## 8. Testing & Validation

- **Unit Tests:** Mock each tool, test `buildStoryRecord`, error branches.
- **Integration Tests:** Run agent against a staging source with known fixtures.
- **End-to-End:** Dry-run mode logging item count, vector generation, DB upsert count.

---

## 9. Observability & Metrics

- **Latency:** Track per-source ingest time and p95 ETL latency (< 10 min).
- **Error Rate:** % of items failing HTML fetch, parse, embedding, or DB write.
- **Item Count:** Stories ingested per run; monitor for drastic drops/spikes.

---

