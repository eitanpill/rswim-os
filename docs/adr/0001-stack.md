# ADR-0001: Technology stack

- Status: Accepted
- Date: 2026-10-01

## Context
R-SWIM OS is a multi-tenant SaaS for swim schools, Hebrew/RTL first, used mostly on phones at the poolside. It needs typed end-to-end APIs, durable background workflows (billing runs, closures, dunning, lineups), row-level tenant isolation, an offline-capable instructor PWA, and Hebrew RTL PDFs. The team is small (one developer + Claude), so the stack should minimise moving parts and ops.

## Decision
| Concern | Choice |
|---|---|
| Repo | pnpm workspaces + Turborepo |
| Web | Next.js 15 App Router, React 19, TypeScript strict; Server Actions for forms, tRPC for typed queries/mutations used by client components and the PWA |
| Surfaces | One Next.js app, route groups `(admin)`, `(instructor)`, `(parent)`, `(platform)` with separate layouts and auth guards |
| Worker | `apps/worker` running Inngest functions (durable, retried, idempotent steps, cron) |
| DB | PostgreSQL 15+ on Supabase; Drizzle ORM; migrations in repo; RLS policies as SQL migrations |
| Auth | Supabase Auth. Staff: email + password (+ optional TOTP). Parents: phone OTP (SMS now, WhatsApp later). Org + role claims injected via a custom access-token hook |
| UI | Tailwind (logical properties) + shadcn/ui, `dir="rtl"`, Heebo/Assistant fonts, dark mode |
| Offline | Instructor PWA: service worker + IndexedDB queue (attendance, notes) replayed with idempotency keys |
| Files | Supabase Storage, private buckets, signed URLs only |
| PDF | `@react-pdf/renderer` with embedded Hebrew fonts, RTL |
| Calendar | `@hebcal/core` (holidays, Chol HaMoed, erev chag, Yom HaZikaron, Tisha B'Av), wrapped in `packages/calendar` |
| Validation | Zod schemas in `packages/contracts` |
| Testing | Vitest (+ fast-check for property tests), Playwright (mobile viewports, RTL screenshots), pgTAP-style RLS tests via Vitest against local Supabase |
| Observability | Sentry, pino JSON logs, OpenTelemetry traces on workflows, `audit_log` table |
| Hosting | Vercel (web), Supabase (DB/Auth/Storage), Inngest Cloud; envs: dev (local), staging, prod |
| CI | GitHub Actions: install → lint → typecheck → unit → RLS tests (Supabase CLI in CI) → build |

## Alternatives considered
- **Trigger.dev** instead of Inngest: comparable. Inngest chosen for first-class Next.js integration and step-level idempotency; the `outbox → job` boundary keeps this swappable.
- **Prisma** instead of Drizzle: Drizzle is closer to SQL, better fit for hand-written RLS and views.
- **Separate apps per surface**: more deploys and duplicated auth/UI for no real isolation gain at this size.

## Consequences
- Supabase is a hard dependency (Auth, Storage, RLS conventions). Keep Supabase-specific code in `packages/db` and `apps/web/lib/supabase`.
- Vercel serverless limits long tasks; anything >10s goes to the worker.
