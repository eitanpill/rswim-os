# Deploying Aqua Swim (SaaS stage 1)

Two environments, same code: **staging** follows `main`, **production** follows the `production` branch. Neither
has demo data or persona sign-in (`RSWIM_ENV` turns it off). Real providers run only where their account exists:
until then the matching `RSWIM_*_FAKE` switch stays on in staging, and the feature stays off in production, where
the worker refuses to start with any fake or dev switch on.

| Piece | Host | Built from | Health |
|---|---|---|---|
| Web app (`apps/web`) | Vercel (Pro) | the repository, root `apps/web` | `GET /api/health` |
| Worker (`apps/worker`) | Railway | root `railway.json` → `deploy/demo/Dockerfile` with `RSWIM_IMAGE=worker` (the same image as `deploy/production/worker.Dockerfile`) | `GET /health` |
| Database + sign-in | Supabase (Pro), region Ireland (eu-west-1) | migrations in `packages/db/migrations` | |
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

## Staging as it is set up (since 2026-11-18)

Staging was set up by hand before production existed, and differs from the original plan in a few names. Production
gets its own copy of every piece, so nothing below changes when production is added.

| Piece | Staging |
|---|---|
| Web | Vercel team `eitan-pelles-projects`, project `aqua-web`. `main` deploys to Vercel's **Production** environment of that project, so staging's variables are set on *Production* there. Domain `staging.aqua-swim.co.il` |
| Worker | Railway project `considerate-bravery`, service `rswim-demo` (the name is misleading: it is the staging worker, not the sales demo), branch `main`, `RSWIM_IMAGE=worker` |
| Database + sign-in | Supabase project `aqua-staging` (ref `vcibkalclwvrkubcqkei`, Frankfurt, free organization) |
| Background jobs | Inngest Cloud org "LesdYourWay", environment *Production*, app `rswim-os` |
| Errors | Sentry org `eitan-pelles` (EU), projects `aqua-web` and `aqua-worker`, environment tag `staging` |
| Email / SMS | Resend (`mail.aqua-swim.co.il`) / Twilio trial (Verify service "Aqua Swim") |

Staging keeps `RSWIM_ENV=staging` and its fakes (`RSWIM_MESSAGING_FAKE`, `RSWIM_GROW_FAKE`, `RSWIM_INVOICING_FAKE`)
until each provider is live.

## Production: one-time setup

Everything for production is separate from staging: its own database, its own master key, its own Vercel project,
Railway project and Inngest account. A mistake on staging can then never reach a real school, and staging needs no
change. Do the steps in this order; nothing is public until step 8.

1. **Supabase**: an organization on the Pro plan (daily backups, no pausing), project `aqua-production`, region
   Ireland (eu-west-1), a database password of letters and digits only (no characters a URL would need to escape),
   kept in Pit's password manager.
   - Connection strings: Supabase → **Connect** → Direct, then switch on **Use IPv4 connection** (free). That gives the
     shared pooler, `postgresql://postgres.<ref>:<password>@aws-1-eu-west-1.pooler.supabase.com:<port>/postgres`:
     transaction pooler port 6543 for Vercel, session pooler port 5432 for Railway. Without the switch the Pro plan
     shows the *dedicated* pooler and `db.<ref>.supabase.co`, which are IPv6 only: Vercel fails with `ENOTFOUND`.
   - Authentication → URL configuration: site URL `https://app.aqua-swim.co.il`, redirect URLs
     `https://app.aqua-swim.co.il/auth/confirm` and, until step 8, `https://aqua-production.vercel.app/**` (the
     confirmation e-mail of the step 7 test owner comes back there).
   - Authentication → Providers: email on, *Allow new users to sign up* on, *Confirm email* on; phone on, Twilio Verify
     (a paid Twilio account: the trial sends only to verified numbers and adds a prefix).
   - Authentication → SMTP: Resend, host `smtp.resend.com`, port 465, user `resend`, a **new** Resend API key for
     production, sender `no-reply@mail.aqua-swim.co.il`.
   - Storage: bucket `dive-documents`, private.
   - The tables come from the worker's first start (step 5), never from the dashboard or the Supabase MCP: the
     migrations must go through Drizzle's journal. **After** the first start: Authentication → Hooks → *Custom access
     token* → `public.custom_access_token_hook` (the function exists only after the migrations).
