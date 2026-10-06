# Phase 8 — Transport, courses & camps, institutions

## Goal
Run the after-school transport without phone calls ("where are they?"), run intensive courses and camp weeks as
fixed cohorts with their own regulations, and bill the schools and councils that pay for their children by contract.

## Acceptance criterion (from the brief)
1. **Parents receive "arrived at the pool" automatically when the escort taps check-in.**
   A Playwright test signs in as the escort persona on a phone, marks a child on board and taps "יצאנו מבית הספר"
   and "הגענו לבריכה"; the worker's automation step turns the tap into a WhatsApp message to the families of the
   children on board (not the ones marked missing), visible in the office's message log and on the parent's child
   card.

## Scope

### 8.1 Transport (brief §6.10)
- Tables (`0016_transport`, `0017_transport_security`): `schools`, `transport_routes` (school → group, weekdays,
  leaving time, ride minutes, escort, vehicle, driver), `route_riders` (child, drop-off point, from/to dates),
  `route_runs` (one per route and day), `run_events` (stages and per-child marks, append-only).
- Escort app (`/transport`): today's runs of their own routes open by themselves; one big button for the next stage
  (left school, arrived at the pool, in the water, out of the water, left the pool, run done) and per-child marks
  (on board, didn't come, dropped off). The database stamps who and when, so a stage cannot be backdated; an escort
  can write only today's runs of their own routes.
- Messages: left school, arrived at the pool, left the pool, and each child's drop-off go through the comms hub
  automations (templates editable, Shabbat and quiet hours apply). Only children on board hear about it; a tap older
  than `transport.stale_after_min` messages nobody.
- In-water time: per run (arrival, in, out) against the lesson, flagged when short by more than
  `transport.short_water_warn_min`; a monthly report for the office.
- Office: today's runs (open runs, fix a mistaken tap, cancel a run), routes, riders, schools. The worker opens each
  day's runs at 06:00.

### 8.2 Courses and camps (brief §6.11)
- `cohorts` (program, dates, capacity, registration closing date, status) with their groups (`class_templates.cohort_id`)
  and extra staff (`cohort_staff`). A course twice a week = two groups; a camp week = a group per day.
- Registration places the child in every group of the cohort for its dates; capacity, the closing date and, for
  camps, `camp.children_per_staff` decide (pure policy, 100% coverage). The cohort's regulations are its program's
  policy version (e.g. a course without makeups).
- Billing charges the program's package price once per child and cohort.
- A printable roster (children, birth dates, parents' phones, water fear and medical flags, lesson dates, staff).

### 8.3 Institutions (brief §6.11)
- `institutions`, `institution_contracts` (dates, per child per month / per lesson / fixed month, payment terms),
  `institution_contract_groups`, `institution_invoices` (one per contract and month, lines frozen), and
  `institution_payments` (append-only).
- Families are not billed for places in groups an institution pays for that month.
- The office drafts the month from the roster, approves it, and the worker prints the tax invoice (fake Green Invoice
  until the account exists); payments are recorded against it (partial allowed, never more than the balance) and
  each gets a receipt. Open and overdue balances on the institutions screen.
- A printable monthly attendance report (children × lessons, cancelled lessons marked) to send with the invoice.
