# Phase 10 demo script

Everything here uses invented demo data: schools, families, domains and amounts are fake. Billing runs on the fake
Grow; no real card or account is involved.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
export RSWIM_MASTER_KEY=$(node -e "console.log(Buffer.alloc(32, 7).toString('base64'))")  # fake demo key
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# The worker verifies domains and bills schools; with these fakes nothing leaves the machine:
RSWIM_DNS_FAKE=1 RSWIM_GROW_FAKE=1 pnpm --filter @rswim/worker dev   # and `npx inngest-cli dev`
```

The seed adds three plans (בסיסי, צמיחה, מקצועי), puts the demo school on מקצועי and the second demo school on צמיחה,
makes the **מנהל/ת פלטפורמה** persona a platform admin, and publishes three templates built from the demo school:
its regulations, its catalog with prices, and its WhatsApp wording. Reseeding removes any school the newcomer opened.

## 1. A new school signs up (the acceptance criterion)
1. On `/login` pick **בית ספר חדש (הרשמה)**. With no school yet you land on **פתיחת בית ספר לשחייה**.
2. Name **גלים (דמו)**, id `galim`, plan **בסיסי** (14 free trial days). Tap **פתיחת בית הספר**.
3. You are the owner of the new school, on **צעדים ראשונים**, with a trial banner on top.
4. **עוד › מאגר תבניות**: install **תקנון R-SWIM**, **קטלוג חוגים ומחירון לדוגמה** and **נוסחי הודעות WhatsApp**.
   The catalog adds programs, levels and a draft price list; publish it on **מחירונים** to tick that step.
5. **עוד › מיתוג ודומיין**: display name **גלים**, colour **אלמוג**, save; the header and buttons turn coral. Add the
   domain `galim.localhost`. It shows the TXT record to create, and the worker (fake DNS) verifies it within moments.
6. Open `http://galim.localhost:3000/login`: the sign-in page reads "גלים" in coral.
7. Add a venue on **בריכות**. A second one is refused: "התוכנית שלכם כוללת בריכה אחת בלבד…".

## 2. The platform console
1. Sign in as **מנהל/ת פלטפורמה**. **בתי ספר** lists every school with its plan, status, usage and last invoice.
2. Under **ניהול** for גלים: **סיום תקופת ניסיון**, then a standing order id `fake-mandate-fail` (any id containing
   "fail" is declined by the fake).
3. **הפעלת חיוב** for this month. The worker issues the invoice and the charge is declined: the school is **תשלום
   בפיגור**, and its owner sees a red banner and the failed invoice on **התוכנית שלי**.
4. Change the standing order to `fake-mandate-galim` and run billing again: the invoice is paid and the school is
   active. Ten days past due without payment (`grace_days`) the daily job suspends the school: its office sees only its
   plan page, while parents and instructors keep working.
5. On the demo school's **מאגר תבניות**, share the school's regulations; it appears under **תבניות לבדיקה** here for
   approval before other schools see it.

## 3. Plans and features
- **עוד › התוכנית שלי**: plan, status, usage against each limit and the platform's invoices.
- A school whose plan lacks reports, courses, transport, institutions or the copilot doesn't see those screens under
  **עוד**, and a direct link lands on its plan page with the reason.

## Tests
- `packages/domain/platform/test/policies.test.ts`: every SaaS rule, 100% coverage.
- `packages/db/test/rls/saas.test.ts`: sign-up, limits, who can change subscriptions and domains, host branding before
  sign-in, template submission and the platform console.
- `packages/seed/test/saas.test.ts`: templates install into a new school, domain checks, billing with paid and declined
  charges, trial end and suspension.
- `apps/web/e2e/platform.spec.ts`: the acceptance criterion end to end.
