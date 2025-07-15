# Agentic AI App System Design Spec: DataSeer v5.0

---

## 1. High-Level System Architecture

### Core Agentic Workflow 

- **[Ingest (with Embedding)] → [Classify (with DB storage)] → [Retrieve → Display] → [Summarize (UI triggered, handles Chat)] → [Web Search Fallback] → [Feedback → Learn]**

- Modular, observable, and extensible: Each agent step is an independent module, but embedding is fully handled within the ingestion agent for MVP simplicity.

- User preferences generate a ranked feed. Summarization and chat are triggered on-demand per story from the UI (e.g., 'Summarize' button on story card leads into chat interface).

- The **SummarizerAgent** now directly handles all chat response capabilities and message orchestration, including inserting summaries or RAG completions into the Chat UI. There is no separate ChatAgent—all chat flows and conversational UI logic are wrapped into SummarizerAgent for the MVP.

---

## 2. Agent Setup – File/Module Structure (MVP)

### /packages/agents/

- **ingestionAgent.ts** — Handles both ingestion and embedding! Fetches & parses stories from sources, generates OpenAI embeddings, and upserts to DB.
- **classifierAgent.ts** — Tags/classifies stories (semantic or LLM-based), updates metadata.
- **retrievalAgent.ts** — Runs SQL K-NN & filtering, returns stories for users/feed/chat.
- **summarizerAgent.ts** — Handles both summarization (TL;DR, "Why it matters") and all conversational/chat flows. All UI chat responses and context-injected responses are managed here.&#x20;

**--- The following agents are for FUTURE DEVELOPMENT ---**

- **webSearchAgent.ts** *(Future)* — For real-time external/MCP search, web augmentation, advanced RAG.
- **feedbackTrainerAgent.ts** *(Future)* — Uses user feedback to re-rank/retrain story relevance.

> *Note: "webSearchAgent" and "feedbackTrainerAgent" are modular for future expansion, but not required at launch.*

### /packages/adapters/

- rssAdapter.ts, pypiAdapter.ts, huggingfaceAdapter.ts, arxivAdapter.ts, etc. — Source-specific parsing/fetching logic.

### /api/

- /feed — Calls retrievalAgent, returns ranked stories.
- /chat — Streams chat completions via summarizerAgent (now also the chat agent).
- /feedback — Posts feedback (used for future tuning).

### /supabase/

- migrations/ — Production schema for sources, stories, feedback, indexes, views.
- sql/ — Utility SQL, custom search, analytics views.

---

## 3. Database Schema

- **sources** (feed definitions)
- **stories** (content, metadata, vector)
- **feedback** (user feedback for RL)
- Comprehensive indexes and semantic search functions.

---

## 4. Agentic System Flow Diagram (Mermaid)

```mermaid
flowchart TD
    A[External Feeds] -->|RSS/API/Web| B(IngestionAgent\n(with Embedding))
    B --> C[ClassifierAgent\nTag & Category]
    C --> D[stories table]
    D --> E[RetrievalAgent\nuser→stories]
    E --> F[Feed API /api/feed]
    F --> G[Frontend\nFeed UI]
    G --> H([User clicks Summarize])
    H --> I[SummarizerAgent (on demand)\nHandles Chat]
    I --> J[Frontend\nChat UI]
    J --> K[User Feedback\n👍/👎]
    K -.-> L[FeedbackTrainerAgent (Future)]
    E -.-> M[WebSearchAgent (Future)]
    subgraph Observability
        D --> N[Grafana/Logflare]
    end
```

*SummarizerAgent now handles all chat messaging and context logic; ChatAgent is merged in for MVP.*

---

## 5. Full Agentic Workflow (ASCII Diagram, Updated)

```
[External Feeds]
      |
      v
+------------------+
| Ingestion Agent  |
|  (includes       |
|   embedding)     |
+------------------+
      |
      v
+-------------------+
| Classifier Agent  |
|  (upsert tags to  |
|   stories table)  |
+-------------------+
      |
      v
+--------------------+
| Retrieval Agent    |
+--------------------+
      |
      v
+----------------+  +-----------------+
| Feed API       |  | SummarizerAgent  |
| (/api/feed)    |  | (Handles Chat)   |
+----------------+  +-----------------+
      |                   ^
      v                   |
+----------------+        |
| Feed UI        |        |
+----------------+        |
      |                   |
      |   +------------------------------+
      |   | [User clicks 'Summarize']    |
      |   +------------------------------+
      |                   |
      |                   v
      |       +---------------------+
      |       | Summarizer Agent    |
      |       | (on-demand, story   |
      |       | + chat responses)   |
      |       +---------------------+
      |                   |
      |                   v
      |       +--------------------------+
      |       | Auto-inserts summary      |
      |       | message in Chat UI        |
      |       +--------------------------+
      |                   |
      v                   |
+-------------------------+
| User Feedback (👍/👎)    |
+-------------------------+
      |
   [For Future: -----------]
      v
+------------------------------+
| FeedbackTrainerAgent (FUTURE) |
+------------------------------+

   [For Future: ------------]
        \
         v
+-------------------------+
| WebSearchAgent (FUTURE) |
+-------------------------+
```

