# Deploying Aqua Swim (SaaS stage 1)

Two environments, same code: **staging** follows `main`, **production** follows the `production` branch. Nothing
fake runs in either: no demo data, no persona sign-in (`RSWIM_ENV` turns it off), and real providers only where
their account exists (until then the matching `RSWIM_*_FAKE` switch stays on in staging and the feature stays off
in production).

| Piece | Host | Built from | Health |
|---|---|---|---|
| Web app (`apps/web`) | Vercel (Pro) | the repository, root `apps/web` | `GET /api/health` |
| Worker (`apps/worker`) | Railway | `deploy/production/worker.Dockerfile` | `GET /health` |
| Database + sign-in | Supabase (Pro), region Frankfurt | migrations in `packages/db/migrations` | |
| Background jobs | Inngest Cloud | the worker registers at `https://<worker>/api/inngest` | |
| DNS | Cloudflare | `aqua-swim.co.il` | |
| Errors | Sentry | `SENTRY_DSN` | |

`deploy/production/web.Dockerfile` builds the web app for any container host, in case it moves off Vercel.

## Releasing

1. A pull request runs CI (checks + E2E) and builds both containers (`.github/workflows/images.yml`; the worker image
   is also started against an empty Postgres and must answer `/health`).
2. Merging to `main` deploys **staging**: Vercel builds the web app, Railway builds the worker. The worker runs
   `deploy/production/release.sh` before it starts: migrations under an advisory lock, then the production seed
   (`pnpm --filter @rswim/seed seed:production`: the three plans at the approved prices and the starter regulations;
   never demo data).
3. **Production**: Actions → *Promote to production* → Run. The `production` environment waits for Pit's approval,
   checks CI is green on that commit, and moves the `production` branch. Vercel and Railway deploy from it.
4. Rollback: run *Promote to production* with the previous commit, or *Instant Rollback* in Vercel and *Redeploy*
   of the previous deployment in Railway. Migrations are forward-only: a rollback that crosses a migration needs a
   follow-up migration, never a manual edit.

## One-time setup (after Pit opens the accounts)

GitHub
- Settings → Environments → `production`: required reviewer Pit.
- Settings → Branches: protect `production` (only GitHub Actions may push).

Supabase (two projects: `aqua-staging`, `aqua-production`)
- Authentication → Hooks: *Custom access token* → Postgres function `public.custom_access_token_hook`.
- Authentication → Providers: email (password) on; phone on, provider Twilio Verify (below).
- Authentication → SMTP: custom SMTP through Resend (below), sender `no-reply@aqua-swim.co.il`.
- Authentication → URL configuration: site URL `https://app.aqua-swim.co.il` (staging: `https://staging.aqua-swim.co.il`).
- Storage: bucket `dive-documents`, private.
- Database → Backups: daily backups are included in Pro; turn on Point-in-Time Recovery for production before the
  pilot (BACKUPS below).

Vercel (project `aqua-web`, root directory `apps/web`, framework Next.js, install `pnpm install --frozen-lockfile`)
- Settings → Git: production branch `production`. Every push to `main` is a preview deployment; assign the domain
  `staging.aqua-swim.co.il` to the `main` branch.
- Environment variables per environment (Preview = staging, Production = production): the web column below.

Railway (project `aqua`, environments `staging` and `production`, service `worker`)
- Source: this repository; staging branch `main`, production branch `production`.
- Variable `RAILWAY_DOCKERFILE_PATH=deploy/production/worker.Dockerfile`; health check path `/health`; one replica.
- Variables: the worker column below.

Inngest (apps `aqua-staging`, `aqua-production`)
- Sync the app URL `https://<railway worker domain>/api/inngest`; copy the event key and signing key into the worker.
- Turn on failure notifications to Pit's email.

Cloudflare
- `app.aqua-swim.co.il` and `staging.aqua-swim.co.il` → Vercel (CNAME). Schools get `<slug>.aqua-swim.co.il`
  (wildcard CNAME to Vercel, stage 2).
- SPF, DKIM and DMARC records from Resend.

Sentry: two projects (`aqua-web`, `aqua-worker`), alerts to Pit's email on new issues.

