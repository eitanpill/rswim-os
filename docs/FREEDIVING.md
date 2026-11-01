# Freediving clubs

R-SWIM OS runs freediving clubs as a second vertical beside swim schools. The first is a demo of an Eilat club on
the Red Sea; everything in it is invented.

## How an Eilat freediving club works (what the model follows)

- **Sites**: shore lines a short swim from the beach (the lighthouse, the Japanese Gardens, Moses Rock), a boat
  drop-off for deeper water, the Satil wreck for fun dives, and a pool for static and dynamic training.
- **The sea decides the day**: the north wind blowing down the gulf is the usual problem. Every morning someone
  posts wind, waves, visibility, water temperature and current; the club's rules turn that into go, caution or no-go.
- **Programs**: try dives for tourists, agency courses (Molchanovs Wave 1–3, AIDA 2–3) taught over several days,
  line training on passes, workshops (breathing, equalisation), and trips.
- **Safety**: buddy system, divers per instructor by program, depth that grows one step at a time from a diver's
  best, waivers and medical declarations, and a safety log for LMCs, blackouts, squeezes and anything else.
- **Customers**: Eilat locals training on weekdays, Israelis from the centre on weekends, guests from abroad.
- **Money**: course and session fees, passes, gear rental and a small shop, taken at the desk.

## Roles and screens (`apps/web/src/app/dive`)

| Who | Membership | Screen | What it answers |
|---|---|---|---|
| Owner | owner | `/dive/owner` (the bridge) | How is the club doing, and what needs me? Sea, revenue, fill, safety streak, conversion, origins, the certification ladder, crew, what sells, insights |
| Manager | admin + `settings.write` | `/dive/manager` (ops room) | The week against the sea forecast, holds and cancellations, the morning sea report, paperwork to chase, crew certificates, gear, rules, safety log |
| Office | admin | `/dive/office` (front desk) | Who arrives and whether each is ready (waiver, medical, level, payment), check-in, quick booking, gear out and back, the till, leads |
| Instructor | instructor | `/dive/instructor` (in the water) | My sessions, each diver's allowed depth and why, lines and buddies, dive log, course skills |
| Customer | parent (a diver is their own guardian) | `/dive/me` | My best and today's allowed depth, next dives with the meeting point and line, my pass, booking, my paperwork (`/dive/me/forms`: sign, renew, update insurance), logbook |
| Platform admin | `platform_admins` | `/platform` (network) | Every school and club side by side: customers, revenue, sessions, the coming week, safety |

The owner, the manager and the front desk also have the paperwork center (`/dive/forms`). The owner sees every staff screen through the tabs. `/dive/divers` and `/dive/divers/[id]` are the staff's diver
list and file.

The diver list filters by level, origin, medical, waiver, pass (valid, ending soon, none), payment (owes or all
paid), activity (recent, lapsed, never dived), upcoming bookings and tag, sorted by revenue, name, last dive, best
depth or level. Filters combine and live in the URL (`DiverFilterSchema` in `@rswim/contracts`), and five quick views
(owe money, pass ending, medical expired, booked to dive, no dive in 90 days) sit one tap away.

## Look and feel

The live demo's sign-in (`RSWIM_DEMO_PROFILE=freediving`) is the club's own landing (`apps/web/src/app/login/dive-landing.tsx`):
one tap in as the owner, a card per role, the swim school and platform folded underneath. The owner's bridge opens
with a live deep-water greeting beside the sea card, a dismissible three-step tour (remembered per browser), counting
KPIs with a revenue trend, and the certification ladder drawn as a water column. On phones every club screen has a
bottom tab bar. The front desk shows today's sessions as tiles side by side (time, site, instructor, arrived of booked, who
is not ready, who still owes); tapping one opens every detail of the session and its arrivals, with check-in and
payment, in a dialog (`_ui/tile-dialog.tsx`). Motion (bubbles, light, count-up, panels surfacing) lives in `globals.css` and `_ui/motion.tsx` and
stops under `prefers-reduced-motion`.

## Data (`packages/db/src/schema/dive.ts`, RLS in `0029_dive_security.sql`)

