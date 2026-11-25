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

## Screens
- **Today**: arrivals, departures (check in and out with one tap), rooms to make up (turnovers first: someone leaves
  and someone arrives the same day), tonight's occupancy.
- **Board**: find free rooms for dates and guests, cheapest first, and book; a 14-night grid of rooms and dorm beds.
- **Rooms and settings**.
- **Prices**: the price list and the coming year's holiday nights.

## The brain
- 07:00 worker `lodging-morning-brief` (or event `lodging/brief.run`) sends one WhatsApp per business per day
  (idempotency key `lodging.brief:<date>`) with check-ins, check-outs and rooms to prepare.
- The lead bot gets the tool `lodging_availability` (free rooms and total price for dates) and the house facts
  (check-in and out times, room kinds) through `registerLeadBotModule`.

## Next stages
Booking from the bot (as a brain action with the owner's autonomy level), deposits and payment links, guest reminders
the day before, and linking a stay to a lead or family. See the master doc's lodging tab.
