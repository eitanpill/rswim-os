# Phase 8 demo script

Everything here uses invented demo data: families, children, schools, institutions and amounts are fake.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
export RSWIM_MASTER_KEY=$(node -e "console.log(Buffer.alloc(32, 7).toString('base64'))")  # fake demo key
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# So taps become WhatsApp messages (to the in-memory fake) and institution invoices print (fake Green Invoice):
RSWIM_MESSAGING_FAKE=1 RSWIM_INVOICING_FAKE=1 pnpm --filter @rswim/worker dev   # and `npx inngest-cli dev`
```

On top of Phase 7 the seed adds: a school and the route "הסעת אופק" with דני as escort and three boys (יואב כהן
first) and last week's run tapped end to end; a Hanukkah intensive course (Sunday and Tuesday, its own regulations
without makeups, four children), a summer camp week (a group per day, Reut and Noa, twelve children); and the school
"בית ספר אופק (דמו)" paying for its third graders' Thursday group, with September invoiced and half paid and
October drafted.

## 1. "Arrived at the pool" (the acceptance criterion)
1. Sign in as **בעלים** and open **עוד › הסעות**. If today is not the route's day, pick **הסעת אופק** under
   **פתיחת נסיעות** and tap **פתיחת נסיעה במסלול**.
2. Sign in as **מלווה · דני** on a phone-sized window. Today's run is on the home screen. Tap **עלה/תה** next to
   יואב, then the big button **יצאנו מבית הספר**, then **הגענו לבריכה**.
3. As the owner, **עוד › הודעות › יומן**: "🏊 הגענו לבריכה! יואב…" is waiting for (or went to) his mother. A child
   marked **לא הגיע/ה** gets nothing.
4. As **הורה · מיכל כהן**, open יואב's card: "ההסעה היום: הגיעו לבריכה ב-…".
5. Carry on: **נכנסים למים**, **יצאו מהמים**, **יצאנו מהבריכה**, **ירד/ה** for each child (the family hears the
   drop-off point), **סיום נסיעה**. The run shows how long they were in the water against the lesson.
6. **הסעות › דוח מים**: last week's run shows the group got in late and how many minutes they had.

## 2. Courses and camps
1. **עוד › קורסים וקייטנות**: the course and the camp week with seats taken; the camp shows its staff ratio.
2. Open **קורס חנוכה מרוכז**: it has its own regulations (no makeups), two weekly groups and four children. Register
   another child; register past the capacity and it refuses with the reason.
3. **רשימת משתתפים להדפסה**: children, birth dates, parents' phones, water fear, the lesson dates. Print or save as
   PDF.
4. In the camp week, remove Noa from the staff and try to register more children: it refuses once the ratio (8 per
   staff member) would break, naming how many staff are needed.

## 3. An institution
1. **עוד › מוסדות**: open balances, with September's invoice partly paid.
2. Open **בית ספר אופק (דמו)**: the contract (120 ₪ per child per month), its group, and the invoices. September
   shows the tax invoice number (fake), the due date and what is left; record the rest of the payment and it turns
   **שולמה**, with a receipt number.
3. Approve October's draft (**אישור והפקה**): the worker prints the tax invoice and sets the due date.
4. **דוח נוכחות לחודש** (change the month in the address to 2026-09): the pupils against September's lessons.
5. The families of those pupils are not billed for that group (**כסף › הרצות** drafts skip it).
