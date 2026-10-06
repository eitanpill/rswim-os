# Phase 9 demo script

Everything here uses invented demo data: families, children, venues and amounts are fake.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
export RSWIM_MASTER_KEY=$(node -e "console.log(Buffer.alloc(32, 7).toString('base64'))")  # fake demo key
pnpm db:migrate && pnpm db:seed
# The copilot runs on the rules-based stand-in; with ANTHROPIC_API_KEY instead it runs on Claude.
RSWIM_DEV_AUTH=1 RSWIM_COPILOT_FAKE=1 pnpm --filter @rswim/web dev
# So migration messages reach the in-memory WhatsApp fake:
RSWIM_MESSAGING_FAKE=1 pnpm --filter @rswim/worker dev   # and `npx inngest-cli dev`
```

On top of Phase 8 the seed adds three demo families leaving after October (reasons: cold water, schedule, cost) and
turns the copilot on in the demo school's rules.

## 1. The Gush Etzion pool is closing (the acceptance criterion)
1. Sign in as **בעלים**, open **בריכות** and tap **מעבר בריכה**. Choose **בריכת הדמו - גוש עציון**, a Sunday a few
   weeks out, and tap **פתיחת אשף המעבר**.
2. Under **כל הקבוצות לבריכה אחת** pick **קאנטרי הדמו - ירושלים** and tap **העברת כל הקבוצות**. Each group now reads
   "עוברת ל…", with lanes picked from the free ones. For one group you can instead choose **או: הילדים מצטרפים לקבוצה
   קיימת** from the ranked suggestions, or change its instructor (keep, another, or none for now).
3. Read the preview: rule checks per child, the price line ("המחיר לא משתנה" / "עולה מ…"), and **הודעות להורים**
   with one personal message per child.
4. Tap **ביצוע המעבר**. The groups are in Jerusalem, and **להודעות שנשלחו** shows the families' messages.
5. Within 24 hours (`migration.revert_hours`), tap **ביטול המעבר** on the same page: groups, places and lessons are back
   in Gush Etzion and every family gets "the change was cancelled".

## 2. Reports
**עוד › דוחות**. Pick 2026-09 to 2026-11 in the range bar.
- **הכנסות**: charged and collected by month, venue and program.
- **רווחיות בריכות**: Gush Etzion loses money in September (₪4,500 rent against its revenue).
- **תפוסה**: the heatmap per venue, weekday and hour.
- **עזיבות**: the three leaving families, by reason. **משפך**: new families → trial → enrolled, by source and branch.
- **מדריכים**: lessons taught, covered by a substitute, children kept after 3 months.
- Every table has a CSV link that opens in Excel with Hebrew intact.
- **סיכום שבועי**: tap **בניית הסיכום של השבוע עכשיו**. The worker builds it on its own every Sunday at 07:00.

## 3. The owner's AI copilot
**עוד › עוזר AI**:
1. Write "תעביר את אורי לוי לאופק – כיתות ג׳". The answer says the proposal waits for you, and the card reads
   "להעביר את אורי לוי מ… ל…". Nothing changed yet. Tap **אישור וביצוע**, then **ביטול המעבר** to put him back.
2. "תשלח להורים של אורי לוי: השיעור מתחיל חצי שעה מאוחר יותר" → confirm, and the message is queued.
3. "מי חייב?" or "מה יש היום" answers from the data. **מה נבדק** shows which tools it used.
4. Sign in as **מנהל/ת · שרון**: the copilot is off (owner only).

## Settings
**מדיניות** now shows every section, including migration, weekly digest and copilot (and transport and camp, which
were missing from the screen).
