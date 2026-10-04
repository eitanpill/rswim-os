# Phase 7 demo script

Everything here uses invented demo data: families, children, lessons and receipts are fake.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
export RSWIM_MASTER_KEY=$(node -e "console.log(Buffer.alloc(32, 7).toString('base64'))")  # fake demo key
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# So absences earn their credit and freeze or leave requests are decided:
RSWIM_INVOICING_FAKE=1 pnpm --filter @rswim/worker dev   # and `npx inngest-cli dev`
```
Open http://localhost:3000 on a phone-sized window and sign in as **הורה · מיכל כהן (דמו)**.

On top of Phase 6 the seed issues invoice-receipts (fake provider) for September's payments.

## 1. Absence → makeup → receipt (the acceptance criterion)
1. **לו״ז**: tap **לא נגיע** on a lesson a few days out. It says "ההודעה התקבלה"; a moment later the worker decides
   it by the regulations ("מזכה בהשלמה").
2. **המשפחה**: the credit sits under **השלמות לקבוע**. **קביעת השלמה** lists lessons with a free seat; **קביעה**.
3. **תשלומים › חשבוניות וקבלות › צפייה** opens the receipt; **הורדה** downloads it (an HTML copy under the fake
   provider, the provider's PDF once Green Invoice is connected).

## 2. The child card
1. **המשפחה › הילדים**: tap a child. The level, its skills (achieved or in progress) and the next level, then the
   next two weeks of lessons.
2. **בקשת הקפאה**: pick dates and a reason, **שליחת בקשת הקפאה**. Under **הבקשות שלכם** the answer appears once
   the worker decided it (waiting for the owner's approval when the regulations say so). A pending request can be
   cancelled.
3. **עזיבת הקבוצה** sends a leave request; the answer names the last month to pay, by the moment it was sent.

## 3. The companion pass
1. **כרטיס** shows, on a lesson day, the child, group, venue, time, how many companions may enter, a live clock and
   a QR code. Other days it says when the next one appears.
2. Scan the code (or open its link) on another phone with no login: "בתוקף להיום". Yesterday's pass says it
   expired; an altered one says it is not valid.
