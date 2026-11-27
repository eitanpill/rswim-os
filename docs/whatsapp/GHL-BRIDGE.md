# WhatsApp through GHL (the GHL bridge)

A school whose WhatsApp number already lives in its GoHighLevel sub-account keeps it there. GHL is the bridge: people's
WhatsApp messages come to us, our bots (lead bot, parents' bot, divers' bot, the brain) answer, and the answer goes out
through GHL. We never talk to Meta for that school. Optional per business, multi-tenant: every school brings its own
sub-account and token.

## How it works

```
person ──WhatsApp──▶ GHL sub-account ──workflow "Customer Replied" (WhatsApp)──▶ POST /api/webhooks/ghl/bridge/<id>/<secret>
                                                                                       │ (names the contact only)
                                                                                       ▼
                                            worker comms-ghl-bridge-pull ──GET conversation with the school's token──▶ GHL
                                                       │
                     inbox (intakeInbound, once by GHL message id) ──▶ bots ──▶ messages ──▶ dispatcher ──▶ GHL /conversations/messages
```

- **Connection** (`ghl_connections`, `@rswim/domain-comms` `ghl-bridge.ts`, page `/admin/integrations/whatsapp` and
  `/dive/whatsapp`, owner only): location id + Private Integration token, sealed with the org's data key. Saving also sets
  the school's GHL location for contacts and pipelines. The worker checks the token (`comms-ghl-bridge-check`,
  `GET /locations/{id}`).
- **Hook**: a GHL workflow webhook is not signed (GHL signs webhooks only for Marketplace apps), so the URL carries a
  per-connection secret and the body is never trusted: it only names the contact (`contact_id`). The worker reads the
  contact's phone and its latest messages from GHL's API with the school's token. A forged call can at most make us read
  our own data.
- **Reading** (`ghlPullPlan` in `policies.ts`): only WhatsApp, only after the connection was made (history is never
  answered), each GHL message id once. An answer in GHL that we did not send (by id or by text) is kept on the log
  (`messages.source_event_type = 'ghl.foreign'`, shown as "sent from GHL" in the conversation). Within 15 minutes of the
  person's message it is a *reply*: counted on the connection, and in live mode the conversation is held for a person
  (`chat_holds`), so nobody gets two answers. Answers younger than a minute are read again 70 seconds later.
- **Sending**: the dispatcher sends through GHL with the school's own token (`messagingFor` in the worker); a refusal is
  kept on the connection.
- **Shadow mode** (default for a new connection): every bot answer (`bot:` keys) is stored as `suggested`; the office
  sends or drops it on the conversations screen. Brain actions a bot takes from WhatsApp wait for the owner
  (`waitReason: 'shadow'`). Live mode needs a passed connection check; each switch resets the count of foreign replies.
- **Marketplace webhook** (`/api/webhooks/ghl`, unchanged path) now also accepts GHL's current `X-GHL-Signature`
  (Ed25519, published key in `GHL_ED25519_PUBLIC_KEY`); the legacy RSA header needs `GHL_WEBHOOK_PUBLIC_KEY`.

Fakes: `RSWIM_GHL_FAKE=1` reads an in-memory sub-account (`FakeGhlBridgeClient`); `RSWIM_MESSAGING_FAKE=1` keeps sending
fake. Tests: `packages/seed/test/ghl-bridge.test.ts`, `packages/integrations/test/ghl-bridge.test.ts`,
`packages/domain/comms/test/ghl-bridge-policies.test.ts`.

Not verified against a live sub-account yet: the exact `messageType` GHL gives WhatsApp (we match `/whatsapp/i`), the
messages response shape (both a bare list and `{ messages: { messages } }` are read), and the Version headers
(`2021-07-28` for locations/contacts, `2021-04-15` for conversations).

Scopes for the Private Integration: View Locations, View Contacts, Edit Contacts, View Conversations, View Conversation
Messages, Edit Conversation Messages. GHL recommends rotating the token every 90 days (7 days where both work):
re-enter it on the page, the hook URL stays.

