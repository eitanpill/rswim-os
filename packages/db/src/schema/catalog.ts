import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { PRICE_ITEM_KINDS, PROGRAM_KINDS, SCOPE_TYPES } from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';
import { venues } from './venues';

export const programs = pgTable(
  'programs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    nameHe: text('name_he').notNull(),
    nameEn: text('name_en'),
    defaultDurationMin: smallint('default_duration_min').notNull(),
    defaultCapacity: smallint('default_capacity').notNull(),
    minAgeMonths: smallint('min_age_months'),
    maxAgeMonths: smallint('max_age_months'),
    parentInWater: boolean('parent_in_water').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('programs_org_id').on(t.organizationId, t.id),
    unique('programs_org_code').on(t.organizationId, t.code),
    check('programs_kind_check', sql.raw(`kind in (${inList(PROGRAM_KINDS)})`)),
    check('programs_duration_check', sql`${t.defaultDurationMin} between 5 and 240`),
    check('programs_capacity_check', sql`${t.defaultCapacity} between 1 and 100`),
    check(
      'programs_age_check',
      sql`${t.minAgeMonths} is null or ${t.maxAgeMonths} is null or ${t.maxAgeMonths} >= ${t.minAgeMonths}`,
    ),
  ],
);

/** An ordered ladder per program, each with a skills checklist (brief §6.4). */
export const levels = pgTable(
  'levels',
  {
    id: id(),
    organizationId: orgId(),
    programId: uuid('program_id').notNull(),
    code: text('code').notNull(),
    nameHe: text('name_he').notNull(),
    nameEn: text('name_en'),
    ordinal: smallint('ordinal').notNull(),
    /** [{ code, he, en? }] */
    skills: jsonb('skills').notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('levels_org_id').on(t.organizationId, t.id),
    unique('levels_program_code').on(t.programId, t.code),
    foreignKey({
      name: 'levels_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Versioned, effective-dated rules (ADR-0004). A version is never edited once it is in effect; a change is a new row
 * from a later date. Scope columns: org = none; venue = venue_id; program = program_id; venue_program = both;
 * class_template = class_template_id (FK added in Phase 2 with the table).
 */
export const policySets = pgTable(
  'policy_sets',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type').notNull(),
    venueId: uuid('venue_id'),
    programId: uuid('program_id'),
    classTemplateId: uuid('class_template_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    rules: jsonb('rules').notNull().default({}),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('policy_sets_org_id').on(t.organizationId, t.id),
    unique('policy_sets_scope_from')
      .on(t.organizationId, t.scopeType, t.venueId, t.programId, t.classTemplateId, t.effectiveFrom)
      .nullsNotDistinct(),
    foreignKey({
      name: 'policy_sets_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'policy_sets_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    check('policy_sets_scope_check', sql.raw(`scope_type in (${inList(SCOPE_TYPES)})`)),
    check(
      'policy_sets_scope_columns_check',
      sql`case ${t.scopeType}
        when 'org' then ${t.venueId} is null and ${t.programId} is null and ${t.classTemplateId} is null
        when 'venue' then ${t.venueId} is not null and ${t.programId} is null and ${t.classTemplateId} is null
        when 'program' then ${t.venueId} is null and ${t.programId} is not null and ${t.classTemplateId} is null
        when 'venue_program' then ${t.venueId} is not null and ${t.programId} is not null and ${t.classTemplateId} is null
        when 'class_template' then ${t.classTemplateId} is not null
      end`,
    ),
    check(
      'policy_sets_dates_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/**
 * A price list version: org-wide (venue_id null) or for one venue. Items inside are per program × kind × duration.
 * Same immutability rule as policy sets once published and in effect.
 */
export const priceLists = pgTable(
  'price_lists',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    venueId: uuid('venue_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    status: text('status').notNull().default('draft'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('price_lists_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'price_lists_venue_fk',
      columns: [t.organizationId, t.venueId],
      foreignColumns: [venues.organizationId, venues.id],
    }).onDelete('cascade'),
    index('price_lists_org_from').on(t.organizationId, t.effectiveFrom),
    check('price_lists_status_check', sql`${t.status} in ('draft', 'published', 'archived')`),
    check(
      'price_lists_dates_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

export const priceItems = pgTable(
  'price_items',
  {
    id: id(),
    organizationId: orgId(),
    priceListId: uuid('price_list_id').notNull(),
    programId: uuid('program_id').notNull(),
    kind: text('kind').notNull(),
    /** null = any duration of this program. */
    durationMin: smallint('duration_min'),
    /** For packages: lessons included (12-lesson course, punch card). */
    sessionsCount: smallint('sessions_count'),
    amountAgorot: integer('amount_agorot').notNull(),
    label: text('label'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('price_items_org_id').on(t.organizationId, t.id),
    unique('price_items_key')
      .on(t.priceListId, t.programId, t.kind, t.durationMin, t.sessionsCount)
      .nullsNotDistinct(),
    foreignKey({
      name: 'price_items_list_fk',
      columns: [t.organizationId, t.priceListId],
      foreignColumns: [priceLists.organizationId, priceLists.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'price_items_program_fk',
      columns: [t.organizationId, t.programId],
      foreignColumns: [programs.organizationId, programs.id],
    }).onDelete('cascade'),
    check('price_items_kind_check', sql.raw(`kind in (${inList(PRICE_ITEM_KINDS)})`)),
    check('price_items_amount_check', sql`${t.amountAgorot} >= 0`),
    check('price_items_sessions_check', sql`${t.kind} <> 'package' or ${t.sessionsCount} > 0`),
  ],
);
