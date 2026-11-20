# Lodging (optional module)

A swim school or a freediving club that also has rooms runs them here: `/admin/lodging` and `/dive/lodging` (owner,
manager and office; instructors and customers see nothing). Package `@rswim/domain-lodging`.

## What the business sets up
- **Settings** (`lodging_settings`): on/off, check-in and check-out times, the 07:00 morning brief, and the phone it
  goes to (reception or housekeeping; empty means the owner's approvals number from the brain).
- **Rooms** (`lodging_rooms` + `lodging_beds`): name, kind (single, double, family, dorm, suite, other), beds, most
  guests, toilet and shower (private or shared), price per night, note. "Add 4 family rooms" creates משפחתי 1..4.
  A dorm is sold by the bed: one bed, one guest. Every other kind is sold as a whole room.

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

## The brain
- 07:00 worker `lodging-morning-brief` (or event `lodging/brief.run`) sends one WhatsApp per business per day
  (idempotency key `lodging.brief:<date>`) with check-ins, check-outs and rooms to prepare.
- The lead bot gets the tool `lodging_availability` (free rooms and total price for dates) and the house facts
  (check-in and out times, room kinds) through `registerLeadBotModule`.

## Next stages
Booking from the bot (as a brain action with the owner's autonomy level), deposits and payment links, guest reminders
the day before, and linking a stay to a lead or family. See the master doc's lodging tab.