*SummarizerAgent includes all chat/response logic; there is no separate chatAgent for MVP. Agents for future development are still clearly marked.*

---

## 6. Dev Best Practices

- Each agent is a modular TS class/module with a clear API (`run()`/`handle()` method).
- Retry and idempotency: All agent jobs should be safe to run multiple times (no dupes).
- Rich logging, monitoring, and alerting for all agent flows (Grafana, Logflare).
- CI/CD with test coverage (unit + integration) and auto deployment (GitHub Actions).
- API and DB strictly versioned; endpoints follow JSON\:API 1.1.
- Strict environment separation; all secrets in encrypted env vars.

---

## 7. Example Directory Layout
```plain-text
/seer-ai
├─ src/
│  ├─ agents/           # OpenAI agents
│  │  ├ ingestionAgent.ts
│  │  ├ classifierAgent.ts
│  │  ├ retrievalAgent.ts
│  │  ├ summarizerAgent.ts
│  │  ├ webSearchAgent.ts   # (future)
│  │  └ feedbackTrainerAgent.ts  # (future)
│  ├─ adapters/         # ingestion adapters
│  │  ├ rssAdapter.ts
│  │  ├ pypiAdapter.ts
│  │  ├ huggingfaceAdapter.ts
│  │  ├ arxivAdapter.ts
│  │  └ <other adapters>.ts
│  ├─ api/              # API routes / serverless functions
│  │  ├ feed.ts
│  │  ├ chat.ts         # proxies to summarizerAgent
│  │  └ feedback.ts
│  ├─ utils/            # shared utilities & clients
│  │  ├ openaiClient.ts
│  │  ├ supabaseClient.ts
│  │  └ logger.ts
│  ├─ supabase/         # migrations & schema
│  │  ├ migrations/
│  │  └ schema.sql
│  ├─ frontend/         # Lovable / Next.js UI code
│  │  ├ components/
│  │  ├ pages/
│  │  └ styles/
│  └─ types/            # TS interfaces & DTOs
├─ scripts/             # helper scripts (backfill, migrations)
│  ├ backfill.ts
│  └ migrations.ts
├─ tests/               # unit & integration tests
│  ├ agents/
│  ├ adapters/
│  └ integration/
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ README.md
```
Each adapter module is responsible for fetching raw feed entries (RSS, JSON API, web scrape), normalizing them, and outputting a uniform shape that the IngestionAgent can process seamlessly.

*For MVP: summarizerAgent.ts replaces chatAgent.ts; comments clarify future/planned agents.*

---

## 8. Workflow & Developer Experience

1. Build/test adapters for each source, upsert to Supabase.
2. Embedding logic is fully integrated in the ingestion agent for simplicity and reliability.
3. Retrieval agent: optimize SQL K-NN and ranking logic.
4. SummarizerAgent: handles both summarization and chat context/response logic (prompt engineering for concise, relevant output; handles full chat experience).
5. Build RESTful APIs, validate with integration tests.
6. Connect frontend (Lovable) with APIs (TanStack Query, SSE for chat, feedback hooks).
7. Ship observability (Grafana/Logflare), validate health in pre-prod, then go live.

---

## 9. Production Considerations

- **Observability:** All agent runs and errors are logged with rich metadata.
- **Performance:** Vector search with pgvector IVFFlat; caching for hot feeds; p95 < 200ms target for feed API.
- **Feedback Loop:** User feedback used to tune future retrieval (RL-lite approach).
- **Cost Control:** OpenAI calls are batched, web/MCP calls rate-limited.
- **Security:** JWT auth, RLS on DB, bug bounties, secrets in env vars.
- **Scalability:** Swap pgvector for Pinecone if needed; all agents stateless for serverless scaling.

---

## 10. Reference Table: Agents & Roles (MVP First)

| Agent           | File/module                    | Purpose                                          | Status |
| --------------- | ------------------------------ | ------------------------------------------------ | ------ |
| IngestionAgent  | agents/ingestionAgent.ts       | Fetch/parse stories and embed in DB              | MVP    |
| ClassifierAgent | agents/classifierAgent.ts      | Tag/classify stories (semantic or LLM)           | MVP    |
| RetrievalAgent  | agents/retrievalAgent.ts       | Retrieve/rank for feed or chat                   | MVP    |
| SummarizerAgent | agents/summarizerAgent.ts      | GPT summary + all chat/response flows            | MVP    |
| WebSearchAgent  | agents/webSearchAgent.ts       | External/MCP integration (future)                | FUTURE |
| FeedbackTrainer | agents/feedbackTrainerAgent.ts | Tune future rankings from user feedback (future) | FUTURE |

