# Demo: the business brain, stage 1

Fake data only. Run the web app with `RSWIM_DEV_AUTH=1 RSWIM_COPILOT_FAKE=1` and sign in as the owner.

1. More → **המוח של העסק**. The brain is on, the careful profile is active, nothing waits.
2. In the table set **קישור תשלום** to **לבד** and save.
3. Open the copilot and write `תשלח קישור תשלום להורים של אורי לוי על 150`. The answer says it was sent; the card is
   done.
4. Brain → **יומן הפעולות**: the link shows "בוצע לבד". Tap **ביטול הפעולה**: the link is cancelled.
5. In the copilot write the same with `על 900`. It waits: above the ₪300 cap.
6. Home: the card "המוח מחכה לאישור שלך" shows it with the reason. Approve or dismiss it there.
7. Brain → **עצור הכל**: everything waits until **הפעלה מחדש**.
8. Pick **טייס אוטומטי**: moves now run at once (`תעביר את … ל…`), but a free-text message still waits.

## Stage 2: the parents' bot acts

Run the worker with `RSWIM_BOT_FAKE=1 RSWIM_MESSAGING_FAKE=1` (the demo school has the bot on), and send WhatsApp
messages through the GHL webhook as in the bot demo, from a fake family's phone.

1. `<child> לא יגיע לשיעור הבא`: the bot answers "רשמנו…" and the school's absence confirmation follows. Brain →
   journal: "מוואטסאפ של הורה", done alone, with the parent's words.
2. `אפשר לקבוע השלמה ל<child>?` (the child needs an open makeup credit): the bot answers that the office confirms soon;
   the home card shows the booking waiting. Approve it: the booking is made and the family gets the makeup
   confirmation. Undo it from the journal: the credit is open again.
3. Brain → set **הקפאת מנוי** to **לבד**, then `להקפיא את <child> מ-<date> עד <date>`: the freeze is recorded at once.
4. Set **דיווח היעדרות** to **כבוי** and write an absence again: the bot stays out and the inbox shows its usual draft.
5. Messages → bot: each reply shows "מה הבוט עשה".

## Stage 3: requests from the owner and the instructors

Run the worker with `RSWIM_COPILOT_FAKE=1 RSWIM_MESSAGING_FAKE=1` and send WhatsApp messages through the GHL webhook as
in the bot demo.

1. Brain → **אישורים בוואטסאפ**: set a fake number (for example 050-999-0001) and save.
2. From a fake instructor's phone: `אני חולה מחר`. The instructor gets "תודה, רפואה שלמה…", and the fake number gets one
   "מחכה לאישור שלך (#N)" message per lesson. The home card shows them waiting, source "מאיש צוות".
3. From the fake number: `כן N`. The search opens (Staff → substitutes) and the number gets "✅ בוצע". `לא M` drops
   another. Undo the first from the journal: the search is withdrawn.
4. Copilot: `תמצא מחליף ל<instructor> ב-<date>`: searches wait for approval on the card (nothing goes to WhatsApp, the
   owner is already in the chat).
5. Copilot: `תבטל את השיעורים ב-<date> בגלל תקלה בבריכה`: the card counts the lessons; approve it and the lessons are
   cancelled, credits issued, and families get the closure notice.

## Stage 4: the daily rounds

With the worker and the Inngest dev server running (`RSWIM_MESSAGING_FAKE=1`) and an approvals number set:

1. Send the event `brain/morning.run` from the Inngest dev UI (or wait for 07:00). Families with debts older than the
   insights' attention age get a payment link proposal, lessons without an instructor get a search; all wait on the
   home card and arrive on the fake number with their numbers.
2. Send it again: nothing new is proposed.
3. Send `brain/evening.run` (or wait for 20:00): the fake number gets "🌙 היום של המוח" with the day's counts.
4. Brain → untick "לשלוח לי סיכום של היום כל ערב" and save: the next evening sends nothing.

## Stage 5: memory

With the fake copilot (`RSWIM_COPILOT_FAKE=1`), signed in as the owner:

1. Brain → "מה המוח זוכר": the demo school's notes (a family that pays late, an instructor who prefers not to teach on
   Fridays, the venue's heater) and last winter's heating closure. On the live demo the months table is filled at
   reset; locally send `brain/memory.run` from the Inngest dev UI (or wait for 05:45).
2. Write "בדיקה: הקייטנה של פסח התמלאה תוך יומיים" and press "לזכור": it appears under the notes, "מהמסך הזה".
3. In the chat: "תזכור שהבריכה בעמק סגורה בכל חנוכה" → "שמרתי". Then "איך היה החודש?" → the month's places and money
   against last month, and what happened. Then "מה אתה זוכר על משפחת <שם>?" → the note about that family.
4. With an approvals number set, write "תזכור ש..." from it (fake inbound): the note is kept and "📝 שמרתי" comes back.
5. Delete a note: it leaves the page and the chat no longer reads it.
