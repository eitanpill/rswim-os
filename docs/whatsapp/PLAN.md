# The WhatsApp track

WhatsApp is the product's main feature (Pit, 2026-11-20): one number per business and one bot connected to the
business brain. It takes a new customer from the first message to a trial and payment, serves families, divers and
staff, and talks to the owner like an office manager. Generic for every swim school and freediving club. The plan
Pit sees is the "מסלול הוואטסאפ" tab of the master document. Real sending stays on the fake (`RSWIM_MESSAGING_FAKE`)
until a business's Meta account is connected.

| Stage | What it adds | Status |
|---|---|---|
| W1 Leads in one place | A new number on WhatsApp opens a lead; one list for swim and dive; triggers move it on | **This PR** |
| W2 The bot answers a new customer | Prices, programs, open seats, FAQ; collects details one question at a time; modules (lodging) plug in | Next |
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