2. **Master key**: `openssl rand -base64 32` on Pit's computer, straight into the password manager. A new value, not
   staging's. It goes into both Vercel and Railway (steps 3 and 4) and nowhere else.
3. **Vercel**: a second project in the same team, `aqua-production`, from `eitanpill/rswim-os`, root directory
   `apps/web`, framework Next.js, install command `pnpm install --frozen-lockfile`.
   - Settings → Environments → Production → Branch Tracking: `production`. Vercel saves it only once a deployment of
     that branch exists, so after the first Promote (step 5): Deployments → Create Deployment → `production`, then save.
   - Settings → Functions → Function Region: Dublin (`dub1`), next to the database.
   - Settings → Git → Ignored build step, so this project builds only the production branch:
     `if [ "$VERCEL_GIT_COMMIT_REF" = "production" ]; then exit 1; else exit 0; fi`
   - Environment variables (Production): the web column below, with `RSWIM_ENV=production` and
     `NEXT_PUBLIC_RSWIM_ENV=production`.
   - Domain `app.aqua-swim.co.il` is added in step 8, not before.
4. **Railway**: a new project `aqua-production`, one service (`rswim-worker`) from `eitanpill/rswim-os`, branch `production`,
   one replica, a generated public domain (the Inngest URL). Variables: the worker column below, with
   `RSWIM_IMAGE=worker`, `RSWIM_ENV=production`, `RSWIM_PUBLIC_URL=https://app.aqua-swim.co.il`.
   `DATABASE_URL` is the session pooler (port 5432) of `aqua-production`: the worker migrates.
5. **First release** (no one can reach it yet): Actions → *Promote to production* → Run. The first run creates the
   `production` branch. Railway builds the worker, which migrates the empty database and seeds the three plans;
   Vercel builds the web app on its `.vercel.app` address. Then the Supabase auth hook (step 1).
6. **Inngest**: a separate Inngest account (or organization) for production, so staging's runs never count against it
   and a staging event can never reach production. Sync `https://<railway domain>/api/inngest` once, copy the event
   key and the signing key into Railway, redeploy. From then on each deploy syncs itself. The free plan allows 50,000
   runs a month; staging used about 27,000 in its first three weeks with no real customers, so plan a paid Inngest
   plan before the pilot grows.
7. **Checks before anyone sees it**: `/api/health` on the `.vercel.app` address and the worker's `/health` both answer
   200 (in production they answer 503 and name the variable when a key is missing or a fake or dev switch is on, and
   the worker refuses to start); sign up a test owner through to the card page; the Inngest dashboard lists the
   functions; a test error reaches Sentry under environment `production`. Then delete the test owner.
8. **Going public** (needs Pit's go-ahead): add `app.aqua-swim.co.il` to the Vercel project, CNAME it in Cloudflare
   to Vercel, wait for the certificate, run the checks of step 7 again on the real address, and turn on the uptime
   monitor (below).

GitHub, once: Settings → Environments → `production` with Pit as required reviewer, and protect the `production`
branch so only GitHub Actions moves it. *Promote to production* then waits for Pit's approval every time.

What stays off in production until its own account and test exist (each is a feature that stays off, never a fake):
WhatsApp per business (Meta), card payments per business (a processor's adapter tested on its sandbox; Cardcom's
adapter exists and turns on with `RSWIM_CARDCOM_LIVE=1`), the platform's subscription charging (Cardcom, on once
`PLATFORM_CARDCOM_*` is set, `docs/payments/CARDCOM.md`) and its invoices (Morning), a database per school (`SUPABASE_ACCESS_TOKEN`).

