# Phase 1 demo script

Everything here uses invented demo data. No real LeadYourWay (GHL) account is touched: the import runs against an
in-memory GHL loaded with fake contacts.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# Optional, for the GHL import (section 6): the worker with a fake GHL
RSWIM_GHL_FAKE=1 RSWIM_GHL_FAKE_CONTACTS=packages/domain/crm/test/fixtures/ghl-contacts.json pnpm --filter @rswim/worker dev
npx inngest-cli dev   # in another terminal
```
Open http://localhost:3000 on a phone-sized window and sign in as **בעלים · רעות (דמו)**. Tap **עוד**.

## 1. Set up Har Homa (acceptance criterion 1)
1. **מקומות ובריכות › מקום חדש**: name it "הר חומה", type **קאנטרי קלאב**, tap **שמירה**. You land on the venue page.
2. Under **הוספת בריכה** enter "בריכה ראשית", 4 lanes, **הוספת בריכה**.
3. Open **הוספת חלון זמן**: **שני**, **נשים ובנות**, 16:00–19:00, tick lanes 1–4, from 1.9.2026. Add it.
   Add a second one for **רביעי**, **גברים ובנים**, same hours and lanes.
4. Try a mixed window on Monday 17:00–18:00 on lane 1: it is refused with "מסלול כבר תפוס בחלון אחר באותו זמן".
5. Back to **עוד › מחירונים**. Under **מחירון חדש**: "הר חומה ספטמבר", venue הר חומה, from 1.9.2026, **יצירת טיוטה**.
   Add **קבוצת ילדים · מנוי חודשי · 330**, then **פרסום**. The list is now in effect and says it is locked.
6. Open **גרסה חדשה מתאריך**: "הר חומה ינואר", from 1.1.2027, **יצירת גרסה**. The ₪330 price was copied into the
   draft. Save **350** for the same program and type (it replaces the copied price), then **פרסום**.
7. **מחירונים › בדיקת מחיר**: הר חומה, קבוצת ילדים, מנוי חודשי. On 15.10.2026 the answer is ₪330 from the September
   list; on 15.1.2027 it is ₪350 from the January list.

The same flow runs as a browser test: `apps/web/e2e/core-setup.spec.ts`.

## 2. Policies
1. **עוד › מדיניות** shows the school-wide version from 1.9.2026 (the documented defaults). Each section opens to
   show its rules: makeups, absences, billing, discounts and so on.
2. Pick the venue **קאנטרי הדמו - ירושלים** and tap **הצגה**. Fields are blank ("ירושה") except the venue's own
   overrides, and each field says what it inherits and from where.
3. Saving creates a new version from the chosen date. A version already in effect never changes; the database
   refuses it even outside the UI.

## 3. Programs and levels
**עוד › תוכניות ורמות**: four programs with their level ladders. Add a level, move it up or down, edit a program.

## 4. Staff
1. **עוד › צוות**: Noa shows a "lifeguard expiring" badge and Dani an "expired first aid" badge.
2. Open **אסף**: certificates, weekly availability, and two pay rules (hourly by payslip for groups, per session
   by invoice for privates). A new pay rule from a date ends the previous one in the same slot.
3. **הזמנה למערכת** creates a one-time invite link (shown once, valid for 7 days).

## 5. Families
1. **משפחות**: search by family name, a guardian's phone (e.g. 0500000106) or a child's name.
2. Open **משפחת כהן**: guardians (with whether each is linked to the CRM), students with level and flags, and sibling
   relations. Edit a guardian's phone: the change is queued for LeadYourWay.
3. **משפחה חדשה** creates a family and its first guardian in one form.

## 6. LeadYourWay contacts (acceptance criterion 2)
1. **עוד › חיבור ל-LeadYourWay** shows the demo location as connected, with the R-SWIM tag map.
2. With the worker running in fake mode, tap **ייבוא עכשיו**. Refresh: the run shows how many families were created,
   linked by phone or email, already linked, and duplicates inside GHL to review.
3. Tap it again: the second run only finds already-linked contacts. Nothing is duplicated.

The import, the push back to GHL and the webhook path are covered by `packages/domain/crm/test/import.test.ts` and
`webhook.test.ts`.