Uptime: a monitor (Better Stack or UptimeRobot, free) on `https://app.aqua-swim.co.il/api/health` and the worker's
`/health`, every minute, alerting Pit by email and SMS. Both return 503 when the database does not answer.

### Email and SMS

The app sends no email or SMS itself: Supabase Auth does (sign-in codes, password reset, invitations). WhatsApp to
families goes through the messaging provider, not SMS.
- Email: Resend. Verify the domain, create an SMTP key, and set it in Supabase → Authentication → SMTP
  (host `smtp.resend.com`, port 465, user `resend`).
- SMS: Twilio Verify (supported by Supabase out of the box, sends to Israeli numbers). Account SID, auth token and
  Verify service SID go into Supabase → Authentication → Providers → Phone. An Israeli SMS provider would need
  Supabase's *Send SMS* hook; not worth it before the pilot.

## Environment variables

Secrets live only in the host's settings: never in the repository, never in chat. `RSWIM_MASTER_KEY` is generated
once per environment (`openssl rand -base64 32`), kept in Pit's password manager, and never changed without a key
rotation: it unlocks every school's encrypted data.

| Variable | Web | Worker | Notes |
|---|---|---|---|
| `RSWIM_ENV` | ✓ | ✓ | `staging` or `production`; turns off persona sign-in, tags Sentry events |
| `DATABASE_URL` | ✓ | ✓ | Supabase connection string. Web: the transaction pooler (port 6543). Worker: the session pooler or direct connection (it migrates) |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ (build) | | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ (build) | | public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | | secret; file uploads (Storage) |
| `RSWIM_FILES_BUCKET` | ✓ | | `dive-documents` (the default) |
| `RSWIM_MASTER_KEY` | ✓ | ✓ | secret; same value in web and worker of one environment |
| `RSWIM_PUBLIC_URL` | | ✓ | `https://app.aqua-swim.co.il`; links in messages |
| `RSWIM_PLATFORM_HOSTS` | ✓ | ✓ | `app.aqua-swim.co.il,staging.aqua-swim.co.il,aqua-swim.co.il` |
| `INNGEST_EVENT_KEY` | | ✓ | secret |
| `INNGEST_SIGNING_KEY` | | ✓ | secret |
| `ANTHROPIC_API_KEY` | ✓ | ✓ | secret; with a monthly spend limit set in the Anthropic console |
| `SENTRY_DSN` | ✓ | ✓ | per project |
| `NEXT_PUBLIC_SENTRY_DSN` | ✓ (build) | | the web project's DSN, for browser errors |
| `GROW_WEBHOOK_SECRET` | ✓ | | when Grow is live (SaaS stage 3) |
| `GHL_API_TOKEN` / `GHL_WEBHOOK_PUBLIC_KEY` | | ✓ / ✓ web | only if the platform keeps GHL as its own CRM |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_SLUG` | | ✓ | only when the per-school database switch is turned on |
| `LOG_LEVEL` | | ✓ | `info` |
| `RSWIM_SKIP_RELEASE` | | optional | `1` starts the worker without migrating (restores) |

Until a provider's account exists, staging keeps its fake on (`RSWIM_GROW_FAKE=1`, `RSWIM_INVOICING_FAKE=1`,
`RSWIM_MESSAGING_FAKE=1`). Never set `RSWIM_DEV_AUTH`, `RSWIM_DEMO_MODE` or any `*_FAKE` in production.

## Backups and the restore drill

- Supabase Pro keeps daily backups for 7 days; production adds Point-in-Time Recovery before the pilot.
- `deploy/production/restore-drill.sh` proves a backup restores: it dumps the source (read-only), restores into a
  throwaway database, compares row counts of the key tables, prints the time it took and deletes both the copy and
  the dump. Run it monthly on staging and once on production before the pilot, from a trusted machine, with the
  database owner's connection string (row counts must see past RLS).
- A real restore: Supabase → Database → Backups → Restore (or PITR to a moment), with the worker scaled to zero (or
  `RSWIM_SKIP_RELEASE=1`) until the restore finishes.
