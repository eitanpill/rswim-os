# Lodging (optional module)

A swim school or a freediving club that also has rooms runs them here: `/admin/lodging` and `/dive/lodging` (owner,
manager and office; instructors and customers see nothing). Package `@rswim/domain-lodging`.

## What the business sets up
- **Settings** (`lodging_settings`): on/off, check-in and check-out times, the 07:00 morning brief, and the phone it
  goes to (reception or housekeeping; empty means the owner's approvals number from the brain).
- **Rooms** (`lodging_rooms` + `lodging_beds`): name, kind (single, double, family, dorm, suite, other), beds, most
  guests, toilet and shower (private or shared), price per night, note. "Add 4 family rooms" creates משפחתי 1..4.
  A dorm is sold by the bed: one bed, one guest. Every other kind is sold as a whole room.

## Prices (`lodging_rates`, `prices.ts`)
- A room's price is its base price, for the whole room or for each guest (`price_per`; a dorm is always per bed).
- The price list (`/admin/lodging/prices`, `/dive/lodging/prices`) has three kinds of rule: a **season** (first and
  last night, once or every year, may wrap the new year), the **weekend** (nights of the week, Thursday and Friday by
  default) and the **holidays** (from the Hebrew calendar, Israel's schedule: the night before each Yom Tov and the
  Chol HaMoed nights; nobody types dates). Each rule raises or lowers the night by a percent or sets a fixed price,
  for every room or one kind, and may ask for a minimum stay. Rules can be paused or removed.
- One night: base price → the season (a kind-specific rule beats an all-rooms one, then the shorter season, then the
  newer) → a holiday, or else a weekend (same tie-break). Percents round to a whole shekel; a percent leaves an
  unpriced room unpriced.
- Minimum stay: the business's own (`lodging_settings.min_nights`) or the most any rule touching the stay asks for.
  The office may book shorter (the board shows a warning); the bot and online bookings may not (`lodging.errors.tooShort`).
- A stay keeps the price it was booked at (`lodging_stays.total_agorot`); changing the price list never moves it.
- The board's search shows each option's total, the price night by night and which rules applied; the bot hears the
  price list in its facts and gets exact totals, minimum nights and special nights from `lodging_availability`.

## Stays (`lodging_stays`)
- Statuses: held, confirmed, checked_in, checked_out, cancelled. A group booked into a dorm without a bed is split into
  one stay per free bed.
- The database refuses a room or bed sold twice for overlapping nights (`app.lodging_stay_check`, advisory lock per
  room), a bed with more than one guest, and a whole room above its most guests. Checking out marks the room to clean
  (`app.lodging_stay_out`).
- Closing beds that still have a future stay is refused (`lodging.errors.bedInUse`).

## Blocks for repair (`blockRoom`)
- A room, or one bed of a dorm, closed from a date until the first night it is open again, with a reason. It is a stay
  with `source = 'block'` (the reason in `guest_name`, status confirmed), so the same database rule keeps anyone from
  booking those nights, and the search, the board and the bot see it as taken. Nights already booked cannot be closed
  (`lodging.errors.blockTaken`).
- A block is not a guest: it never checks in or out and has nothing to pay (`lodging.errors.notPayable`). "Open the
  room" cancels it. The day (`dayPlan.blocked`) and the morning brief list rooms closed tonight, leave them out of the
  rooms to prepare, and count occupancy over the open units only.

## The day before (`reminders.ts`)
- Settings: `guest_reminder` (on by default) and `arrival_note` (directions, parking, the gate code).
- 17:00 worker `lodging-guest-reminders` (or event `lodging/reminders.run`): each booking arriving tomorrow, held or
  confirmed, with a phone, gets one WhatsApp (`lodging.reminder:<booking>:<check-in>`): the business, check-in and
  check-out times, the room, the arrival note, and what is still owed. When the business has a processor it adds a
  link for the balance, reusing a link already open for that amount (`RSWIM_PUBLIC_URL`).

## Deposits and payments (`lodging_payments`, `deposit.ts`, `payments.ts`)
- Settings: the deposit as a percent of the price (`deposit_percent`, 0 = none, rounded to a whole shekel) and how
  long a held booking waits for it (`hold_hours`, default 24).
- A booking (`booking_id`; a dorm's beds booked together share one) has an append-only money list: payments and
  refunds, by hand from the office (cash, card, Bit, transfer) or `online`. Paid, still owed, overpaid and the deposit
  still missing are derived (`bookingMoney`). A refund larger than what was paid is refused.
- Booked "held", a stay gets `hold_until` = now + `hold_hours`. Once its deposit is in it is confirmed by itself.
  When the hold passes without it, the next look at the nights (`releaseLapsedHolds`, before every `loadStays`)
  cancels it and frees the room, with no cron. A deposit that still arrives brings it back while the room is free;
  otherwise it stays cancelled and the office refunds.
- The office sends a payment link for the deposit still missing or the whole balance: a checkout with purpose
  `lodging_stay` on the business's own processor (`/pay/<token>`, docs/PAYMENTS.md), lasting as long as the hold for a
  deposit, and optionally sent to the guest's phone on WhatsApp (`lodging.pay_link:<checkout>`). The processor's
  callback reaches `settleLodgingCheckout` through the billing intake's module hook (`onModulePaid` in
  `apps/web/src/lib/payments.ts`), recorded once per checkout.
- No receipt is issued for lodging payments yet.

## Screens
- **Today**: arrivals, departures (check in and out with one tap), rooms to make up (turnovers first: someone leaves
  and someone arrives the same day), tonight's occupancy.
- **Board**: find free rooms for dates and guests, cheapest first, and book; a 14-night grid of rooms and dorm beds
  (blocks in grey with 🔧); "close a room for repair" below it.
- **Rooms and settings** (including the day-before reminder and the arrival note).
- **Prices**: the price list and the coming year's holiday nights.
- **A stay**: its details and moves, and the booking's money: price, deposit, paid, still owed, payments, payment
  links, "link for the deposit / the balance" (optionally on WhatsApp) and "record a payment". A block's page shows
  the reason and dates and "open the room".

## The brain
- 17:00 worker `lodging-guest-reminders`: the guests' day-before WhatsApp (above).
- 07:00 worker `lodging-morning-brief` (or event `lodging/brief.run`) sends one WhatsApp per business per day
  (idempotency key `lodging.brief:<date>`) with check-ins, check-outs and rooms to prepare.
- The lead bot gets the tool `lodging_availability` (free rooms and total price for dates) and the house facts
  (check-in and out times, room kinds) through `registerLeadBotModule`.

## Next stages
Booking from the bot (as a brain action with the owner's autonomy level, then sending the deposit link), the guest's
forms and house rules signed before arrival, receipts for lodging payments, self-booking online, and linking a stay to
a lead, family, camp or course. See the master doc's lodging tab.
