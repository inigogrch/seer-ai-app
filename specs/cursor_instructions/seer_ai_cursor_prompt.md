# Scaffold **Seer‑AI** MVP – Cursor Prompt

```text
You are an expert TypeScript architect using openai‑agents‑js, Next.js 14, Tailwind v4, shadcn/ui, and Supabase pgvector.
Leverage the following reference files already in context:

• System & PRD – `agentic_system_design_spec.md` (overall architecture) and `seer_ai_prd.md` (functional scope, KPIs)
• Database – `finalize_production_schema.sql` (final production schema) — use it verbatim as the first migration
• Adapters & Ingestion – `adapter_spec.md` (adapter contract) and `ingestion_agent_spec.md` (reference implementation)
• Integration workflow – `cursor_integration_checklist.md` (best‑practice task structure)

---

Task
-----

1. **Scaffold the monorepo** exactly as described in the System Design Spec (§7 “Example Directory Layout”).
2. **Generate stubs** (with `//TODO` comments) for:
   • `src/agents/ingestionAgent.ts`, `classifierAgent.ts`, `retrievalAgent.ts`, `summarizerAgent.ts`
   • one sample adapter `src/adapters/techCrunch.ts` that follows the `ParsedItem` interface
   • API routes `/api/feed.ts`, `/api/chat.ts`, `/api/feedback.ts` that simply import and call the corresponding agents
3. **Add Supabase migration files** under `supabase/migrations/` by splitting the SQL in `008_finalize_production_schema.sql` into:
   `001_enable_extensions.sql`, `002_tables.sql`, `003_indexes.sql`, and `004_views.sql`
4. Create `.env.example` containing the variables required by the Ingestion Agent spec.
5. Produce a top‑level `README.md` with **Getting Started** (local dev, Vercel deploy) and link to `INTEGRATION_NOTES.md`.
6. Insert `@cursor TASK:` comments wherever integration work remains (mock → real API, state refactor, testing), guided by the Integration Checklist.
7. Commit everything in one Cursor scratch workspace called **seer‑ai‑mvp‑scaffold**.

---

Output
------

Generate all files with minimal boilerplate but correct imports and type safety; include placeholder types/interfaces where a spec is referenced but not yet implemented. Ensure the project builds successfully with:

    pnpm i && pnpm run build
```

