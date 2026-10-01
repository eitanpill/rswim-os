# R-SWIM OS — CLAUDE.md

Living guide for anyone (human or Claude) working in this repo. Keep it short and current.

## What this is
A multi-tenant, Hebrew-first (RTL) operating system for swim schools. Tenant #1 is R-SWIM (Reut's swim school, Jerusalem / Gush Etzion). The #1 design goal: **the business runs without the owner in the water or on WhatsApp all day.**

GoHighLevel (white-labeled "LeadYourWay") stays the marketing and lead engine. R-SWIM OS is the operational core: families, students, groups, venues, staff, money.

## Stack (see docs/adr/0001)
- pnpm workspaces + Turborepo
- `apps/web`: Next.js 15 (App Router), TypeScript strict, Server Actions + tRPC. Route groups: `(admin)`, `(instructor)`, `(parent)`, `(platform)`
- `apps/worker`: Inngest functions (outbox relay, scheduled jobs)
- PostgreSQL on Supabase, Drizzle ORM, SQL migrations + RLS policies in repo
- Supabase Auth: email/password for staff, phone OTP for parents
- Tailwind + shadcn/ui, logical CSS properties only (`ms-`, `pe-`, `start-`, never `ml-`/`right-`)
- `@hebcal/core` for the Hebrew calendar
- Vitest (domain, 100% branch coverage on policies), Playwright (E2E + RTL screenshots)
- Sentry, pino, OpenTelemetry

## Layout
```
apps/
  web/                 Next.js app (admin, instructor PWA, parent portal)
  worker/              Inngest worker
packages/
  db/                  Drizzle schema, migrations, RLS SQL, seed
  contracts/           Zod schemas + shared types (API boundary)
  domain/<module>/     schema.ts · policies.ts · services.ts · events.ts · api.ts
  calendar/            Hebrew calendar service (hebcal wrapper)
  money/               Agorot type, formatting, rounding helpers
  integrations/        MessagingProvider, PaymentProvider, InvoicingProvider, CrmProvider adapters
  ui/                  RTL design system (shadcn-based)
  config/              eslint, tsconfig, tailwind presets
docs/
  adr/  phases/  demos/  DOMAIN_GLOSSARY.md  ERD.md  POLICIES.md  DECISIONS.md  STATUS.md
```

## Commands (Phase 0 target)
```
pnpm i
pnpm dev                 # web + worker + inngest dev server
pnpm db:start            # supabase start (local Postgres)
pnpm db:migrate          # drizzle migrations + RLS SQL
pnpm db:seed             # fake Hebrew seed data
pnpm lint | typecheck | test | test:e2e
pnpm test:rls            # tenant & role isolation tests against local Postgres
```

## Non-negotiable conventions
1. **Multi-tenant**: every tenant table has `organization_id uuid not null` + RLS. No query bypasses RLS except the worker's service role, which always filters by org explicitly.
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
