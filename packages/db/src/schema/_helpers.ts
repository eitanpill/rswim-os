import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const id = () => uuid('id').primaryKey().defaultRandom();
export const orgId = () => uuid('organization_id').notNull();
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** CHECK (col in (...)) built from a contracts enum, so the database and Zod agree on allowed values. */
export function inList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
}
