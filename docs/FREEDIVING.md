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

## Data (`packages/db/src/schema/dive.ts`, RLS in `0029_dive_security.sql`)

`dive_rule_sets` (versioned rules) · `dive_sites` · `dive_programs` · `dive_divers` · `dive_sessions` ·
`dive_bookings` (line, buddy, target depth, pass, rule version) · `dive_passes` · `dive_logs` · `dive_incidents` ·
`dive_enrollments` (skills ticked) · `dive_gear` · `dive_rentals` · `dive_sales` (append-only) · `dive_conditions` ·
`dive_leads` · `dive_staff_certs`.

The database guards what matters: capacity on booking, a customer may only book themself and cancel, a customer edits
only their own paperwork fields, gear can't go out twice, personal bests follow clean dives, sales never change.

## Rules (`packages/domain/dive/src/policies.ts`, pure, 100% branch coverage)

`seaCall`, `allowedDepth`, `readiness`, `bookingDecision`, `ratioCheck`, `passBalance`, `planLines`, `clubInsights`.
Each takes the rules version in force; defaults live in `@rswim/contracts` (`DEFAULT_DIVE_RULES`).

## Demo

Seeded by `packages/seed/src/dive-data.ts`: "כחול עמוק אילת (דמו)" (about 110 divers, eight weeks back and two ahead,
a windy weekend coming, an instructor whose insurance just expired) and a smaller Haifa club. Personas: אורי (owner),
מאיה (manager), שני (office), יואב (instructor), דנה (diver). Script: `docs/demos/FREEDIVING.md`.
