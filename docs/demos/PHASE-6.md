# Phase 6 demo script

Everything here uses invented demo data: instructors, lessons, amounts and applicants are fake.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# Optional, so an accepted substitute is put on the lesson and the waves advance:
pnpm --filter @rswim/worker dev   # and `npx inngest-cli dev`
```
Open http://localhost:3000 on a phone-sized window and sign in as **בעלים · רעות (דמו)**.

On top of Phase 5 the seed drafts last month's payroll: אסף (hybrid) confirmed his hours and has a bonus, דני disputed
his. One lesson in the next two weeks looks for a substitute, and נועה (the instructor persona) is in the first wave.
Four applicants sit in the recruiting pipeline.

## 1. Payroll with the hybrid split (acceptance criterion 1)
1. **עוד › שכר ושעות** opens last month's draft: the totals in the payslip and by transfer, then a card per instructor.
2. אסף's card (**משולב**) shows both parts: his groups on the payslip, his privates by transfer. **פירוט** lists
   every line with the rule it used (minutes at 90 ₪ an hour, "120 ₪ לשיעור", travel) and the bonus.
3. **לאשר משכורות** is refused: "יש בירור שעות אחד פתוח".
4. **שעות**: דני's month says what he thinks is missing. Write how it was closed, add a 110 ₪ correction by transfer,
   **סגירת הבירור**.
5. Back on **שכר**: **להכין טיוטה מחדש**, then **לאשר משכורות**. The month is locked; sick leave is accrued for the
   employees; **יצוא לאקסל לרו״ח** downloads the XLSX (payslip sheet with pension status and sick-leave balance,
   transfers sheet).
6. Sign in as **רו״ח (דמו)**: **משכורות** lists the approved month with its spreadsheet.

## 2. Substitutes in waves, first accept wins (acceptance criterion 2)
1. **עוד › מחליפים וחוסרים**: the seeded request shows its wave, who was offered and why ("מכיר/ה את הקבוצה",
   "בבריכה באותו יום"), and when the next wave opens.
2. Pick another lesson under **חיפוש מחליף/ה**: "נשלחה הצעה ל-…" and the request appears with its first wave.
3. Sign in as **נועה (דמו)**, **החלפות**: the offer waits; **אני לוקח/ת** takes it ("השיעור שלך!"). Anyone
   else who tries afterwards gets "מישהו כבר תפס".
4. Back as the owner: the request shows **מלמד/ת: נועה**. With the worker running, the lesson's lead changes and the
   parents get the instructor-change message.

## 3. The instructor's month
1. As נועה, **שעות**: last month and this month, the lessons the system counted, **השעות נכונות** or
   **משהו לא נכון** with a note.
2. **פירוט משכורת** shows each approved month (lines, payslip and transfer) and the sick-leave balance.

## 4. Gaps and recruiting
1. **חוסרים**: next month's lessons without an instructor, merged by venue, day and hours, with a link to recruit.
2. **גיוס**: applicants by stage (new, screening, trial day, talent pool); update a stage, trial day and scorecard;
   pick a venue and day and copy the ready job post.
