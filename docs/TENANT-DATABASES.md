# A database per school

Pit (2026-11-06): each school gets its own Supabase project, with every table and its starting data, created
automatically through the API. This page says how it works and what stays shared.

## Two kinds of database

- **The platform's database (the control plane)** is the one `DATABASE_URL` points at, as before. It keeps sign-in
  (Supabase Auth and the custom access-token hook), the list of schools, plans, subscriptions and the platform's
  invoices, the platform console, and every school that stays on the shared database.
- **A school's own database** is a separate Supabase project that runs the same migrations. It holds everything the
  school does: families, students, staff, schedule, money, messages, the brain. Nothing of the school's own data is
  written to the platform's database.

A switch in the platform console (`/platform` → "A database per school") decides what a new school gets: the shared
database (default, as today) or its own one. Existing schools are not moved; moving one with its data is not built yet.

## Sign-up

1. `create_school` makes the school in the platform's database as before and, when the switch says so, a
   `tenant_databases` row (`requested`) and a `platform.database_requested` event.
2. The owner lands on `/preparing` ("getting your system ready"), which refreshes every 5 seconds.
3. The worker (`platform-provision-database`) runs four steps, each safe to run again:
   - **create**: a random database password is sealed (AES-256-GCM, key derived from `RSWIM_MASTER_KEY`) and saved
     *before* the project is created, then `POST /v1/projects` in the platform's Supabase organization. A project with
     the same name is found again instead of created twice.
   - **wait**: `GET /v1/projects/{ref}` every 15 seconds until `ACTIVE_HEALTHY` (about 10 minutes at most), then the
     session-mode pooler address (`/config/database/pooler`, port 5432) is sealed next to the password.
   - **migrate**: every migration in `packages/db/migrations`.
   - **seed**: the marker `platform_settings.database_role = 'tenant'`, the school's row, plans, its subscription,
     published templates, its data key, the owner's sign-in row and membership, and the school's defaults added as
     the owner (as a shared school gets them at sign-up).
4. The status turns `ready`, `/preparing` opens `/admin/onboarding`, and from then on every screen of that school runs
   on its own database.

A step that keeps failing marks the row `failed` with the error; the console shows it with "Run again".

## Which database a request uses

- **Screens**: `withSession` asks the router (`packages/db/src/tenants.ts`) for the session's school. A school on the
  shared database gets the platform's database; a school whose own one is not ready yet goes to `/preparing`.
- **Worker**: `apps/worker/src/tenancy.ts` wraps every function. An event that names a school runs on that school's
  database; a scheduled sweep runs once per database (the platform's first, then each school's own), with step ids
  prefixed per school; platform plumbing (`CONTROL_ONLY`) always runs on the platform's database. `getDb()` reads the
  current database, so function bodies did not change.
- **Links and webhooks that do not name the school** (a payment link token, a processor callback, Grow, GHL, a staff
  invite): each school's own database is asked first, then the platform's.
- **Join links** (`/join/<slug>`) find the school by its slug in the platform's database.

## Keeping the two in step

- From the school up (`platform.tenant_changed`, from triggers on `memberships`, `org_settings`, `org_domains`):
  members go into `directory_memberships` (what sign-in reads to put the school in the token), the branding and the
  domains (the white-label login page reads them). Joining a school (an invite, a join link) also syncs at once, so
  the very next token carries the school.
- From the platform down (`platform.org_changed`, from triggers on `organizations` and `org_subscriptions`): the
  school's row and its subscription (plan limits and the owner's plan page read them there). The daily platform run
  copies plans and templates down again too.

## Settings (worker)

| Variable | What |
| --- | --- |
| `RSWIM_MASTER_KEY` | Needed: seals each database's password and address |
| `SUPABASE_ACCESS_TOKEN` | A personal access token (or OAuth token) of the platform's Supabase account. Never in the repo or chat |
| `SUPABASE_ORG_SLUG` | The platform's Supabase organization (Organization settings → slug) |
| `SUPABASE_REGION` | Optional, e.g. `eu-central-1` (Frankfurt) |
| `SUPABASE_INSTANCE_SIZE` | Optional, e.g. `micro` |
| `RSWIM_TENANT_ADMIN_URL` | Local provider only: a Postgres role allowed to create databases (default `DATABASE_URL`) |

The provider per school is `platform_settings.tenant_database_provider` (`supabase`, default, or `local` for demos
and tests). The web app needs `RSWIM_MASTER_KEY` too, to open schools' databases.

## Cost and limits (checked 2026-11-06)

Supabase's free plan allows two projects, and they pause after a week without use, so real schools need the Pro
plan: about $25 a month for the organization plus about $10 a month of compute per project on the smallest size.
The Management API allows 120 requests a minute per endpoint; creating a project takes one to three minutes.

## Not built yet / known limits

- Moving an existing school (with its data) from the shared database to its own one, and back.
- The platform console's usage counts (students, staff, venues) read the platform's database, so they show 0 for a
  school with its own database.
- A template a school with its own database shares stays in that database; the platform's review list does not see it.
- Two schools with their own databases could each add the same custom domain; the second copy up fails and is logged.
- Supabase Auth of each school's project is not used: everyone signs in through the platform's project.
- Real Supabase was not called: everything is tested on the local provider and a fake of the API's shapes.
