# Phase 0 demo script

Everything here uses invented demo data.

## Setup (once)
```bash
pnpm i
# Postgres 16 running locally (or `pnpm db:start` with the Supabase CLI)
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
export RSWIM_MASTER_KEY=$(openssl rand -base64 32)
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
```
Open http://localhost:3000 on a phone-sized window.

## 1. Hebrew RTL login
1. You land on **כניסת צוות**. Text runs right to left; the phone sign-in link for parents is under the form.
2. Under **כניסת דמו** there is one button per role.

## 2. Owner shell
1. Tap **בעלים · רעות (דמו)**. You land on **מרכז הבקרה** with today's Gregorian and Hebrew date. On a holiday or Chol HaMoed a badge says there are no lessons.
2. The bottom bar reads, right to left: היום · משפחות · לוח קבוצות · כספים · עוד. Tap **כספים**: the tab is highlighted and the page says which phase builds it.
3. Tap **English**: the page flips to left-to-right English. Tap **עברית** to return.
4. Tap **יציאה**.

## 3. Instructor and parent shells
1. Sign in as **מדריך/ה**: **היום שלי**, the instructor app. Turn the network off in dev tools: an offline banner appears.
2. Type `/admin` in the address bar: you are sent back to **היום שלי**.
3. Sign out, sign in as **הורה · מיכל כהן**: **המשפחה שלי** with quick actions (enabled in Phase 7). `/admin` and `/instructor` both send you back.

## 4. Isolation and exactly-once (terminal)
```bash
pnpm test:rls                                   # 38 isolation checks across two orgs and every role
pnpm --filter @rswim/domain-core test           # outbox exactly-once, crypto
pnpm --filter @rswim/web exec playwright test   # the shells, on a Pixel 7 viewport
```
