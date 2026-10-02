# Phase 2 demo script

Everything here uses invented demo data (two fake venues, five fake instructors, fake families). Nothing leaves the
machine: shift-change and placement events land in the outbox for Phase 5 to turn into messages.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# Optional, to see accepted changes applied and unanswered ones escalate:
pnpm --filter @rswim/worker dev    # and `npx inngest-cli dev` in another terminal
```
Open http://localhost:3000 on a phone-sized window and sign in as **בעלים · רעות (דמו)**.

The seed adds the school year תשפ״ז (1.9.2026–30.6.2027), ten groups on both venues with their instructors, the
year's sessions, about 35 children placed by the same rules as the screens, four private slots (one booked), six
babies on the waitlist and one shift change waiting for Noa.

## 1. A term skips Chol HaMoed (acceptance criterion 1)
1. **עוד › תקופות ולוח שנה › תקופה חדשה**: "קורס סוכות", type **קורס**, 20.9.2026 to 10.10.2026, **יצירת תקופה**.
2. Tap **יצירת שיעורים עכשיו**. The report says how many sessions were created, how many already existed (the
   school-year run made them) and how many dates were skipped.
3. The skipped list shows 21.9 (יום כיפור) and 27.9 to 1.10 (חול המועד), each with the Hebrew date and the groups
   that skip it. Run it again: nothing new is created.
4. Back on **תקופות ולוח שנה**, **הוספת חריג** adds a closed (or open) day for the whole school or one venue; the
   next generation run respects it.

## 2. The board refuses a girl in the boys' hours (acceptance criterion 2)
1. Bottom bar **לוח קבוצות**, pick **קאנטרי הדמו - ירושלים**. Monday is the women-and-girls window, Wednesday the
   men-and-boys window.
2. Drag a girl from **בנות צפרדע** onto **בנים צפרדע** (on a phone: her **העברה…** picker). The sheet says
   "‹name› בת, והבריכה בשעה הזו פתוחה רק לגברים ובנים" and the group's own rule too; there is no confirm button.
3. Move her to **בנות דולפין** instead: if her level fits, the sheet shows the fit score, the reasons, and who will be
   told (her guardians and both instructors). **אישור העברה** saves it from the board's date.
4. הדס פרידמן carries the "מדריכה בלבד" badge: she cannot be moved to a group a man teaches.

## 3. A shift change waits for the instructor (acceptance criterion 3)
1. **עוד › שינויי משמרת** shows the seeded change (בנות כריש, ליה → נועה) waiting for Noa.
2. Open a group (**עוד › קבוצות**), and under **שינוי מדריך/ה** pick a new instructor and a date, **שליחה לאישור**.
   The group keeps its instructor; the board marks it "שינוי מדריך ממתין". A choice that breaks a rule (a man in the
   women's window, an instructor not available then, already teaching) is refused with the reason.
3. Sign out and in as **מדריך/ה · נועה (דמו)**. **היום שלי** lists the request and her week. Tap **מאשר/ת**.
4. Back as the owner, the change reads **אושר**; with the worker running it becomes **בוצע** and the group and its
   future sessions move to Noa. Unanswered changes turn into "לא נענה, עבר אלייך" after the policy's hours, and the
   owner can still **להחיל בלי אישור** (logged).

## 4. Private slots and the waitlist
1. **עוד › שיעורים פרטיים**: open slots for an instructor, venue and time, repeated weekly. An instructor who is not
   available or already teaching is refused. Book a child from the slot row; a full slot says so.
2. **עוד › רשימת המתנה**: six babies wait for a Tuesday at Gush Etzion, so the page suggests opening a group, with a
   link that opens the new-group form with the program, day and hour filled.

## 5. Policies
**עוד › מדיניות** has a new **שיבוץ** section: travel time between venues, who teaches in gender-separated hours and
how many waiting families make a new-group suggestion.
