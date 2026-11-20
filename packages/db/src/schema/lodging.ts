import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  HOUSEKEEPING_STATES,
  ROOM_FACILITIES,
  ROOM_KINDS,
  ROOM_SOLD_BY,
  STAY_SOURCES,
  STAY_STATUSES,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';

/**
 * Lodging (docs/LODGING.md): an optional module for a business with rooms to sleep in. One row per business: whether
 * it is on, the check-in and check-out hours, and who hears the morning arrivals and departures on WhatsApp.
 */
export const lodgingSettings = pgTable(
  'lodging_settings',
  {
    organizationId: orgId()
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    checkInTime: text('check_in_time').notNull().default('15:00'),
    checkOutTime: text('check_out_time').notNull().default('11:00'),
    /** The 07:00 WhatsApp of today's arrivals, departures and rooms to prepare. */
    morningBrief: boolean('morning_brief').notNull().default(true),
    /** Who gets it (reception, housekeeping); without one, the owner's approvals number from the brain. */
    briefPhoneE164: text('brief_phone_e164'),
    updatedAt: updatedAt(),
  },
  () => [
    check('lodging_settings_check_in', sql`check_in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('lodging_settings_check_out', sql`check_out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

/** A room: a family room booked whole, or a dorm whose beds are booked one by one. */
export const lodgingRooms = pgTable(
  'lodging_rooms',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    soldBy: text('sold_by').notNull().default('room'),
    beds: integer('beds').notNull(),
    maxGuests: integer('max_guests').notNull(),
    toilet: text('toilet').notNull().default('private'),
    shower: text('shower').notNull().default('private'),
    /** Per night: the whole room, or one bed when sold by the bed. */
    priceNightAgorot: integer('price_night_agorot'),
    note: text('note'),
    housekeeping: text('housekeeping').notNull().default('clean'),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('lodging_rooms_org_id').on(t.organizationId, t.id),
    unique('lodging_rooms_org_name').on(t.organizationId, t.name),
    check('lodging_rooms_kind_check', sql.raw(`kind in (${inList(ROOM_KINDS)})`)),
    check('lodging_rooms_sold_by_check', sql.raw(`sold_by in (${inList(ROOM_SOLD_BY)})`)),
    check('lodging_rooms_toilet_check', sql.raw(`toilet in (${inList(ROOM_FACILITIES)})`)),
    check('lodging_rooms_shower_check', sql.raw(`shower in (${inList(ROOM_FACILITIES)})`)),
    check(
      'lodging_rooms_housekeeping_check',
      sql.raw(`housekeeping in (${inList(HOUSEKEEPING_STATES)})`),
    ),
    check('lodging_rooms_beds_check', sql`beds between 1 and 40`),
    check('lodging_rooms_guests_check', sql`max_guests between 1 and 60`),
    check('lodging_rooms_price_check', sql`price_night_agorot is null or price_night_agorot >= 0`),
  ],
);

/** One bed of a room. Every room has its beds; a dorm's bookings name one of them. */
export const lodgingBeds = pgTable(
  'lodging_beds',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('lodging_beds_org_id').on(t.organizationId, t.id),
    unique('lodging_beds_room_position').on(t.roomId, t.position),
    foreignKey({
      name: 'lodging_beds_room_fk',
      columns: [t.organizationId, t.roomId],
      foreignColumns: [lodgingRooms.organizationId, lodgingRooms.id],
    }).onDelete('cascade'),
  ],
);

/** A stay: a guest in a room (or one bed of a dorm) from the check-in day to the check-out day. */
export const lodgingStays = pgTable(
  'lodging_stays',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id').notNull(),
    /** Null when the whole room is booked. */
    bedId: uuid('bed_id'),
    guestName: text('guest_name').notNull(),
    phoneE164: text('phone_e164'),
    guests: integer('guests').notNull().default(1),
    checkIn: date('check_in').notNull(),
    checkOut: date('check_out').notNull(),
    status: text('status').notNull().default('confirmed'),
    source: text('source').notNull().default('office'),
    note: text('note'),
    leadId: uuid('lead_id'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('lodging_stays_org_id').on(t.organizationId, t.id),
    index('lodging_stays_room_dates').on(t.organizationId, t.roomId, t.checkIn, t.checkOut),
    index('lodging_stays_org_dates').on(t.organizationId, t.checkIn, t.checkOut),
    foreignKey({
      name: 'lodging_stays_room_fk',
      columns: [t.organizationId, t.roomId],
      foreignColumns: [lodgingRooms.organizationId, lodgingRooms.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lodging_stays_bed_fk',
      columns: [t.organizationId, t.bedId],
      foreignColumns: [lodgingBeds.organizationId, lodgingBeds.id],
    }),
    check('lodging_stays_status_check', sql.raw(`status in (${inList(STAY_STATUSES)})`)),
    check('lodging_stays_source_check', sql.raw(`source in (${inList(STAY_SOURCES)})`)),
    check('lodging_stays_dates_check', sql`check_out > check_in`),
    check('lodging_stays_guests_check', sql`guests between 1 and 60`),
  ],
);
