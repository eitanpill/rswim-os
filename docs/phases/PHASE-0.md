# Phase 0 — Foundations

## Goal
A working skeleton that every later phase builds on: monorepo, CI, database with tenant + role isolation, auth for staff and parents, three RTL app shells, audit log, outbox + worker, Hebrew calendar service, fake seed data.

## Acceptance criteria (from the brief)
1. **Three role-based shells render RTL on mobile** (Admin, Instructor, Parent), verified by Playwright at 390×844 with screenshot tests and `dir="rtl"` assertions.
2. **RLS tests prove tenant & role isolation**: two orgs × every role; cross-tenant reads/writes return nothing / fail; instructor sees only own-session students; parent sees only own household.
3. **Outbox delivers a test event exactly once**: a test writes a mutation + outbox row, the relay is run twice and the event is redelivered, and the consumer's side effect (a `test_effects` row) exists exactly once.

## Scope

### 0.1 Monorepo & tooling
- pnpm workspaces, Turborepo, Node 22, TS strict base config, ESLint (incl. module-boundary rule and a "no physical CSS direction" rule), Prettier, Vitest workspace, Playwright.
- Packages: `config`, `contracts`, `db`, `money`, `calendar`, `ui`, `domain/core` (org, membership, audit, outbox), `integrations` (interfaces only).
- Apps: `web`, `worker`.

### 0.2 CI (GitHub Actions)
- Jobs: install (cached) → lint → typecheck → unit tests → RLS tests (Supabase CLI local stack in CI) → build → Playwright smoke (mobile).
- Fails if any `public` table has RLS disabled.

### 0.3 Database & migrations
- Supabase local (`supabase start`), Drizzle schema + SQL migrations.
- Phase 0 tables: `organizations`, `org_settings`, `memberships`, `platform_admins`, `staff_members` (minimal), `households`, `guardians`, `students` (minimal), `audit_log`, `outbox`, `inbox_receipts`, `webhook_events`, `dead_letters`, `files`, `feature_flags`, `test_effects` (test-only).
- Composite FKs `(organization_id, id)`, `updated_at` trigger, ledger-style append-only trigger helper (reused in Phase 4).
- RLS helper functions in schema `app`: `current_org()`, `current_role()`, `has_permission()`, `guardian_household_ids()`, `instructor_student_ids()` (stub until sessions exist in Phase 2).

### 0.4 Auth & RBAC
- Supabase Auth: staff email/password; parents phone OTP (SMS in dev via Supabase test OTPs).
- Custom access-token hook adds `org_id`, `role`, `permissions`.
- Org switcher for users with multiple memberships.
- Route-group guards in Next.js middleware: `(admin)` owner/admin, `(instructor)` instructor, `(parent)` parent, `(platform)` super-admin.
- Invite flow (owner invites staff by email/phone) — minimal.

### 0.5 RTL design system & shells
- Tailwind with logical properties, shadcn/ui themed, Heebo font, dark mode, 44px min tap targets.
- `next-intl` with `he` (default) and `en`; all strings in message files.
- Shells:
  - **Admin**: top bar with org name, bottom nav on mobile (היום · משפחות · לוח קבוצות · כספים · עוד), side nav on desktop; empty "Command Center" placeholder.
  - **Instructor PWA**: "היום שלי" placeholder, manifest + service worker, offline banner.
  - **Parent portal**: "המשפחה שלי" placeholder, phone OTP login screen.
- Shared primitives: `Money` (agorot → ₪ formatting), `HebrewDate`, `EmptyState`, `PageHeader`.

### 0.6 Audit log
- `audit.record(actor, action, subject, diff)` service; DB trigger on sensitive tables for write auditing; `sensitive_read` helper for encrypted fields.

### 0.7 Outbox + worker skeleton
- `withTransaction(org, async tx => { …; await emit(tx, event) })` API in `domain/core`.
- Worker relay (Inngest cron every minute + post-commit nudge): `FOR UPDATE SKIP LOCKED`, sends to Inngest with event id = outbox id, marks dispatched, backoff on error, dead-letter after N attempts.
- `inbox_receipts` guard helper for consumers.
- Test consumer `core/test.ping` writes `test_effects`.

### 0.8 Hebrew calendar service (`packages/calendar`)
- `dayInfo(date)` → `{isShabbat, isErevChag, isYomTov, isCholHaMoed, isMajorFast, isTishaBav, isYomHaZikaron(Eve), holidays: {he, en}[]}` using the `@hebcal/core` Israel schedule.
- `lessonDay(date, policy, overrides)` driven by `calendar.*` policy keys (POLICIES §7) and owner overrides, with the reasons that blocked the day.
- `restWindow(date)` / `isInRestWindow(instant)` for comms send-blocking (Jerusalem candle lighting to havdalah, joined across Shabbat + Yom Tov).
- Tests: 5787 (2026–27) holiday fixtures incl. Sukkot Chol HaMoed, Pesach, Yom Kippur, Tisha B'Av.

### 0.9 Seed data (fake, Hebrew)
- 2 orgs: "R-SWIM (דמו)" and "בריכת הדגמה" (for isolation tests).
- Users for every role in both orgs.
- R-SWIM demo: 4 venues (fake addresses), ~25 households with edge cases from the brief: twins, divorced parents with alternating weeks, water-fear child, religious family requiring a female instructor, family with 4 kids, institution-paid child, reimbursement-mode household, hybrid-pay instructor.
- All names/phones generated (`050-000xxxx` range), never real.

### 0.10 Docs
- Move `CLAUDE.md`, ADRs, glossary, ERD, policies, decisions into the repo. Add `docs/STATUS.md` and `docs/demos/PHASE-0.md`.

## Out of scope for Phase 0
Venues/programs CRUD, pricing, scheduling, any GHL/Grow calls (interfaces only), real WhatsApp OTP.

## Delivery as PRs
1. Monorepo, tooling, CI, docs
2. DB schema core + RLS + RLS test harness
3. Auth, RBAC, route guards
4. RTL design system + three shells + Playwright mobile screenshots
5. Audit log + outbox + worker + exactly-once test
6. Hebrew calendar package
7. Seed data + demo script

## Risks
- Supabase custom access-token hook needs a hosted project setting for staging/prod (local works out of the box).
- Inngest Cloud account and Supabase projects for staging/prod need to be created by the owner (credentials go into environment secrets, never into the repo).

## Outcome (2026-10-01)
All three acceptance criteria pass; see `docs/STATUS.md` for the evidence and what is not yet verified against hosted services.
Changes from the plan: tRPC and the staff invite flow moved to Phase 1; surfaces are path segments, not route groups; seeds live in `packages/seed`; provider interfaces are in `packages/integrations`. Details in `docs/DECISIONS.md`.
