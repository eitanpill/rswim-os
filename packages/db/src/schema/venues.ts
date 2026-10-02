import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CLOSURE_SOURCES,
  CONTRACT_KINDS,
  GENDER_RESTRICTIONS,
  RENT_MODELS,
  VENUE_KINDS,
  VENUE_STATUSES,
} from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';

/** A venue is temporary by nature: it opens, closes, gets renovated or is lost to a competitor (brief §1.2). */
export const venues = pgTable(
  'venues',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('other'),
    status: text('status').notNull().default('active'),
    address: text('address'),
    city: text('city'),
    parkingInstructions: text('parking_instructions'),
    entryInstructions: text('entry_instructions'),
    frontDeskScript: text('front_desk_script'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('venues_org_id').on(t.organizationId, t.id),
    unique('venues_org_name').on(t.organizationId, t.name),
    check('venues_kind_check', sql.raw(`kind in (${inList(VENUE_KINDS)})`)),
    check('venues_status_check', sql.raw(`status in (${inList(VENUE_STATUSES)})`)),
  ],
);

export const venueContracts = pgTable(
  'venue_contracts',
  {
    id: id(),
    organizationId: orgId(),
    venueId: uuid('venue_id').notNull(),
    kind: text('kind').notNull().default('rent'),
    rentModel: text('rent_model').notNull().default('fixed_monthly'),
    amountAgorot: integer('amount_agorot').notNull().default(0),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    renewalOn: date('renewal_on'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('venue_contracts_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'venue_contracts_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    check('venue_contracts_kind_check', sql.raw(`kind in (${inList(CONTRACT_KINDS)})`)),
    check('venue_contracts_rent_model_check', sql.raw(`rent_model in (${inList(RENT_MODELS)})`)),
    check('venue_contracts_amount_check', sql`${t.amountAgorot} >= 0`),
    check(
      'venue_contracts_dates_check',
      sql`${t.endsOn} is null or ${t.startsOn} is null or ${t.endsOn} >= ${t.startsOn}`,
    ),
  ],
);

export const pools = pgTable(
  'pools',
  {
    id: id(),
    organizationId: orgId(),
    venueId: uuid('venue_id').notNull(),
    name: text('name').notNull(),
    indoor: boolean('indoor').notNull().default(true),
    tempMinC: smallint('temp_min_c'),
    tempMaxC: smallint('temp_max_c'),
    depthMinCm: smallint('depth_min_cm'),
    depthMaxCm: smallint('depth_max_cm'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('pools_org_id').on(t.organizationId, t.id),
    unique('pools_org_venue_id').on(t.organizationId, t.venueId, t.id),
    unique('pools_venue_name').on(t.venueId, t.name),
    foreignKey({
      name: 'pools_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
  ],
);

export const lanes = pgTable(
  'lanes',
  {
    id: id(),
    organizationId: orgId(),
    poolId: uuid('pool_id').notNull(),
    label: text('label').notNull(),
    ordinal: smallint('ordinal').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('lanes_org_id').on(t.organizationId, t.id),
    unique('lanes_org_pool_id').on(t.organizationId, t.poolId, t.id),
    unique('lanes_pool_label').on(t.poolId, t.label),
    foreignKey({
      name: 'lanes_pool_fk',
      columns: [t.organizationId, t.poolId],
      foreignColumns: [pools.organizationId, pools.id],
    }).onDelete('cascade'),
  ],
);

/** When the school may use a pool: weekday × time × who is admitted × which lanes are ours (brief §5). */
export const venueOperatingWindows = pgTable(
  'venue_operating_windows',
  {
    id: id(),
    organizationId: orgId(),
    venueId: uuid('venue_id').notNull(),
    poolId: uuid('pool_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    genderRestriction: text('gender_restriction').notNull().default('mixed'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('windows_org_id').on(t.organizationId, t.id),
    unique('windows_org_pool_id').on(t.organizationId, t.poolId, t.id),
    // The pool must belong to the same venue.
    foreignKey({
      name: 'windows_pool_fk',
      columns: [t.organizationId, t.venueId, t.poolId],
      foreignColumns: [pools.organizationId, pools.venueId, pools.id],
    }).onDelete('cascade'),
    index('windows_venue_weekday').on(t.venueId, t.weekday),
    check('windows_weekday_check', sql`${t.weekday} between 0 and 6`),
    check('windows_time_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'windows_dates_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    check(
      'windows_gender_check',
      sql.raw(`gender_restriction in (${inList(GENDER_RESTRICTIONS)})`),
    ),
  ],
);

/** Lanes allocated to us inside a window. Both must belong to the same pool. */
export const operatingWindowLanes = pgTable(
  'operating_window_lanes',
  {
    organizationId: orgId(),
    poolId: uuid('pool_id').notNull(),
    windowId: uuid('window_id').notNull(),
    laneId: uuid('lane_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.windowId, t.laneId] }),
    foreignKey({
      name: 'window_lanes_window_fk',
      columns: [t.organizationId, t.poolId, t.windowId],
      foreignColumns: [
        venueOperatingWindows.organizationId,
        venueOperatingWindows.poolId,
        venueOperatingWindows.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'window_lanes_lane_fk',
      columns: [t.organizationId, t.poolId, t.laneId],
      foreignColumns: [lanes.organizationId, lanes.poolId, lanes.id],
    }).onDelete('cascade'),
  ],
);

/** A known closure (renovation, authority order, holiday…). The closure workflow that acts on it is Phase 3. */
export const venueClosures = pgTable(
  'venue_closures',
  {
    id: id(),
    organizationId: orgId(),
    venueId: uuid('venue_id').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    announcedAt: timestamp('announced_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('venue_closures_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'venue_closures_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    index('venue_closures_venue_dates').on(t.venueId, t.startsOn),
    check('venue_closures_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check('venue_closures_source_check', sql.raw(`source in (${inList(CLOSURE_SOURCES)})`)),
  ],
);
