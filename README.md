# Seer-AI MVP Scaffold

This is the baseline scaffold for the Seer-AI MVP, following the agentic system design and adapter specs. All modules are stubbed with type safety, minimal boilerplate, and @cursor TASK: breadcrumbs for rapid iteration.

## Getting Started

1. **Install dependencies:**
   ```sh
   pnpm install
   ```
2. **Build the project:**
   ```sh
   pnpm run build
   ```
3. **Set up environment variables:**
   Copy `.env.example` to `.env` and fill in the required values.

4. **Run Supabase migrations:**
   Apply the SQL files in `supabase/migrations/` to your Supabase instance.

## Vercel Deploy

- Configure your project on Vercel and set the required environment variables.
- Ensure your Supabase instance is accessible from Vercel.

## Directory Layout

See `specs/product/agentic_system_design_spec.md` §7 for the full structure. Key folders:

- `src/agents/` — agent stubs
- `src/adapters/` — adapter stubs
- `src/app/api/` — Next.js App Router API routes
- `src/utils/` — shared utilities
- `src/types/` — shared types/interfaces
- `supabase/migrations/` — split migrations
- `tests/` — test stubs

## Integration Notes

See [INTEGRATION_NOTES.md](INTEGRATION_NOTES.md) for next steps and integration checklist.

---

> All files contain `@cursor TASK:` comments for future contributors.
