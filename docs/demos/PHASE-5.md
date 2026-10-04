# Phase 5 demo script

Everything here uses invented demo data. WhatsApp goes to an in-memory fake of GHL: no real message is sent.

## Setup (once)
```bash
pnpm i
export DATABASE_URL=postgresql://rswim:rswim@localhost:5432/rswim_dev RSWIM_PLAIN_POSTGRES=1
pnpm db:migrate && pnpm db:seed
RSWIM_DEV_AUTH=1 pnpm --filter @rswim/web dev
# Optional, so queued messages are "sent" (fake provider) and automations run:
RSWIM_MESSAGING_FAKE=1 RSWIM_GHL_FAKE=1 pnpm --filter @rswim/worker dev   # and `npx inngest-cli dev`
```
Open http://localhost:3000 on a phone-sized window and sign in as **בעלים · רעות (דמו)**.

On top of Phase 4 the seed adds the default templates and automations, three WhatsApp messages in the inbox (the
parent persona saying יואב won't come today, a payment question, a lead from an unknown number), one message held
until Shabbat ends, and one broadcast scheduled for a venue.

## 1. A WhatsApp absence in one tap (acceptance criterion 1)
1. The home screen's **מחכה לך** card says how many WhatsApp messages wait. Tap it (or **עוד › הודעות**).
2. **תיבה נכנסת**: מיכל כהן's "יואב לא יגיע היום" is tagged **הודעת היעדרות** with its confidence. If יואב has a
   lesson today, the card shows the lesson (group, date, time) and **אשר/י היעדרות**; one tap records the absence
   with the regulations' decision (makeup or not) and queues the confirmation to the family. If he has no lesson
   today the message waits for a person, with a link to the family card.
3. The twins' mother's payment question and the unknown number's lead wait for a person; **סמן/י כטופל** or **סגור/י בלי פעולה**
   closes them, and the reply box answers inside WhatsApp's 24-hour window.
4. To see a live one: post a signed `InboundMessage` to `/api/webhooks/ghl` (see `apps/web/e2e/messaging.spec.ts`).

## 2. Nothing on Shabbat (acceptance criterion 2)
1. **הודעות › יומן**, filter **ממתין לחלון שליחה**: the seeded Friday-evening message is held with the reason "שבת / חג" and the
   time it will go out (Saturday night, after havdalah + 30 minutes).
2. **מדיניות › תקשורת** holds the quiet hours, the rate per minute and the holiday notice days.

## 3. Every message is logged (acceptance criterion 3)
1. **יומן** lists every message: sent, held, failed and blocked, each with its reason (opted out, no phone, missing
   variable, template off) and the event that caused it.
2. **תבניות**: edit a template's Hebrew text (an unknown `{{variable}}` is refused) or turn one off; turn an
   automation off and its event stops messaging families.
3. **הודעה לקבוצה**: pick a venue, a group, a program or "families who owe", see how many families and guardians it
   reaches, send now or schedule. The scheduled demo broadcast can be cancelled.
