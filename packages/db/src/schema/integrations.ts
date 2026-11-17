import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, orgId } from './_helpers';
import { organizations } from './tenancy';

/** One row per import (GHL contacts, or a file of families, divers or staff): counts in `stats`, a line per source record in `report`. */
export const importRuns = pgTable(
  'import_runs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('running'),
    stats: jsonb('stats').notNull().default({}),
    report: jsonb('report').notNull().default([]),
    error: text('error'),
    createdBy: uuid('created_by'),
    startedAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** A file import: the uploaded file's name, its table while it is a draft ({ headers, rows }), and its mapping. */
    fileName: text('file_name'),
    source: jsonb('source'),
    mapping: jsonb('mapping').notNull().default({}),
    /** What a saved file import created ({ households, students, divers, staff }: ids), for taking it back. */
    created: jsonb('created').notNull().default({}),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
  },
  (t) => [
    unique('import_runs_org_id').on(t.organizationId, t.id),
    index('import_runs_org_started').on(t.organizationId, t.startedAt),
    check(
      'import_runs_status_check',
      sql`${t.status} in ('draft', 'running', 'succeeded', 'failed', 'undone')`,
    ),
  ],
);
