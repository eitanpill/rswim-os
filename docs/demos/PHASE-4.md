# Phase 4 demo script

Everything here uses invented demo data. Payments and receipts go to in-memory fakes of Grow and Green Invoice:
no card is charged and no tax document is issued anywhere.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
# A throwaway local key, so the payer's ID number can be stored encrypted:
export RSWIM_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# Optional, so approved runs are collected and payments get receipts (fake providers):
RSWIM_GROW_FAKE=1 RSWIM_INVOICING_FAKE=1 pnpm --filter @rswim/worker dev   # and `npx inngest-cli dev`
```
Open http://localhost:3000 on a phone-sized window and sign in as **בעלים · רעות (דמו)**.

On top of Phase 3 the seed adds standing orders for most families, September's run approved and paid (by standing
order, Bit, or cash an instructor still holds), one declined card with an open collection case, a Ministry of Defense
reimbursement profile on the family with private lessons, a freeze waiting for approval, and October's run drafted
and waiting for review. The demo price list has no price for adults on purpose.

## 1. The pre-run review (acceptance criterion 2)
1. **כספים › חיובים חודשיים**. October is a draft with flags; September is approved.
2. Open **10/2026**. Under **דגלים לבדיקה**:
   - **חיוב בלי רישום**: "הוראת קבע פעילה בלי אף מקום בקבוצה" (a family with no child in any group).
   - **רישום בלי חיוב**: "אין מחיר במחירון לתוכנית הזו" (the adults group).
   - **הוראת קבע כפולה**: "2 הוראות קבע פעילות למשפחה אחת".
   - **אין הוראת קבע**: the family owes and will get a payment link instead.
3. Below, every family's lines with the reason for each amount (full month, prorated, frozen, sibling discount) and
   last month's total.
4. Fix something (cancel the duplicate standing order on that family's card, for example), come back and press
   **להכין טיוטה מחדש**: the flag is gone. **לאשר ולגבות** posts the run to the ledger and locks it; with the worker
   running, each family's standing order is charged and the others get a payment link.

## 2. A failed charge starts dunning (acceptance criterion 3)
1. **כספים** (debts): the declined family shows **הוראת קבע נכשלה** and **תיק גבייה: פתוח**, with the debt's age.
2. With the worker running, the daily job retries the card one day after the failure and every three days after that,
   up to three times, then hands the case to the owner after ten days (all in **מדיניות › גבייה וחובות**).
3. **מחיקת החוב** writes the debt off in the ledger and closes the case; paying it closes the case too.

## 3. A reimbursement receipt (acceptance criterion 4)
1. **עוד › פרופילי החזר**: **משרד הביטחון (דמו)** needs the payer's ID, lists the session dates and splits per month.
2. Open the family with private lessons (רועי's family). Under **חשבוניות וקבלות › פרטי חשבונית והחזרים** the
   profile is set and the ID shows only as ****0018.
3. **לשלוח קישור תשלום** for the amount owed. With the worker running, the fake link is created; pay it by sending a
   signed `link.paid` webhook (see `packages/integrations/src/grow.ts`). The invoice-receipt carries the wording, the
   ID, each lesson date and "כרטיס אשראי".

## 4. The family card and the parent
1. On any family card, **כספים** shows the balance and every entry with its reason. **רישום תשלום** records Bit or
   cash (and who received it), **זיכוי, חיוב ידני או מחיקה** adds a correction as a new entry, and **ביטול הרישום**
   reverses one. Refunds are on each payment, never more than what is left of it.
2. **הקפאות וביטולים**: a freeze for dates (it waits for approval under **כספים › הקפאות**), and a cancellation that
   says which month is charged last ("…עד ה-25 בחודש…").
3. **כספים › מזומן**: cash an instructor received and has not handed over.
4. Sign in as **הורה · מיכל כהן (דמו)** and open **תשלומים**: the balance, the standing order's card, open payment
   links with a pay button, the history and the receipts.