Cloudflare
- `app.aqua-swim.co.il` → Vercel project `aqua-production`; `staging.aqua-swim.co.il` → `aqua-web`. Schools get
  `<slug>.aqua-swim.co.il` later (wildcard CNAME to the production project).
- SPF, DKIM and DMARC records from Resend.

Sentry: the same two projects (`aqua-web`, `aqua-worker`); events carry the environment (`staging` or `production`),
and alerts on new issues in `production` go to Pit's email.

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
  - Twilio: upgrade the account (a trial sends only to verified numbers), create a Verify service named "Aqua Swim"
    with SMS on and code length 6. Verify picks the message language from the number's country, so Israeli numbers
    get Hebrew; Supabase's own SMS template is not used with Verify.
  - Supabase (each project: staging, then aqua-production): Providers → Phone on, provider *Twilio Verify*, the three
    values above, OTP expiry 600 s, code length 6. Rate Limits → *SMS messages sent per hour* up from the default 30
    (start with 150; the hourly cap is for the whole project, so a busy morning hits it first).
  - Nothing goes into Vercel or Railway: the app calls `signInWithOtp` / `verifyOtp` and maps the Supabase error code
    to a message (`apps/web/src/lib/auth/sms-errors.ts`): wait for the limit, the provider failed, or the code
    expired. A failed send logs only the code, never the number.
  - Store reviewers and tests use Supabase's *Test phone numbers* (fixed code, no SMS sent).

## Environment variables

Secrets live only in the host's settings: never in the repository, never in chat. `RSWIM_MASTER_KEY` is generated
once per environment (`openssl rand -base64 32`), kept in Pit's password manager, and never changed without a key
rotation: it unlocks every school's encrypted data.

| Variable | Web | Worker | Notes |
|---|---|---|---|
| `RSWIM_ENV` | ✓ | ✓ | `staging` or `production`; turns off persona sign-in, tags Sentry events; `production` also refuses fakes and dev switches and checks the required keys |
| `NEXT_PUBLIC_RSWIM_ENV` | ✓ (build) | | the same value, for browser errors in Sentry |
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
| `RSWIM_WORKER_TICK_MINUTES` | | optional | how often the outbox relay and message dispatch run (default 3; `1` on a paid Inngest plan) |
| `INNGEST_SERVE_ORIGIN` | | optional | public worker origin for Inngest; defaults to `https://$RAILWAY_PUBLIC_DOMAIN` |
| `ANTHROPIC_API_KEY` | ✓ | ✓ | secret; with a monthly spend limit set in the Anthropic console |
| `SENTRY_DSN` | ✓ | ✓ | per project |
| `NEXT_PUBLIC_SENTRY_DSN` | ✓ (build) | | the web project's DSN, for browser errors |
| `GROW_WEBHOOK_SECRET` | ✓ | | when Grow is live: verifies the processor's callbacks, including the owner's saved card (`/api/webhooks/platform-card`) |
| `PLATFORM_CARDCOM_TERMINAL_NUMBER`, `PLATFORM_CARDCOM_API_NAME` | ✓ | ✓ | the platform's own Cardcom terminal: opens the sign-up card step (`/billing/card`) and charges the schools' subscriptions; unset = the card step stays closed |
| `PLATFORM_CARDCOM_API_PASSWORD` | ✓ | ✓ | secret; the same terminal's API password (refunds only) |
| `RSWIM_CARDCOM_LIVE` | ✓ | ✓ | `1` lets a business that connected Cardcom take real payments; set only after the test in `docs/payments/CARDCOM.md` |
| `GHL_API_TOKEN` / `GHL_WEBHOOK_PUBLIC_KEY` | | ✓ / ✓ web | only if the platform keeps GHL as its own CRM |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_SLUG` | | ✓ | only when the per-school database switch is turned on |
| `RSWIM_IOS_APP_IDS` | ✓ | | the store app's `<Team ID>.il.co.aquaswim.app`; lets links open the iPhone app (`docs/store/APP.md`) |
| `RSWIM_ANDROID_CERT_SHA256` | ✓ | | the Play signing fingerprints, comma-separated; lets links open the Android app |
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