## מעבר בטוח מהבוט הישן ב-GHL (רשימת צעדים לבעל/ת העסק)

המטרה: אף לקוח לא מקבל שתי תשובות, ואף הודעה לא נופלת בין הכיסאות.

**שלב 0: הכנה באפליקציה (לפני החיבור)**
1. מחירים, תוכניות ושעות פתוחות מעודכנים במערכת (הבוט עונה רק ממה שיש במערכת).
2. במסך הבוט: תשובות לשאלות הנפוצות שהבוט הישן עונה עליהן היום.
3. "הבוט עונה ללקוחות חדשים" דלוק (מדיניות הודעות).

**שלב 1: חיבור במצב צל (הבוט הישן עדיין דלוק)**
1. ב-GHL: Settings > Private Integrations > Create new integration, עם ההרשאות שבמסך החיבור. מעתיקים את הטוקן.
2. במערכת: וואטסאפ > וואטסאפ דרך GHL. מדביקים Location ID וטוקן, "שמירה ובדיקה". מחכים ל"מחובר לחשבון ב-GHL".
3. ב-GHL: וורקפלו חדש. טריגר Customer Replied, סינון Reply channel = WhatsApp. פעולה Webhook (POST) לכתובת שבמסך. Publish.
4. שולחים הודעת בדיקה מטלפון אחר. בתוך דקה היא מופיעה במסך השיחות, עם הצעת תשובה של הבוט שלנו (מסגרת מקווקוות).
5. זה תקין שבמצב צל המסך יראה "X תשובות נשלחו מתוך GHL": זה הבוט הישן שעדיין עונה.

**שלב 2: כמה ימים של השוואה (מומלץ 3 עד 7 ימים)**
1. פעם ביום עוברים על ההצעות: שולחים את הטובות, מוחקים את הלא טובות.
2. כל שאלה שהבוט שלנו לא ידע לענות: מוסיפים תשובה במסך הבוט.
3. ממשיכים רק כשרוב ההצעות טובות בלי תיקון.

**שלב 3: יום המעבר (בוקר של יום חול, לא שישי ולא ערב חג)**
1. כיבוי הבוט הישן ב-GHL, כל מה שעונה בוואטסאפ:
   - Conversation AI: Settings > Conversation AI (או AI Agents). מכבים את הבוט לערוץ WhatsApp, או מעבירים ל-Off.
   - Workflows: כל וורקפלו עם טריגר Customer Replied / Inbound Message / Contact Created שיש בו פעולת Send WhatsApp
     או AI reply: מעבירים ל-Draft. **לא נוגעים בוורקפלו החדש עם ה-Webhook אלינו.**
   - תגובות אוטומטיות (Auto reply, Missed call text back) בוואטסאפ: מכבים.
   - Workflow AI / AI Employee אם יש: מכבים לוואטסאפ.
2. מחכים 5 דקות. שולחים הודעת בדיקה. מוודאים שלא הגיעה שום תשובה מ-GHL בתוך 2 דקות.
3. במערכת לוחצים "להעביר לבוט שלנו" (המונה של תשובות מ-GHL מתאפס).
4. שולחים עוד הודעת בדיקה: הבוט שלנו עונה לבד.

**שלב 4: 48 השעות הראשונות**
1. המונה "תשובות שנשלחו מתוך GHL" צריך להישאר 0. אם הוא עולה, משהו בצעד 3.1 עדיין דלוק. בכל שיחה כזו הבוט שלנו
   עוצר לבד (השיחה עוברת לאדם), אז אין תשובה כפולה, אבל צריך למצוא ולכבות את מה שעונה.
2. כשמישהו מהצוות עונה ידנית ב-GHL, הבוט שלנו עוצר באותה שיחה. מחזירים לו אותה במסך השיחות ("החזרה לבוט").

**חזרה אחורה, בכל רגע**
"חזרה למצב צל" במערכת, ומדליקים בחזרה את הבוט הישן ב-GHL. שום דבר לא נמחק.
