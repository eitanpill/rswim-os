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
| Customer | parent (a diver is their own guardian) | `/dive/me` | My best and today's allowed depth, next dives with the meeting point and line, my pass, booking, paperwork, logbook |
| Platform admin | `platform_admins` | `/platform` (network) | Every school and club side by side: customers, revenue, sessions, the coming week, safety |

The owner sees every staff screen through the tabs. `/dive/divers` and `/dive/divers/[id]` are the staff's diver
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
`dive_leads` · `dive_staff_certs`.

The database guards what matters: capacity on booking (seats held for payment count), a customer may only book themself and cancel, a customer edits
only their own paperwork fields, gear can't go out twice, personal bests follow clean dives, sales never change.

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

## Rules (`packages/domain/dive/src/policies.ts`, pure, 100% branch coverage)

`seaCall`, `allowedDepth`, `readiness`, `bookingDecision`, `bookingConfirmation`, `ratioCheck`, `passBalance`,
`planLines`, `clubInsights`.
Each takes the rules version in force; defaults live in `@rswim/contracts` (`DEFAULT_DIVE_RULES`).

## Demo

Seeded by `packages/seed/src/dive-data.ts`: "כחול עמוק אילת (דמו)" (about 110 divers, eight weeks back and two ahead,
a windy weekend coming, an instructor whose insurance just expired) and a smaller Haifa club. Personas: אורי (owner),
מאיה (manager), שני (office), יואב (instructor), דנה (diver). Script: `docs/demos/FREEDIVING.md`.
