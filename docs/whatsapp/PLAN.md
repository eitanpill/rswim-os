# The WhatsApp track

WhatsApp is the product's main feature (Pit, 2026-11-20): one number per business and one bot connected to the
business brain. It takes a new customer from the first message to a trial and payment, serves families, divers and
staff, and talks to the owner like an office manager. Generic for every swim school and freediving club. The plan
Pit sees is the "מסלול הוואטסאפ" tab of the master document. Real sending stays on the fake (`RSWIM_MESSAGING_FAKE`)
until a business's Meta account is connected.

| Stage | What it adds | Status |
|---|---|---|
| W1 Leads in one place | A new number on WhatsApp opens a lead; one list for swim and dive; triggers move it on | Done (PR #57) |
| W2 The bot answers a new customer | Prices, programs, open seats, FAQ; collects details one question at a time; modules (lodging) plug in | **This PR** |
| W3 The bot closes | Books a trial or an intro dive, sends a pre-filled join link, health form and payment link, by the brain's levels | |
| W4 Follow-up and lead report | After-trial offer and reminder, one nudge for silent leads, morning count, monthly sources report | |
| W5 Meta Cloud API direct (on fakes) | Send/receive without GHL, the 24-hour window, approved templates with variables, SMS/app fallback | |
| W6 The club on WhatsApp: customers | Balance and pay link, receipts, schedule, dive booking and passes, missing forms, transport | |
| W7 The club on WhatsApp: staff and owner | Instructor's day, attendance, shift swaps; owner questions and commands with "כן N" | |
| W8 The brain on WhatsApp | Brain stages 7-8: forecasts and the weekly coach, delivered on WhatsApp with do-it replies | |
| W9 One conversations screen | Every conversation in one place, "I'm taking over" per chat, bot performance | |
| W10 Live at Reut's | Real number and templates, careful mode, two weeks of close watch, then one-click connect per business | Needs Pit |

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