`dive_rule_sets` (versioned rules) · `dive_sites` · `dive_programs` · `dive_divers` · `dive_sessions` ·
`dive_bookings` (line, buddy, target depth, pass, rule version) · `dive_passes` · `dive_logs` · `dive_incidents` ·
`dive_enrollments` (skills ticked) · `dive_gear` · `dive_rentals` · `dive_sales` (append-only) · `dive_conditions` ·
`dive_leads` · `dive_staff_certs` · `dive_form_templates` · `dive_form_signatures` (forms, below).

The database guards what matters: capacity on booking (seats held for payment count), a customer may only book themself and cancel, a customer edits
only their own contact details (paperwork dates come only from signed forms), gear can't go out twice, personal bests follow clean dives, sales never change.

## Paying for a booking

A booking for a paid session counts only once it is paid. Until then it is `pending_payment` and holds the seat until
`hold_until`; after that the seat is free again and the diver must book again.

- Online, the diver goes from "להרשמה ותשלום" straight to the checkout (`/dive/me/pay/[bookingId]`), and the seat is
  held for `booking.payment_hold_minutes` (30 by default) or until the session starts.
- The desk can book without taking money ("לגבות בהגעה"): the seat is held until the session ends, and the arrival
  shows "לא שולם" with "גבייה ואישור".
- A pass, a free session or a payment at the desk confirms the booking at once.
- A customer can never confirm their own booking, because `guard_dive_booking` forces their bookings to pending. The
  desk confirms (`settleBooking`), and so does the payment provider's callback, which runs as the system for that one
  club (`@rswim/domain-dive/checkout`). Confirming checks capacity again and records the sale.
- Until the club's Grow account is connected, the checkout is the payment fake. It runs locally with
  `RSWIM_GROW_FAKE=1`, in E2E and in the live demo, and charges nothing. Without the fake it tells the diver to pay
  at the desk.
- The owner's feed shows how many bookings wait for payment and how much they add up to.
- A club that lets divers pay later turns this off with `booking.require_payment = false`.

### The desk decides what to charge

