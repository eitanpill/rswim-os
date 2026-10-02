import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, orgId } from './_helpers';
import { organizations } from './tenancy';

/** One row per import (e.g. GHL contacts): counts in `stats`, a line per source record in `report`. */
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
  },
  (t) => [
    unique('import_runs_org_id').on(t.organizationId, t.id),
    index('import_runs_org_started').on(t.organizationId, t.startedAt),
    check('import_runs_status_check', sql`${t.status} in ('running', 'succeeded', 'failed')`),
  ],
);
