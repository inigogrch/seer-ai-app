# Cursor Integration Checklist: Adapting a Large UI Project (Expert Edition)

## 🗂️ 1. Preparation & Planning
- **Import all generated UI code** (components, pages, assets) into your repo structure.
- **Integrate all backend/context files:**
  - Product Requirement Doc (PRD)
  - Finalized SQL schema
  - API docs/specs (OpenAPI/Swagger if available)
  - Data model and type definitions (TS interfaces, DB schema, DTOs)
- **Create and maintain INTEGRATION_NOTES.md:**
  - Real API endpoints & full sample responses
  - Database schema summary & entity relationship diagrams (ERD)
  - Clear mapping: which generated files/components to keep, rewrite, or delete
  - List 3rd-party dependencies (auth, storage, analytics, etc.)
- **Project context:**
  - Add onboarding/README pointers to critical integration notes, API docs, and schema references
  - Document environment requirements and .env variable expectations

## 🏃 2. Local Setup & Smoke Test
- **Start the app locally**: note any build/runtime errors or major UI breakages
- **Enumerate ALL pages, flows, and UI states**
  - Capture screenshots of each page/state for before/after regression checks
- **Test with mock data:**
  - List what works as expected
  - List what’s broken, missing, or placeholder
- **Verify baseline test coverage:**
  - Run and document existing lint/type/unit test status

## 📝 3. Atomic Integration Steps (Iterate per Feature/Page)
For each feature (e.g. Feed, StoryCard, Feedback, Chat, Profile, Settings):
- **Remove all mock/fake data**
  - Replace with real API fetches (e.g., `/api/feed`)
  - Use Cursor agent:
    - `@cursor TASK: Replace mock data in [file] with fetch from [real endpoint]`
- **Wire up API integration:**
  - Use a robust data fetching layer (SWR, TanStack Query, or custom hook)
  - Align types/interfaces (end-to-end): backend schema ⇄ TypeScript models ⇄ component props
  - Validate API contract with mock + real data (fail gracefully)
  - `@cursor TASK: Update [component] props/state to match [schema/API]`
- **Refactor state management:**
  - Use a centralized and composable store (Zustand/Redux/Context), not per-component local state
  - Document state shape and transitions
  - `@cursor TASK: Convert [component] to use Zustand for [state]`
- **Authentication & Authorization:**
  - Ensure all protected routes/components use production-grade auth (Supabase JWT, Clerk, Auth0, etc.)
  - Properly handle login, session refresh, logout flows
  - Guard all sensitive endpoints and UI routes (SSR & CSR)
  - `@cursor TASK: Guard [route/page] with real auth`
- **UI Consistency & Cleanup:**
  - Replace or merge all duplicated/overlapping components (choose 1 canonical version)
  - Remove all unused code/assets, update imports
  - Fix broken links, images, or icons
  - `@cursor TASK: Remove unused [components/assets] and update imports`
- **Error Handling & Loading States:**
  - Add error boundaries at page and component level
  - Add loading skeletons/UX-friendly spinners for async data
  - Standardize toast/snackbar for errors and notifications
  - `@cursor TASK: Add loading/error states to [component/page]`
- **Accessibility & Internationalization:**
  - Confirm all interactive components are keyboard accessible (tab, aria labels)
  - Check color contrast and screen reader flow
  - Ensure all strings are i18n-ready (EN default)

## 🧪 4. Testing & Validation
- **Manual QA:**
  - Manually test all integrated flows with real backend (including auth, feedback, edge cases)
  - Try invalid states, expired sessions, slow network, large payloads
- **Automated QA:**
  - Check for TypeScript errors/warnings
  - Write/update minimal integration/unit tests for every new or modified component
  - Run e2e tests if Playwright/Cypress is setup
  - Run accessibility tests (axe, lighthouse)
- **Performance Validation:**
  - Measure API/SSR latency and UI load times
  - Confirm DB/index/query performance if data loads feel slow
- **Analytics & Logging:**
  - Ensure basic product analytics, error logging, and critical traces are hooked up (PostHog, Sentry, Logflare, etc.)

## 🗑️ 5. Final Cleanup & Documentation
- Delete all leftover mock/template/demo files and assets
- Update README, INTEGRATION_NOTES, API docs, and architecture diagrams
- Ensure onboarding instructions are accurate for new engineers
- Tag a release candidate (RC) or pre-GA branch for QA handoff
- Validate all environment configs (.env, secrets) and CI/CD pipeline are up to date

## ⚡ Pro Tips for Production-Ready Integration
- Use `@cursor TASK` comments everywhere for traceable, actionable integration tasks
- Integrate and test features in the smallest possible batches (atomic commits, PRs)
- Always keep your schema and API docs accessible in the Cursor context
- Track ALL integration tasks in a top-level `MVP_TODO.md` (or in your preferred tracker)
- Don’t hesitate to delete or refactor large, unused, or poorly structured generated code
- Prioritize accessibility, error handling, and resilience as you wire up each feature
- Use feature flags or toggles for risky/experimental code

## ✅ Done?
- Run full QA with real users and real data
- Confirm all analytics, monitoring, and alerting hooks are firing
- Archive mock data branches, tag the MVP release, and ship it!

---

**This checklist reflects best practices for integrating large AI/data projects in production.**
- Want sample API contract docs, ERD diagrams, or onboarding templates added to this canvas?
- Need atomic Cursor task breakdowns per feature/page? Just ask!