- **Booking a diver:** the desk can charge now (card, cash or Bit), confirm and collect at the club ("מאושר, גבייה
  במועדון"), hold the seat until paid, or give it free ("ללא חיוב").
- **Collecting or waiving:** any arrival that still owes shows "לגבייה במועדון" or "לא שולם" with "גבייה ואישור".
  Choosing "ללא חיוב" there waives the charge.
- **Passes and memberships:** the desk can sell one to a diver or give one free. A diver can buy one online from their
  page ("לקנות כרטיסייה או מנוי"), and it is issued only once paid. Prices, sessions and validity live in the rules
  (`passes`), not in code.
- Everything given free is a zero sale with method `comp` and the person who gave it (`sold_by`), so the till and the
  owner can see what was given and by whom.

## Forms: health declaration, waiver, insurance

The club keeps three forms (`dive_form_templates`, `dive_form_signatures`, migrations 0033/0034,
`packages/domain/dive/src/services/forms.ts`):

- **Health declaration**: yes/no questions. A question can be flagged (a line starting with `!` in the editor): a
  "yes" on it waits for the club ("ממתין לאישור") and does not count until the office clears it, usually with a
  doctor's note, or refuses it. Valid for `paperwork.medical_valid_months`.
- **Waiver** (כתב ויתור ושחרור מאחריות): read and sign. Valid for `paperwork.waiver_valid_months`.
- **Insurance**: insurer, policy number and end date, with an optional photo or PDF of the policy. The club chooses in
  the rules (`paperwork.insurance`) whether insurance is not asked (`off`), tracked with a warning that never blocks
  (`track`, the default) or required to get in the water (`require`); `paperwork.insurance_warn_days` (30) is when
  "ending soon" starts.

Signing: the diver signs on their phone (`/dive/me/forms`), or the desk hands its tablet to the diver from the
diver's file (`/dive/divers/[id]/forms/[kind]`, recorded as signed at the desk, with who opened it). The signature is
drawn on a pad and stored as points, never as an image or markup, with the typed full name and "I have read". The
database stamps what must not come from the signer: the sha256 of the exact text, the time, who recorded it, the
medical review and until when it counts, and it refuses a missing answer, a draft text or an insurance that has
already ended. Signatures are append-only; only the review of a pending health declaration changes, once, by the
office. The diver's file follows the signatures (`waiver_signed_on`, `medical_expires_on`, `insurance_expires_on`), so
readiness at the desk works as before. A customer can no longer set those dates directly.

Every signed form opens as a printable copy (`/dive/signed/[id]`): the text of the version signed, the answers, the
policy, the signature, when and where, the fingerprint, and the attached file.

The paperwork center (`/dive/forms`, owner, manager, front desk): health declarations waiting for clearance (clear or
refuse with a note and a doctor's note), divers booked this week with a form missing, and active divers whose
insurance is ending. The owner and the manager edit the texts there: a change is a draft, publishing makes it the
version new signatures use, and earlier signatures keep pointing at the text they signed. The owner's feed shows
`forms_pending` and `insurance`; the diver list filters by insurance.

Documents are stored through `FileStore` (`@rswim/integrations`): the local disk with `RSWIM_FILES_FAKE=1` (local, E2E)
and on the live demo, or Supabase Storage (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, private bucket
`RSWIM_FILES_BUCKET`, default `dive-documents`). Uploads are checked by their first bytes (JPG, PNG, WEBP, PDF, up to
8MB) and served only through `/api/dive/files/[id]`, which reads the `files` row as the signed-in person (RLS: the
club's staff, or the diver who uploaded it). Without a store, forms are signed without attachments.

The demo seeds sample texts (invented, not legal or medical advice), a signature behind every date already on a
diver's file, an insurance policy for most active divers (Dana's ends in 12 days), two health declarations waiting
for clearance and a waiver draft the manager has not published.

## Joining the club on one's own: `/join/<club>`

A club shares one link (Instagram bio, website, WhatsApp): `/join/<slug>`. Signed out, the page shows the club and how
joining works, and sends the visitor to the phone sign-in with the club named (`/login/phone?join=<slug>`). Only from
there, and only while the club takes sign-ups, does a new phone number become a new account (everywhere else the
phone sign-in still refuses unknown numbers). Signed in, the visitor fills in their name, phone, date of birth, an
emergency contact and "I'm new to freediving", and `public.dive_join_club` creates the household, the guardian (the
diver is their own guardian), the customer membership and the diver's file (`source = join_link`, tag `self_signup`,
and `beginner` when ticked), then points the next token at the club. Joining twice changes nothing; someone who
already works in the club cannot join it as a customer. A club closes its link with the rule
`registration.self_signup = false`.

Then `/dive/me/welcome` lists the first steps (`welcomeSteps`): emergency contact, certification card (optional for a
beginner), health declaration, waiver, insurance (optional while the club only tracks it) and a first dive. The
diver's home links back to it until it is done.

Certification cards (`dive_certifications`, RLS in `0036_dive_signup_security.sql`): the diver uploads a photo of the
card (agency, level on the club's ladder, name, number, issue date) from `/dive/me/certs`; it always starts
`pending`. The desk checks it under "תעודות לבדיקה" in `/dive/forms`, may correct the level, and verifies or rejects
it once. A verified card at or above the diver's level becomes the level on their file (so their allowed depth
follows it). The desk can also add a card from the diver's file and verify it on the spot. The owner's feed shows
`certs_pending`.

The demo seeds a verified card behind every certified diver, two divers who joined through the link this week with a
card each, and a regular who uploaded a higher card, all waiting for the desk. Persona **נועם (צולל חדש)**
(`diveNewcomer`) starts on the Eilat club's join link.

## Rules (`packages/domain/dive/src/policies.ts`, pure, 100% branch coverage)

`seaCall`, `allowedDepth`, `readiness`, `insuranceReadiness`, `formState`, `formsToSign`, `welcomeSteps`, `bookingDecision`, `bookingConfirmation`, `ratioCheck`, `passBalance`,
`planLines`, `clubInsights`.
Each takes the rules version in force; defaults live in `@rswim/contracts` (`DEFAULT_DIVE_RULES`).

## Demo

Seeded by `packages/seed/src/dive-data.ts`: "כחול עמוק אילת (דמו)" (about 110 divers, eight weeks back and two ahead,
a windy weekend coming, an instructor whose insurance just expired) and a smaller Haifa club. Personas: אורי (owner),
מאיה (manager), שני (office), יואב (instructor), דנה (diver). Script: `docs/demos/FREEDIVING.md`.
