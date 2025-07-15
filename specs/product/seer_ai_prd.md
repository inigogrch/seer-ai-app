# **Seer.ai** — Product Requirements Document (PRD)

*Revision 1.0  |  July 2025*

---

## 0. **TL;DR**

**Seer.ai** is an agent‑powered web app that curates, ranks, and on‑demand summarizes mission‑critical data, ML, and software news for technical professionals. The MVP delivers a personalized feed plus conversational summaries in a single Chat UI. Core loop: **ingest → embed → classify → retrieve → display → summarize (user‑triggered) → feedback → retrain**

---

## 1. **Problem Statement**

Data, AI, and technology professionals face a **documented information‑overload crisis**. Recent research shows:

- **80 % of knowledge workers** feel overwhelmed by information and app‑hopping, up from 60 % in 2020.
- The average data professional spends **2.5 hours every day** searching for updates or documentation, and **38.7 %** spend more than **20 hours weekly** on data "housekeeping" instead of analysis.
- **57 % of tech practitioners** now need to update their skills **at least monthly**, and missing a critical release can break pipelines or inflate cloud bills.
- **39 % of professionals actively avoid news** because the volume leaves them feeling worn out.

**Validated pain points**

1. **Relentless release cadence** — updates land *daily* across analytics, ML, cloud, and open‑source ecosystems.
2. **High signal‑to‑noise** — actionable nuggets are buried in generic chatter across 10+ tools and feeds per day.
3. **Cost of delay** — a missed Snowflake pricing change, dbt breaking release, or critical security patch can stall production and cost thousands.
4. **Cognitive overload** — context‑switching between dashboards, docs, and Slack steals **2–3 hours per day**.
5. **Skill anxiety & burnout** — >50 % of practitioners feel they must reskill monthly, adding stress to already overloaded schedules.

---

## 2. **Target Users & Personas**

| Persona | Role & Context                     | Jobs‑To‑Be‑Done                                                                    | Pain/Gain                                 |
| ------- | ---------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| *Aisha* | Data Scientist (Finance ML)        | “Stay on top of model/Dataset releases relevant to my domain with minimal effort.” | Save research time, keep competitive edge |
| *Ben*   | Analytics Engineer (dbt/Snowflake) | “Detect breaking dbt changes *before* nightly runs fail.”                          | Prevent pipeline downtime & fire‑drills   |
| *Lena*  | ML Platform Engineer               | “Track API deprecations across Vertex AI & SageMaker.”                             | Reduce rollbacks, protect SLA             |
| *Rahul* | Data Consultant                    | “Create weekly briefings on tool funding & M&A.”                                   | Billable insights faster                  |

---

## 3. **Goals & Success Metrics (90 days post‑GA)**

| Category        | KPI                           | Target   |
| --------------- | ----------------------------- | -------- |
| **Engagement**  | WAU                           | **300**  |
|                 | Avg. session length           | ≥ 4 min  |
| **Quality**     | Relevance score (👍 ÷ total)  | ≥ 80 %   |
| **Performance** | p95 feed API latency          | < 200 ms |
| **Retention**   | Day‑7 retention               | ≥ 45 %   |
| **Cost**        | Avg. OpenAI token spend / WAU | ≤ \$0.05 |

---

## 4. **Scope**

### 4.1 *MVP (GA Q3‑25)*

1. OAuth auth & interest onboarding.
2. Hourly ingestion from 15+ curated feeds (see §8).
3. Embedding via `text‑embedding‑3‑small` (OpenAI) inside the **IngestionAgent**.
4. Vector storage in Supabase `pgvector`.
5. **RetrievalAgent** ranks stories (K‑NN + recency + user tags).
6. Feed UI (Lovable) with story cards & “Summarize” button.
7. **SummarizerAgent** (also handles chat): on‑demand TL;DR + “Why it matters”, posts directly into Chat UI.
8. 👍/👎 feedback capture (stored in `feedback`).
9. Observability: Grafana, Logflare.

### 4.2 *Future (post‑MVP)*

- **WebSearchAgent** — MCP‑based real‑time web search fallback.
- **FeedbackTrainerAgent** — ML re‑ranking using feedback signals.
- Slack digest export, Pro & Team tiers, SOC 2.

### 4.3 *Out of Scope (MVP)*

- Mobile native apps
- Push notifications
- Browser extension

---

## 5. **Functional Requirements**

1. **Auth & Onboarding**   • GitHub/Google OAuth   • Select roles + tech tags.
2. **Ingestion & Embedding**   • Hourly cron, dedupe, hash‑gate   • Batch embeddings.
3. **Storage**   • `stories` table with vectors, tags, metadata.
4. **Retrieval API**   • `/api/feed?page=` returns 20 ranked stories (JSON\:API spec).
5. **Feed UI**   • Dark‑mode, Tailwind, shadcn cards   • Scroll‑depth analytics.
6. **Summarization & Chat**   • `/api/chat` SSE endpoint calling **SummarizerAgent**   • Summary auto‑inserted as chat message with citations.
7. **Feedback**   • 👍/👎 endpoint, optimistic UI update.
8. **Observability**   • Edge/DB latency, cron success rate dashboards.

---

## 6. **Non‑Functional Requirements**

