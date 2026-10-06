# R-SWIM OS — CLAUDE.md

Living guide for anyone (human or Claude) working in this repo. Keep it short and current.

## What this is
A multi-tenant, Hebrew-first (RTL) operating system for swim schools. Tenant #1 is R-SWIM (Reut's swim school, Jerusalem / Gush Etzion). The #1 design goal: **the business runs without the owner in the water or on WhatsApp all day.**

GoHighLevel (white-labeled "LeadYourWay") stays the marketing and lead engine. R-SWIM OS is the operational core: families, students, groups, venues, staff, money.

## Stack (see docs/adr/0001)
- pnpm workspaces + Turborepo
- `apps/web`: Next.js 15 (App Router), TypeScript strict, Server Actions (tRPC joins in Phase 1 when client-side queries appear). Surfaces: `/admin`, `/instructor`, `/parent`, `/transport`, `/accountant`, `/platform`
- `apps/worker`: Inngest functions (outbox relay, scheduled jobs)
- PostgreSQL on Supabase, Drizzle ORM, SQL migrations + RLS policies in repo
- Supabase Auth: email/password for staff, phone OTP for parents
- Tailwind 4 + shadcn-style components in `packages/ui`, logical CSS properties only (`ms-`, `pe-`, `start-`, never `ml-`/`right-`; ESLint blocks them)
- `@hebcal/core` for the Hebrew calendar
- Vitest (domain, 100% branch coverage on policies), Playwright (E2E + RTL screenshots)
- pino logs now; Sentry and OpenTelemetry are wired when staging exists

## Layout
```
apps/
  web/                 Next.js app (admin, instructor PWA, parent portal)
  worker/              Inngest worker
packages/
  db/                  Drizzle schema, migrations (0001_security.sql = RLS, triggers, auth hook), test harness
  seed/                Fake Hebrew demo data (two orgs, brief §10 edge cases)
  contracts/           Zod schemas + shared types (roles, claims, events, phones)
  domain/core/         outbox emit, relay + inbox guard (worker.ts), audit, envelope encryption
  domain/<module>/     schema.ts · policies.ts · services.ts · events.ts · api.ts (from Phase 1)
  calendar/            Hebrew calendar service (hebcal wrapper)
  money/               Agorot type, formatting, rounding helpers
  integrations/        MessagingProvider, PaymentProvider, InvoicingProvider, CrmProvider adapters
  ui/                  RTL design system (shadcn-based)
  config/              eslint, tsconfig, tailwind presets
docs/
  adr/  phases/  demos/  DOMAIN_GLOSSARY.md  ERD.md  POLICIES.md  DECISIONS.md  STATUS.md
```

## Commands
```
pnpm i
pnpm db:start            # supabase start (Docker); or use any Postgres 16 with RSWIM_PLAIN_POSTGRES=1
pnpm db:migrate          # drizzle migrations incl. RLS (needs DATABASE_URL)
pnpm db:seed             # fake Hebrew demo data (needs DATABASE_URL; RSWIM_MASTER_KEY to fill encrypted fields)
pnpm dev                 # web on :3000 + worker on :3030 (run `npx inngest-cli dev` for the Inngest dev server)
pnpm lint | typecheck | test | test:e2e | format:check
pnpm test:rls            # tenant & role isolation suite only
```
Tests that touch the database create a throwaway database through `TEST_DATABASE_ADMIN_URL`
(default `postgresql://rswim:rswim@localhost:5432/postgres`, a superuser). On plain Postgres the harness applies
`packages/db/sql/supabase-shim.sql` (roles + `auth.users`) first; never apply the shim to Supabase.

Local demo login without Supabase: `RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev`, then pick a persona on `/login`.
It is refused on Vercel production deployments. The web app also needs `DATABASE_URL` (it queries as the signed-in user).
`pnpm test:e2e` rebuilds a `rswim_e2e` database (migrations + fake seed) through `TEST_DATABASE_ADMIN_URL` first.

GHL (LeadYourWay): the worker reads `GHL_API_TOKEN`; the webhook route needs `GHL_WEBHOOK_PUBLIC_KEY`. For local demos
run the worker with `RSWIM_GHL_FAKE=1` (optionally `RSWIM_GHL_FAKE_CONTACTS=<fake contacts json>`). Never point tests
at the real account.

