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
- Supabase Auth: email/password for staff, phone OTP for parents. People stay signed in until they sign out (`lib/supabase/session-policy.ts`: 400-day httpOnly cookies renewed on each refresh in the middleware, one-year ceiling); sign-out is this device only, a password change signs out the others
- Tailwind 4 + shadcn-style components in `packages/ui`, logical CSS properties only (`ms-`, `pe-`, `start-`, never `ml-`/`right-`; ESLint blocks them)
- `@hebcal/core` for the Hebrew calendar
- Vitest (domain, 100% branch coverage on policies), Playwright (E2E + RTL screenshots)
- pino logs now; Sentry and OpenTelemetry are wired when staging exists

## Layout
```
apps/
  web/                 Next.js app (admin, instructor PWA, parent portal)
  worker/              Inngest worker
  mobile/              Capacitor shell for the App Store and Google Play (docs/store/APP.md)
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

Each business can connect its own processor in-app (`docs/PAYMENTS.md`, `/admin/integrations/payments`,
`/dive/payments`): keys sealed with the org's data key, customers pay on `/pay/<token>` by card, Bit or a standing order,
and the processor's callback lands on `/api/webhooks/pay/<connectionId>`. With `RSWIM_GROW_FAKE=1`,
`RSWIM_PAYMENTS_SANDBOX=1` or demo mode every processor runs as the demo processor (`/pay/<token>/sandbox`); real
adapters are not live until tested against a processor's sandbox account. The worker builds links from `RSWIM_PUBLIC_URL`.

WhatsApp goes through GHL conversations: the worker sends with `GHL_API_TOKEN`, or to an in-memory fake with
`RSWIM_MESSAGING_FAKE=1` (a phone containing 0000000 fails). Inbound WhatsApp arrives on the same GHL webhook route
(`InboundMessage`). With the `comms.ai_triage` policy on, the worker re-classifies inbound messages with Claude using
`ANTHROPIC_API_KEY`; without it the rules classifier decides alone. With `comms.bot_enabled` on, the parents' bot
(`/admin/messages/bot`) answers families from their own data and the office's approved answers, with Claude
(`ANTHROPIC_API_KEY`) or a rules-based fake (`RSWIM_BOT_FAKE=1`) in the worker, records absences, books makeups and asks
for freezes at the brain's levels, and hands the rest to the inbox. The business brain (`docs/AI-BRAIN.md`, `/admin/brain`, owner only, table `agent_settings`) decides per kind of action whether the AI acts alone, waits for the owner, or is off; its journal is `copilot_actions`. Waiting actions go to the owner's WhatsApp when she sets an approvals number there ("כן N" / "לא N" decides them), an instructor's "אני חולה היום" opens substitute searches, "מה יש לי היום" and "נוכחות" get the instructor their lessons and the link, and any other message from the approvals number is answered by the owner's assistant (worker function `brain-inbound`; only that last part uses a model). Every morning at 07:00 it proposes payment links for old debts and instructor searches for uncovered lessons, and at 20:00 it sends the owner a WhatsApp summary of the day. Its memory (`/admin/brain/memory`, tables `business_snapshots` and `business_memories`, worker function `brain-memory` at 05:45) keeps each month's facts, what happened, and what the owner asked it to remember ("תזכור ש..." in the chat or from the approvals number). It learns from her decisions (stage 6): it suggests levels on `/admin/brain` (never sets them), skips families and amounts she dropped with a reason ("לא 12 מקרה מיוחד"), and tells her WhatsApp what it learned on Sundays at 09:00 (worker function `brain-learning`). On Sundays at 08:00 the weekly coach (`brain-weekly-coach`, `coach.ts`) sends her the week: three priorities with what to reply, and the next holiday against last year. The owner copilot (`/admin/copilot`, policy `copilot.enabled`) runs on Claude when the web app has `ANTHROPIC_API_KEY`,
or on a rules-based fake with `RSWIM_COPILOT_FAKE=1` (demos and E2E). The owner's insights feed (command center, policy
`insights.*`) is rule-based and advisory only; the worker refreshes it daily and, with `ANTHROPIC_API_KEY`, has Claude
write each insight's explanation and next step. Trial pipeline moves need
`integrations.ghl.pipeline` (pipeline id + stage ids) in the org settings.

Store launch (`docs/store/PLAN.md`): one app for everyone. A signed-in user with no school lands on `/start` (a
school's link, the phone the office knows, or opening a school); someone in several schools switches on `/me/schools`
(`public.switch_school`, dev persona **אסף (מדריך והורה)**). Families find a school on `/schools` (search, open
signed out) or its link `/join/<slug>`; a swim school's office decides join and trial requests on `/admin/join` (link,
printable QR, search listing), and `/start` offers the school that already has the person's phone (dev personas
**דנה (הורה מחפשת בית ספר)** and **מיכל (הורה שבית הספר מכיר)**). The store app (`apps/mobile`, `docs/store/APP.md`) is a Capacitor shell that loads the site; it
sends user agent `AquaSwimApp` (`lib/native-app.ts`), links open it through `/.well-known` files built from
`RSWIM_IOS_APP_IDS` and `RSWIM_ANDROID_CERT_SHA256`, and `.github/workflows/mobile.yml` builds both platforms.
Anyone deletes their own account on `/me/account`
(`public.delete_my_account`, each school's database first; the only owner of a school is refused; hidden dev persona
`leaver` for the E2E suite).

SaaS (Phase 10, product name `PRODUCT` in `@rswim/contracts`): visitors see the landing page with prices at `/` and
create an owner account on `/signup` (Supabase email confirmation through `/auth/confirm`; without Supabase a real
`auth.users` row and a `signup.<userId>` dev cookie). The owner's way from `/start` leads to `/onboarding` to open a
swim school or a freediving club; platform admins (`platform_admins`)
use `/platform`. Dev personas **בית ספר חדש** and **מנהל/ת פלטפורמה** cover both. The worker verifies custom domains
by DNS TXT, or with `RSWIM_DNS_FAKE=1` accepts any `*.localhost`; it bills schools through the payment provider
(`RSWIM_GROW_FAKE=1`). Sign-up ends on `/billing/card`, where the owner saves the subscription's card (in sandbox mode
on `/billing/card/<setup>/sandbox`; the callback is `/api/webhooks/platform-card`); she changes plan, cancels and
renews on `/admin/plan` (`/dive/plan`). Each paid platform invoice gets a document from the platform's own invoicing
(`platformInvoicing()` in the worker, fake with `RSWIM_INVOICING_FAKE=1`). A new business gets its starter kit on opening
(`provisionSchool`, content in `@rswim/contracts` `starter-kits.ts`); a freediving club sets up sites, programs,
sessions and its team on `/dive/setup`. `RSWIM_PLATFORM_HOSTS` (comma-separated) lists the platform's own hosts, which schools can't claim.
Plan limits are a database trigger; plan features gate screens through `requireFeature`.
Importing from the previous system (SaaS stage 5, `@rswim/domain-imports`): `/admin/import` and `/dive/import` read
Excel, CSV or a shared Google sheet, place columns by header rules (and Claude with `ANTHROPIC_API_KEY`, digits
masked), preview every row's problem, save in one transaction, undo within 24h, and send imported families a link to
sign a new standing order.
Claude's allowance (SaaS stage 6): every Claude call reports its tokens (`trackUsage` in `@rswim/integrations`), each
piece of AI work is one row of `ai_usage` with its cost, and `plans.ai_monthly_actions` caps the month (`aiAllowance`
in `@rswim/domain-platform`); past the cap the copilot refuses, the parents' bot hands off and the worker skips Claude.
The owner sees the meter and what is connected on `/admin/connections` (`/dive/connections`). There she also picks the AI level
(`agent_settings.ai_level`: frugal, balanced, smart): it sets the model of the bot and of her assistant
(`aiModelFor`), and a cheaper level takes less of the allowance per answer (`aiActionTenths`).
WhatsApp track (`docs/whatsapp/PLAN.md`): a WhatsApp message from a number that is not a family, staff member or diver
opens a lead (`leads`, `@rswim/domain-crm` `leads.ts`; one list for swim and dive). Join requests, families, trial and
group seats and divers move it on through database triggers (`app.touch_lead`). The office works them on
`/admin/leads` (the club's front desk shows the same list) and answers on WhatsApp from the lead's page. With `comms.lead_bot_enabled` the parents' bot answers leads too
(`lead-bot.ts` in `@rswim/domain-copilot`): prices, programs and open places, collecting details one question at a time;
an optional module (lodging) joins it with `registerLeadBotModule`. It books a swim school's trial (`book_trial`, a brain
kind) and sends the sign-up link; the brain follows leads up at 10:00 (`lead_followup`: after the trial, or once when
they go quiet), trials are reminded the day before at 17:00, and `/admin/leads` shows the month's sources. The owner can connect the business's own number on Meta's Cloud API
(`/admin/integrations/whatsapp`, table `whatsapp_connections`, secrets sealed with the org's data key, webhook
`/api/webhooks/whatsapp/<connectionId>` signed with the app secret); the worker then sends through it, free text inside
WhatsApp's 24-hour window and the approved Meta template outside it (named per message on the templates screen), with
`RSWIM_MESSAGING_FAKE=1` on a fake that keeps the window rules. Going live (W10, `whatsapp-admin.ts`) is three steps on
that page (a club's is `/dive/whatsapp`; one component, `components/whatsapp/view.tsx`), asked by the owner and done by the worker: a connection check that also subscribes the business's webhook at
Meta, every message sent to Meta's review as a template (used only once approved; decisions synced every 30 minutes),
and a test message; with the fake, Meta is `FakeWhatsAppAdmin`. The bot's sign-up link is personal (`/i/<token>`, `lead-invite.ts`): the
person signs in with the invited phone and enters the school at once (`openInviteFamily` + `claim_by_phone`). Existing families (W6) ask the
bot to pay (a link for the open balance through the brain's `payment_link` level), for receipts, missing forms and
transport, and a family with a lesson tomorrow who owes forms gets `forms_reminder` at 17:00, once a week. A club's
registered diver gets the divers' bot (`diver-bot.ts`): coming dives, passes, missing forms, and booking a session
(a pass covers it, or the place is held with the link `/dive/me/pay/<bookingId>`). Every conversation sits on one screen
(`/admin/messages/chats`, `/dive/chats`; `chats.ts` in `@rswim/domain-comms`): the thread by phone, a reply, the bot's
last 30 days, and "I'm taking over" (`chat_holds`), which keeps every bot quiet for that number until it is given back.

Lodging (`docs/LODGING.md`, optional per business, `@rswim/domain-lodging`): rooms by kind with beds and private or shared
facilities, stays (dorms by the bed, overlaps refused in the database), `/admin/lodging` and `/dive/lodging` (today,
board, rooms). At 07:00 the worker (`lodging-morning-brief`) sends the day's check-ins, check-outs and rooms to prepare
on WhatsApp; the lead bot answers availability with `lodging_availability`.

A database per school (`docs/TENANT-DATABASES.md`): with the `/platform` switch on, a new school gets its own Supabase
project (worker `platform-provision-database`, Management API with `SUPABASE_ACCESS_TOKEN` + `SUPABASE_ORG_SLUG`, or a
local database with provider `local`). `DATABASE_URL` stays the platform's database (sign-in, schools, plans). Screens
use `withSession` (routes by school), the worker's `getDb()` is routed per run (`apps/worker/src/tenancy.ts`), and
lookups by public tokens use `acrossSchools`. Never call `db()` for a school's data in the web app: use `dbFor(orgId)`.

Freediving (`docs/FREEDIVING.md`): `organizations.vertical = 'freediving'` sends a club's people to `/dive` (owner,
manager, office, instructor, customer screens; `packages/domain/dive`). Dev personas **🤿 …** sign in to the seeded Eilat club.
New divers join a club from its link `/join/<slug>` (dev persona **נועם (צולל חדש)**) and upload their certification
cards for the desk to verify. Divers sign the club's forms (health, waiver, insurance) with uploads stored on the local disk with `RSWIM_FILES_FAKE=1`
(and on the live demo), or in Supabase Storage with `SUPABASE_SERVICE_ROLE_KEY` (bucket `RSWIM_FILES_BUCKET`).

Live demo (`docs/LIVE-DEMO.md`): `deploy/demo/Dockerfile` builds one container (Postgres, Inngest dev server, worker,
web) on fake data and fake providers with `RSWIM_DEMO_MODE=1` (persona sign-in in production builds, demo banner).
`pnpm --filter @rswim/seed demo:reset` drops and rebuilds its database; it refuses to run without `RSWIM_DEMO_MODE=1`.
Inngest allows at most 10 triggers per function (`apps/worker/test/functions.test.ts`).

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
12. **Readable in light and dark mode.** `dark:` follows the device's dark mode. Tints (`bg-brand-50/100`) switch by
    themselves; text in the brand or a status colour uses `text-brand-ink`, `text-ok-ink`, `text-danger-ink`,
    `text-warn-ink` (freediving: `var(--dive-*-ink)`); white text sits on `brand-600/700`, `ok-strong`, `danger` or
    `--dive-*-strong`; text on a bright fill uses `text-on-bright`. `packages/ui/test/contrast.test.ts` checks the token
    pairs for every brand hue in both modes and blocks the old classes.

## Domain glossary
See `docs/DOMAIN_GLOSSARY.md`. Quick ones: makeup = השלמה, freeze = הקפאה, standing order = הוראת קבע, after-school = צהרון, camp = קייטנה, trial = שיעור ניסיון, regulations = תקנון, household = billing unit.

## Phase discipline
Start of a phase: write `docs/phases/PHASE-N.md`. End: tests green, `docs/STATUS.md` updated, demo script in `docs/demos/PHASE-N.md`. Ambiguity → pick a default, log it in `docs/DECISIONS.md`, keep going.
