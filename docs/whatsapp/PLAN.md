# The WhatsApp track

WhatsApp is the product's main feature (Pit, 2026-11-20): one number per business and one bot connected to the
business brain. It takes a new customer from the first message to a trial and payment, serves families, divers and
staff, and talks to the owner like an office manager. Generic for every swim school and freediving club. The plan
Pit sees is the "מסלול הוואטסאפ" tab of the master document. Real sending stays on the fake (`RSWIM_MESSAGING_FAKE`)
until a business's Meta account is connected.

| Stage | What it adds | Status |
|---|---|---|
| W1 Leads in one place | A new number on WhatsApp opens a lead; one list for swim and dive; triggers move it on | Done (PR #57) |
| W2 The bot answers a new customer | Prices, programs, open seats, FAQ; collects details one question at a time; modules (lodging) plug in | Done (PR #58) |
| W3 The bot closes | Books a trial or an intro dive, sends a pre-filled join link, health form and payment link, by the brain's levels | Done (PR #59) |
| W4 Follow-up and lead report | After-trial offer and reminder, one nudge for silent leads, morning count, monthly sources report | Done (PR #60) |
| W5 Meta Cloud API direct (on fakes) | Send/receive without GHL, the 24-hour window, approved templates with variables, SMS/app fallback | Done (PR #61, SMS/app fallback later) |
| W6 The club on WhatsApp: customers | Balance and pay link, receipts, schedule, dive booking and passes, missing forms, transport | Done |
| W7 The club on WhatsApp: staff and owner | Instructor's day, attendance, shift swaps; owner questions and commands with "כן N" | Done |
| W8 The brain on WhatsApp | Brain stages 7-8: forecasts and the weekly coach, delivered on WhatsApp with do-it replies | Done (first cut) |
| W9 One conversations screen | Every conversation in one place, "I'm taking over" per chat, bot performance | Done |
| W10 Live at Reut's | Real number and templates, careful mode, two weeks of close watch, then one-click connect per business | First part built (check, templates' review, test message); the real number needs Pit |

Always a person: discounts and refunds, complaints, health and safety, leaving, anyone who asks for a human.

## W1: leads in one place

- `leads` (migration 0064/0065): one row per phone per business, stages `new → talking → trial_booked → joined`,
  or `lost` with a reason. A freediving club's `dive_leads` moved into it (contacted → talking, booked → joined, the
  program's name → `interest`), so the club's front desk and the swim school's `/admin/leads` read one list.
- Opening and moving a lead:
  - a WhatsApp message from a number that is not a family, a staff member or a diver
    (`touchLeadFromMessage`, called by the inbox's intake in the same transaction; `inbound_messages.lead_id`);
  - a join request from the school's link (`trial` → talking, `join` → new) and its acceptance (→ joined);
  - a family opened with the lead's phone links the lead to it; a trial seat → trial_booked; a group seat → joined;
  - a diver on the club's books with the lead's phone → joined.
  These are database triggers (`app.touch_lead`), because join requests are accepted inside security-definer
  functions and the office opens families, trials and seats from many screens. A stage only moves forward; a lost
  lead that acts again comes back (the same rule in `leadStageAfter`).
- `/admin/leads`: a board by stage with what the lead last wrote, how long ago and what the office owes it (an answer
  to a new lead, or a follow-up date that came); a form for a lead from a phone call; the lead's page with the
  WhatsApp conversation, a reply box (free text: the lead wrote first, so the 24-hour window is open), stage moves,
  "lost" with a reason, notes and a follow-up date. The owner's home shows "N new enquiries" when any wait.
- Only the office sees leads (owner and admins, and the tenant's worker).

## W2: the bot answers a new customer

- A lead's WhatsApp message goes to the same bot as families' (`runParentBot` → `runLeadBot`,
  `@rswim/domain-copilot` `lead-bot.ts`), with its own switch: `comms.lead_bot_enabled` (policy editor, messages;
  on in the demo for the swim school and the Eilat club). It is part of the `parent_bot` plan feature and the month's
  AI allowance, like the family bot.
- What it answers from: `business_info` (a swim school's programs with ages, today's published prices and the groups
  that still have places; a club's programs with prices and the sessions of the next two weeks with places; venues or
  dive sites), the business's approved answers (`search_knowledge`), and the rules (`policyFacts`). It never guesses
  a price or a time.
- What it collects (`save_details` → `leads.name`, `leads.interest`, `leads.details`), one question per message, in
  order: swim: name, child's age, area, days that suit; freediving: name, experience, dates (`LEAD_QUESTIONS`). The
  lead's page shows "what the bot collected".
- A person always: anything sensitive (the family bot's list), anyone who asks for a person or a call, and a
  question it has no answer for (the office gets a summary, the person a "we passed it on" note at most every two
  hours). It keeps out of a conversation the office wrote in during the last three hours, and of a lead that joined.
- Its first answer moves the lead to "talking". Its answers and handoffs show on `/admin/messages/bot` with a link
  to the lead (`bot_replies.lead_id`, migration 0066).
- Modules: an optional part of the business registers a `LeadBotModule` (`registerLeadBotModule`) with its facts
  (rooms, nightly prices…) and tools; the bot gets them only when the module's `enabled(tx)` says the business has it
  on. Lodging plugs in here.
- The stand-in (`RSWIM_BOT_FAKE=1`, `FakeLeadBotModel` through `FakeParentBotModel`) saves stated names and ages and
  the short answer to the question it asked, answers prices, places and "where" from `business_info`, and asks the
  next question.

## W3: the bot closes

- A swim school's bot books a trial lesson. It asks for the child's first name, date of birth, boy or girl and the
  parent's full name, offers up to three lessons from `trial_options` (the next two weeks, a free place, the child's
  age by the group's or the program's bounds, mixed groups or the child's gender, with the trial fee), and books the
  one chosen with `book_trial`.
- `book_trial` is a new kind of the business brain (`AGENT_ACTION_KINDS`, ceiling auto, "approve" in the careful
  profile): the owner decides on `/admin/brain` whether the bot books alone, waits for her ("כן N" on WhatsApp), or
  never. Running it opens the family from the lead (or uses the family that already has the phone), adds the child
  and books the trial with the usual placement rules (`bookLeadTrial`, `lead-trial.ts`). The lead links to the family
  and moves to "trial booked" by itself (W1's triggers), and the school's trial confirmation goes out as for any
  trial. Undo cancels the trial and keeps the family.
- When the trial was booked and has a fee, the trial fee goes as a payment link through the brain's `payment_link`
  level (the usual amount cap applies).
- The sign-up link: `join_link` gives the business's `/join/<slug>` (from the worker's `RSWIM_PUBLIC_URL`), for a
  family that wants to join for good, and for a freediving club's new diver, who registers there and books the first
  dive in the app. Booking an intro dive from WhatsApp comes with W6 (the club's customers on WhatsApp).
- Forms: the health declaration and the regulations stay in the family's app after the trial is booked; reminding a
  family of missing forms on WhatsApp is W6.
- The stand-in understands "שיעור ניסיון", a child's name with a date ("נועה 12.3.2020"), a number picked from its
  list, and "קישור להרשמה".

## W4: follow-up and lead report

- The day before a trial lesson (17:00, worker `enrollment-trial-reminders`, swim schools) every trial still booked
  for tomorrow emits `enrollment.trial_reminder`, and the new `trial_reminder` template goes to the family like any
  messaging automation (switchable in the messages settings). A trial booked in the last 12 hours is not reminded on
  top of its confirmation.
- Every day at 10:00 (worker `brain-lead-followups`) the brain follows up new customers through its gate as a new kind,
  `lead_followup` (ceiling auto, "approve" in the careful profile): the day after a trial (for a week) an offer to
  continue, with the trial-fee offset date when there is one; a new date when the child did not come; and one nudge to
  a lead that went quiet two to fourteen days after the bot answered. Each reason goes once per lead, never while the
  office wrote to the number in the last three days, and only where the bot for new customers is on
  (`followUpFor`, `lead-bot-policies.ts`; `runLeadFollowUps`, `lead-followup.ts`). The message goes as the brain, so
  the bot answers the reply.
- The owner's evening summary adds a line for the day's new customers (new leads, trials booked, joined) when there
  were any.
- `/admin/leads` shows where the month's leads came from: leads, trials booked, joined and the joining rate per
  source, with the months before it a tap away (`leadSources`, `sourcesReport`).
- Real WhatsApp only lets a business start a conversation after 24 hours with an approved template; the follow-ups and
  reminders move onto templates with W5 (Meta Cloud API).

## W5: Meta Cloud API direct (on fakes)

- The owner connects the business's own number on `/admin/integrations/whatsapp` (`/admin/more`, and the WhatsApp
  row of `/admin/connections`): the phone number id, the business account id, a system-user access token and the app
  secret from Meta. The token and the secret are sealed with the organization's data key (`whatsapp_connections`,
  `enc_*` columns no signed-in user can select); the page shows the webhook address and a verify token to paste into
  Meta. The office sees only whether it is connected.
- Meta's webhook is `/api/webhooks/whatsapp/<connectionId>`: the GET answers the subscription check with the verify
  token, the POST is checked against the app secret (`X-Hub-Signature-256`), then each message goes into the inbox
  once by Meta's id (provider `meta`, where the bots pick it up) and each receipt lands on our message
  (`delivered_at`, `read_at`, or failed). `ingestMetaWebhook`, `parseMetaWebhook`.
- The worker sends through the connected number (`MetaCloudMessagingProvider`) instead of GHL. Inside WhatsApp's
  24-hour window (since the person last wrote) free text goes; outside it the message goes as its approved Meta
  template, with the message's details in the template's order, or it is blocked as `outside_window` and visible in
  the message log (`outboundShape`). The owner names each message's Meta template on the templates screen. A send
  Meta refuses is kept on the connection for the owner.
- With `RSWIM_MESSAGING_FAKE=1` a connected number runs on a fake that keeps the window rules, so demos and tests show
  the same behaviour. A real connection needs W10 (Meta verification, a number, approved templates).

## Personal invite link (Pit, 2026-11-20)

- The bot's `join_link` now gives each new customer their own link, `/i/<token>` (`leadInviteToken`,
  `lead-invite.ts`), instead of the business's general `/join/<slug>`: the same link while it is valid, a new one
  after it was used or after 30 days (`INVITE_DAYS`). Every screen path opens the store app when it is installed.
- The page shows the business, greets the person by name and shows their number half hidden; sign-in is by SMS code
  with the number ready (`/login/phone?invite=`), and back on the invite one tap enters. A swim school: the family the
  trial opened, a family the office has with that phone, or one opened now from the lead's name
  (`prepareInviteFamily`), then the database's own phone check joins them (`claim_by_phone`). A freediving club: on to
  the club's sign-up for the diver's details. Another phone, a used or an expired link is refused
  (`openInviteFamily`); the lead keeps when it was used (`leads.invite_used_at`).

## W6: the club on WhatsApp, families (first part)

- The parents' bot (`bot.ts`) gets four new tools, each bound to the writing family:
  - `pay_balance`: a payment link for the whole open balance through the brain's `payment_link` level and amount cap
    (source `parent_whatsapp`). The link goes out on the school's usual `payment_link` message. A family that already
    has an open link gets that link back, and nothing opens twice. A family with nothing open hears so.
  - `family_receipts`: the last five issued receipts with number, date, total and the link to
    `/parent/receipts/<id>` (from the worker's `RSWIM_PUBLIC_URL`).
  - `missing_forms`: the forms the family still owes (`formsDueFor`: the regulations, a health declaration per child,
    and so on) with the signing page `/parent/documents`.
  - `family_transport`: each child's route, weekdays, when it leaves school, the drop-off point and today's ride.
- The schedule was already there (`family_lessons`, the next 14 days).
- Forms reminder: at 17:00 (worker `enrollment-trial-reminders`) a family with a lesson tomorrow who still owes forms
  gets the new `forms_reminder` template with the forms' names and the signing page, once a week at most (the event's
  key carries the week). The owner can switch it off with the other automations.
- The stand-in understands "קישור לתשלום" / "איך משלמים", "קבלה", "טפסים", "הסעה".

## W6: the club on WhatsApp, divers (second part)

- A message from a freediving club's registered diver (the phone on `dive_divers`) goes to the divers' bot
  (`diver-bot.ts`, through `runParentBot`), under the same switch as the parents' bot (`comms.bot_enabled`, plan
  feature `parent_bot`). It never opens a lead.
- Tools, each bound to the writing diver: `my_dives` (coming bookings, with the payment link of one still unpaid),
  `my_passes` (their passes and the ones the club sells), `open_sessions` (what their own app would let them book in
  the next 10 days), `my_forms` (forms still to sign, with `/dive/me/forms`), and `book_dive`.
- `book_dive` books exactly as the front desk would for a diver who asked: a usable pass covers a training session,
  a free session is confirmed, and anything else holds the place as `pending_payment` with the link
  `/dive/me/pay/<bookingId>` (the diver can also pay at the club). It does not go through the brain's gate: the diver
  can do the same alone in the app, and nothing is charged.
- Cancelling, moving a booking, gear, depth limits and medical clearance go to the desk; health, incidents and
  complaints never reach the model.
- `bot_replies.diver_id` (migration 0074) records whom the bot answered. Migration 0075 fixes
  `app.dive_seats_taken` for the worker: it counted no seats under the system role.
- The stand-in understands "מה פנוי", "להזמין N", "מתי הצלילה הבאה", "כרטיסייה", "טפסים".

## W7: the club on WhatsApp, staff and owner

All in `brain-inbound.ts` (worker function `brain-inbound`), texts in `agent-policies.ts`.

- An instructor writes "מה יש לי היום" / "הלו״ז שלי מחר": the lessons they lead that day, one line each (time, group,
  place, how many take part), and the link to their screen. A club's instructor gets their sessions of today and
  tomorrow the same way (`instructorDay`), with the link to `/dive/instructor`. Rules only.
- "נוכחות": the link to the instructor's screen, naming the lesson that is on now or next. Attendance itself is marked
  on the screen, not by text: a name typed wrong would mark the wrong child.
- "אני חולה היום" opens substitute searches as before (brain stage 3): that is the shift swap on WhatsApp.
- The owner writes anything from the approvals number that is not "כן N", "לא N" or "תזכור ש...": her assistant answers
  it as in the app (`askCopilot` as the school's owner), at her AI level. An action it proposes runs or waits by the
  brain's levels; one that waits comes back in the same answer with its "כן N". Needs `copilot.enabled` and a model
  in the worker (`ANTHROPIC_API_KEY`, or the stand-in with `RSWIM_COPILOT_FAKE=1`); otherwise her message stays in the
  inbox. Once the assistant is on, the parents' bot leaves every message from that number alone.
- An owner who also teaches: the instructor's rules read her message first.

## W8: the brain on WhatsApp, the weekly coach

`coach.ts` and `coach-policies.ts` in `@rswim/domain-copilot`, worker function `brain-weekly-coach` (Sundays 08:00).

- One message to the owner's approvals number: last week in a line (joined, left, collected), at most three things
  that matter this week, and the next holiday in the coming six weeks with how the same month went a year ago (from
  the brain's month snapshots, when it remembers that month).
- Priorities in a fixed order: actions that wait for her (each with its "כן N" / "לא N"), lessons of the coming week
  without an instructor, families whose debt passed the digest's attention age, and the emptiest group under the
  digest's low-occupancy mark.
- What she can do is a reply: "כן N" decides a waiting action, and with her assistant on WhatsApp (W7) the message
  suggests asking it ("מי חייב לנו?"). Without the assistant it points to the screen instead.
- Not sent without an approvals number, with her summaries turned off, or with nothing to say; once a week.
- Still open from brain stages 7 and 8: a three-month forecast with ranges, and tracking whether last week's advice
  worked.

## W9: one conversations screen

`services/chats.ts` in `@rswim/domain-comms`, table `chat_holds`, screens `/admin/messages/chats` and `/dive/chats`
(one shared component, `apps/web/src/components/chats`).

- One list by phone, the newest first, whoever the person is: a family, a new customer, a diver, staff. Each row
  shows the last line either way, how many messages wait in the inbox, what the bot did, and whether a person holds
  the conversation. Filters: all, waiting for an answer, with a person.
- A conversation opens as one thread, both directions, each outgoing line marked as the bot's, the office's or an
  automatic message, with its delivery status.
- "I'm taking over" (`takeOverChat`): a row in `chat_holds` for that phone. `runParentBot` checks it before anything
  else, so the parents' bot, the lead bot and the divers' bot all stay quiet for that number; the message waits in
  the inbox. "Give back to the bot" (`releaseChat`) removes the row. A hold has no expiry: the screen counts the held
  conversations at its head so none is forgotten.
- The reply box answers whoever wrote (`replyToChat`): a family through the inbox's reply (so the bot still learns
  from it), a new customer through the lead's reply (the lead moves to "talking"), anyone else as free text. The
  person's waiting messages leave the inbox. Outside WhatsApp's 24-hour window the box says so.
- Bot performance at the head (`botPerformance`, last 30 days): the share of messages the bot closed alone, how many
  it passed on and the most common reason, conversations waiting, conversations with a person.
- A freediving club reaches the screen from the front desk's leads panel.

## W10, first part: going live from the connection page

Three steps on `/admin/integrations/whatsapp`, once the number's details are saved. The owner asks; the worker talks to
Meta (`whatsapp-admin.ts`, worker functions in `functions/whatsapp.ts`).

- **Check the connection** (`comms.whatsapp_check_requested`): the worker reads the number from Meta (verified name,
  quality) and tells Meta to send this business account's messages to the connection's own webhook address
  (`POST /<WABA>/subscribed_apps` with `override_callback_uri` and the verify token), so the owner pastes nothing
  into Meta. Meta's refusal is kept on the connection in Meta's words.
- **Send the messages to Meta's review** (`comms.whatsapp_templates_requested`): every active message becomes a
  utility template (`metaTemplateDraft`): our variables numbered with an example each, the business's name written
  into the text, and a name that changes when the text does (`<key>_<locale>_<mark>`). A message named by hand is left
  alone; one that starts or ends with a variable, or is only a variable, is listed on the page instead of sent. A
  template already at Meta under that name is adopted. Every 30 minutes the worker brings Meta's decisions home while
  any template waits (`comms-whatsapp-template-sync`).
- A template we sent is used only once Meta approved it (`metaTemplateUsable`); until then a message outside the
  24-hour window is blocked as before. A template named by hand counts as approved.
- **Test message**: free text from the business number to a phone the owner types.
- With `RSWIM_MESSAGING_FAKE=1` Meta is a fake (`FakeWhatsAppAdmin`): the check passes, and templates are approved on
  the next look.
- Still Pit's: Meta business verification, a number, a system-user token, and taking `RSWIM_MESSAGING_FAKE` off the
  worker. Not built: Embedded Signup (one-click connect needs Meta's Tech Provider approval), and the connection page
  for a freediving club.