- **Latency**  p95 feed API < 200 ms; p95 first chat token < 1.2 s.
- **Scalability**  ≤ 500 k vectors in pgvector; migrate to Pinecone > 1 M.
- **Security**  JWT auth, RLS, OWASP headers, secrets in Vercel env.
- **Privacy**  GDPR/CCPA compliant; user‑delete self‑service.
- **Accessibility**  WCAG 2.1 AA.

---

## 7. **User Stories & Acceptance Criteria (MVP)**

| # | As a…          | I want…                                                 | So that…                                  | Acceptance                                                     |
| - | -------------- | ------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| 1 | Data Scientist | to see a feed of stories tagged *LLM* & *finance*       | I can quickly spot relevant model updates | Feed loads < 1 s; cards show correct tags                      |
| 2 | Analytics Eng  | to click **Summarize** and get a 3‑bullet TL;DR in chat | I grasp impact fast                       | TL;DR ≤ 3 bullets + “Why it matters”; appears in chat in < 2 s |
| 3 | BI Lead        | to give 👍/👎 feedback                                  | the system learns my preferences          | Reaction stored; next refresh adjusts ranking weight           |

---

## 8. **Data Sources (MVP)**

| Category           | Source                                              | Adapter Key                                          | Method     |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------- | ---------- |
| **Research**       | arXiv (cs, stat)                                    | `arxiv_cs`, `arxiv_stat`                             | RSS        |
|                    | MIT News – Research, Data, AI                       | `mit_research`, `mit_data`, `mit_ai`                 | RSS        |
|                    | Hugging Face Papers                                 | `huggingface_papers`                                 | Web‑scrape |
|                    | Google Research Blog                                | `google_research`                                    | Web‑scrape |
| **Big Tech Blogs** | AWS Big Data / ML / Startups / Developer / Database | `aws_*`                                              | RSS        |
|                    | Microsoft 365 Insider, Excel Blog, Power BI Blog    | `microsoft365_insider`, `excel_blog`, `powerbi_blog` | RSS        |
|                    | OpenAI News                                         | `openai_news`                                        | RSS        |
|                    | Anthropic News                                      | `anthropic_news`                                     | Web‑scrape |
| **News Updates**   | Ars Technica                                        | `arstechnica`                                        | RSS        |
|                    | TechCrunch                                          | `techcrunch`                                         | RSS        |
|                    | VentureBeat                                         | `venturebeat`                                        | RSS        |
|                    | TLDR.tech (Tech edition)                            | `tldr_tech`                                          | RSS        |
|                    | Hacker News Top Stories                             | `hackernews`                                         | API        |

*Total = 14 primary feeds for MVP ingestion; additional vendor‑specific adapters (dbt Labs, Snowflake) are planned for Wave 2.*

---

## 9. **Technical Architecture Overview**

*Full design in System Design Spec v5.0. Key highlights:*

- **Agents (MVP)**: Ingestion (w/ embeddings) → Classifier → Retrieval → Summarizer(+Chat).
- **Future Agents**: WebSearch, FeedbackTrainer.
- Supabase Postgres (pgvector, RLS) > Vercel Edge API > Lovable Frontend.
- Observability via Grafana dashboards.

---

## 10. **API Contract (excerpt)**

• `GET /api/feed?page=` → `{stories: [...], nextPage}` 200 OK   • Max 60 r/m/user.
• `POST /api/chat` (SSE) → streamed `{token}` events; supports abort.
• `POST /api/feedback` body `{storyId, score}` → `200 {status:"ok"}`.

---

## 11. **KPIs & Instrumentation**

- Product analytics via PostHog (WAU, retention).
- Cost monitoring dashboard (OpenAI \$, Sonar \$).
- Weekly health review traffic‑light dashboard.

---

## 12. **Roadmap Snapshot**

| Quarter | Epic                                | Outcome                                    |
| ------- | ----------------------------------- | ------------------------------------------ |
| Q3‑25   | MVP GA                              | Feed + on‑demand chat summaries; 1 000 WAU |
| Q4‑25   | Pro Tier + Slack export             | First paid conversions; \$5 k MRR          |
| Q1‑26   | WebSearchAgent                      | Feed breadth ×3; p95 < 300 ms              |
| Q2‑26   | FeedbackTrainerAgent + SOC 2 Type I | Relevance 80 → 90 %                        |
| Q3‑26   | Mobile companion app                | 30 % MAU mobile                            |

---

## 13. **Risks & Mitigations**

| Risk                   | Impact               | Mitigation                                   |
| ---------------------- | -------------------- | -------------------------------------------- |
| OpenAI cost spike      | Gross margin erosion | Batch embeddings, per‑user rate limits       |
| Feed changes/breakage  | Ingestion fails      | Adapter health alerts + quick‑fix scripts    |
| Hallucinated summaries | Trust loss           | Expert audits, citation display, RL feedback |

---

## 14. **Open Questions**

1. Pricing tier boundaries (Free vs Pro story cap?).
2. Exact Slack export format & quota.
3. MCP provider final choice (Sonar vs custom Bing API).

---

## 15. **Approval & Next Steps**

- **PM**: *Benjamin G.*   • **Tech Lead**: *Benjamin G.*   • **Design**: *Benjamin G.*
- Build!

---

*End of PRD v1.0 – Seer.ai*