Grow (payments) and Green Invoice (receipts) run on fakes only until Pit's accounts exist: start the worker with
`RSWIM_GROW_FAKE=1 RSWIM_INVOICING_FAKE=1` (a mandate id containing "fail" is declined). The Grow webhook route needs
`GROW_WEBHOOK_SECRET`. Saving a payer's ID number needs `RSWIM_MASTER_KEY` in the web app's environment too.

WhatsApp goes through GHL conversations: the worker sends with `GHL_API_TOKEN`, or to an in-memory fake with
`RSWIM_MESSAGING_FAKE=1` (a phone containing 0000000 fails). Inbound WhatsApp arrives on the same GHL webhook route
(`InboundMessage`). With the `comms.ai_triage` policy on, the worker re-classifies inbound messages with Claude using
`ANTHROPIC_API_KEY`; without it the rules classifier decides alone. The owner copilot (`/admin/copilot`, policy `copilot.enabled`) runs on Claude when the web app has `ANTHROPIC_API_KEY`,
or on a rules-based fake with `RSWIM_COPILOT_FAKE=1` (demos and E2E). Trial pipeline moves need
`integrations.ghl.pipeline` (pipeline id + stage ids) in the org settings.

SaaS (Phase 10): a signed-in user with no school lands on `/onboarding` to open one; platform admins (`platform_admins`)
use `/platform`. Dev personas **בית ספר חדש** and **מנהל/ת פלטפורמה** cover both. The worker verifies custom domains
by DNS TXT, or with `RSWIM_DNS_FAKE=1` accepts any `*.localhost`; it bills schools through the payment provider
(`RSWIM_GROW_FAKE=1`). `RSWIM_PLATFORM_HOSTS` (comma-separated) lists the platform's own hosts, which schools can't claim.
Plan limits are a database trigger; plan features gate screens through `requireFeature`.

## Database access, in one paragraph
Signed-in requests run as `authenticated` with JWT claims (`asUser`). Background jobs for one tenant run as
`rswim_system` with `app.org_id` set (`withOrg`, from `@rswim/db/service`): RLS still applies, so a job cannot touch
another tenant. Only genuinely cross-tenant plumbing (the outbox relay, seeding, migrations) uses the owner
connection (`asPlatform`). Role and permissions are read live from `memberships`, not trusted from the token.
Every new table needs RLS policies plus rows in `packages/db/test/rls/isolation.test.ts`; the suite fails if a table
has RLS disabled. Admin screens follow one pattern: a server action calls `runForm(fd, Schema, service)` from
`apps/web/src/lib/forms.ts`, which validates, runs the domain service as the user, and returns translated errors.

## Non-negotiable conventions
1. **Multi-tenant**: every tenant table has `organization_id uuid not null`, composite FKs `(organization_id, id)`, and RLS. Nothing bypasses RLS except platform plumbing via `asPlatform`.
2. **Money** is `integer` agorot (`amount_agorot`). Never floats. Currency ILS.
3. **Time**: store `timestamptz`; business logic runs in `Asia/Jerusalem`. Local dates (`date`) for lesson days and billing periods.
4. **Business rules are configuration**: prices, policies, cut-offs, makeup limits and pay rates live in versioned, effective-dated rows (`policy_sets`, `price_lists`, `pay_rules`). No literals in code.
5. **Pure policies**: rule logic lives in `packages/domain/*/policies.ts` as pure functions `(inputs, policyVersion) => decision + explanation`. Every stored decision records `policy_version_id`.
6. **Side effects only in workers**: a mutation writes its row(s) + an `outbox` row in one transaction. Messages, payments and syncs happen in the worker. Idempotency key on everything external.
7. **Ledger is append-only**: balances are derived. Corrections are new entries, never updates.
8. **Modules talk via services/events**, never by reading another module's tables directly.
9. **Hebrew/RTL first**: all user-facing strings via i18n (`he` default, `en` secondary). No hard-coded UI text.
10. TypeScript strict, no `any`, Zod at every boundary. Conventional commits.
11. **Never use real client data.** Seeds and fixtures are fake.

## Domain glossary
See `docs/DOMAIN_GLOSSARY.md`. Quick ones: makeup = השלמה, freeze = הקפאה, standing order = הוראת קבע, after-school = צהרון, camp = קייטנה, trial = שיעור ניסיון, regulations = תקנון, household = billing unit.

## Phase discipline
Start of a phase: write `docs/phases/PHASE-N.md`. End: tests green, `docs/STATUS.md` updated, demo script in `docs/demos/PHASE-N.md`. Ambiguity → pick a default, log it in `docs/DECISIONS.md`, keep going.
