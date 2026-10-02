# Phase 3 demo script

Everything here uses invented demo data. Nothing leaves the machine: absence, makeup, trial and closure events land
in the outbox for Phase 5 to turn into messages and for Phase 4 to turn into money.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# Optional, so a parent's absence notice is classified right away and credits expire nightly:
pnpm --filter @rswim/worker dev    # and `npx inngest-cli dev` in another terminal
```
Open http://localhost:3000 on a phone-sized window and sign in as **בעלים · רעות (דמו)**.

On top of Phase 2, the seed adds the regulations, the health declaration and the photo consent (published demo
texts), signatures for most families (the Cohen family, the parent persona, still owes theirs), attendance for
September's lessons, three absence notices (two earned a makeup, one booked into another group), a prospective
family (משפחת לוי (ליד)) with a trial next week, and skill ticks for בנות דולפין.

## 1. 13 hours of notice earns a makeup, 11 hours does not (acceptance criterion 1)
1. **עוד › נוכחות והיעדרויות**. Move to a day with lessons and open one, e.g. **בנים דולפין**.
2. The lineup shows every child with age, level and flags (פחד ממים, מדריכה בלבד, בלי צילום, הערה רפואית).
3. Under **רישום הודעת היעדרות** pick a child, **וואטסאפ**, and a time 13 hours before the lesson. **רישום ובדיקה
   מול התקנון** answers "ההודעה התקבלה 13 שעות ו-0 דקות לפני השיעור (נדרשות לפחות 12 שעות) · נפתחה השלמה".
4. Same for another child at 11 hours before: "…רק 11 שעות… · הודעה מאוחרת לא מזכה בהשלמה".
5. A second timely notice for the first child in the same month: "כבר נוצלה המכסה של השלמה אחת בחודש".
6. **השלמות** (tab row): the first child's credit is valid until the last day of the lesson's month. **מציאת שיעור
   להשלמה** lists lessons that fit with a free seat; a lesson outside the age band or level shows why and books only
   with a note (**קביעה בכל זאת**). **זיכוי מחווה** adds a credit outside the rules.

## 2. A three-day closure (acceptance criterion 2)
1. **סגירות › סגירה חדשה**: **בריכת הדמו - גוש עציון**, reason **המקום**, Tuesday to Thursday of a coming week,
   a description, a deadline. **תצוגה מקדימה**.
2. The preview lists each lesson and child: who gets a makeup, and who doesn't and why (frozen, trial to rebook).
3. **פתיחת האירוע וביטול השיעורים**: the lessons are cancelled (the day screen says "בוטל (סגירה חיצונית)"), each
   child with an active seat gets a credit usable from the day after the closure to the deadline, makeup guests in
   those lessons get theirs back, and trials there are cancelled to rebook.
4. The **דוח ניצול השלמות** counts issued, booked, used, missed, expired, converted and still open per group. Book one
   of the credits on **השלמות** and the report moves. **סגירת האירוע** applies the end rule (expire, or turn into
   account credit for Phase 4).

## 3. The instructor at the pool
1. Sign in as **מדריך/ה · נועה (דמו)**. **היום שלי** lists her week; tap a lesson.
2. One tap per child: **הגיע/ה**, **איחור** (then the minutes), **לא הגיע/ה**. "הכול נשמר" confirms the sync.
3. Turn the phone's network off and keep marking: the badge counts marks waiting to send. Back online, they sync by
   themselves; a late arrival past the policy's minutes is stored as an absence.
4. **מיומנויות ברמה** opens the level's skills to tick. A trial child in a lesson that started gets a verdict form.

## 4. Trials and forms
1. As the owner, **שיעורי ניסיון**: book a trial for שירה לוי in a lesson (the placement rules apply, the trial price comes
   from the price list). After the lesson, record the verdict (attended, fit, recommended group).
2. **הרשמה לקבוצה** is refused while the family owes the regulations and the health declaration, with the count.
3. Open משפחת לוי (ליד) under **משפחות**: **טפסים ותקנון** lists what is owed with the full text; record a paper or
   phone signature (tick the health questions answered yes). Back on **שיעורי ניסיון**, the conversion goes through and says
   whether the trial fee comes off the first payment.
4. **טפסים ותקנון**: a new version is a draft until **פרסום**; then its text is fixed and every family owes it again.

## 5. The parent
1. Sign in as **הורה · מיכל כהן (דמו)**. The home page shows the next lesson, makeups to book and forms to sign.
2. **לו״ז**: **לא נגיע** on a lesson sends a notice ("ההודעה התקבלה"); the worker classifies it against the
   regulations and the badge turns into "מזכה בהשלמה" or "לא מזכה בהשלמה". **בכל זאת מגיעים** withdraws it.
3. An open credit's **קביעת השלמה** lists only lessons the child fits, with a free seat; booking takes one tap and can
   be cancelled before the lesson.
4. **מסמכים**: read and accept the regulations and each child's health declaration.
