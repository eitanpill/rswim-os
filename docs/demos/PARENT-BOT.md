# Demo: the parents' WhatsApp bot

Fake data only. Run the web app with `RSWIM_DEV_AUTH=1` and the worker with `RSWIM_BOT_FAKE=1 RSWIM_MESSAGING_FAKE=1`
(and `RSWIM_GHL_FAKE=1`). The demo school has `comms.bot_enabled` on.

1. A demo parent writes "מתי השיעור הבא?" (a signed GHL webhook, as in the Phase 5 demo). The bot answers with the
   children's next lessons; the message is closed in the inbox and appears under **הודעות → הבוט** as "ענה".
2. A parent writes "יש לה אלרגיה לכלור, מה עושים?". The bot does not answer: the message stays open in the inbox,
   marked for a person, and the family gets "העברנו אותה לצוות".
3. A parent writes "איפה חונים ליד הבריכה?". The fake does not know, so it hands off with a summary. Answer it from the
   inbox. On **הבוט**, the question and your answer wait under "למידה מהתשובות שלך": edit if needed and approve.
4. Another parent asks the same. The bot now answers by itself with your words. Mark the answer 👍 or 👎.
5. Turn the bot off in **מדיניות → הודעות**: new messages go to the inbox exactly as before.
